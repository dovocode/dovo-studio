import ExpoModulesCore
import UIKit

struct ComposerReferenceRecord: Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
  @Field var kind: String = ""
  @Field var label: String = ""
  @Field var icon: String = ""
  @Field var iconTemplate: Bool = true
}
struct ComposerContentRecord: Record {
  @Field var text: String = ""
  @Field var revision: String = ""
  @Field var eventCount: Int = 0
  @Field var references: [ComposerReferenceRecord] = []
}
public class DovoComposerInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoComposerInput")
    AsyncFunction("blur") { await MainActor.run { DovoComposerInputView.active?.input.resignFirstResponder() } }
    View(DovoComposerInputView.self) {
      Events("onTextChange", "onSourceSelection", "onFocus", "onBlur", "onSize")
      Prop("content") { (view: DovoComposerInputView, content: ComposerContentRecord) in view.receive(content) }
      Prop("editable") { (view: DovoComposerInputView, value: Bool) in view.input.isEditable = value }
      Prop("placeholder") { (view: DovoComposerInputView, value: String) in view.placeholder.text = value }
      Prop("focusKey") { (view: DovoComposerInputView, value: String) in
        if !value.isEmpty && value != view.focusKey { view.focusKey = value; view.input.becomeFirstResponder() }
      }
      Prop("textColor") { (view: DovoComposerInputView, value: UIColor) in view.foreground = value; view.refreshStyle() }
      Prop("mutedColor") { (view: DovoComposerInputView, value: UIColor) in view.placeholder.textColor = value }
      Prop("chipColor") { (view: DovoComposerInputView, value: UIColor) in view.chipColor = value; view.refreshStyle() }
    }
  }
}

final class ReferenceAttachment: NSTextAttachment {
  let source: String
  let label: String
  let icon: String
  let iconTemplate: Bool
  init(source: String, label: String, foreground: UIColor, background: UIColor, font: UIFont,
    icon: String = "", iconTemplate: Bool = true) {
    self.source = source
    self.label = label
    self.icon = icon
    self.iconTemplate = iconTemplate
    super.init(data: nil, ofType: nil)
    let title = label as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: foreground]
    let glyph = Data(base64Encoded: icon).flatMap { UIImage(data: $0) }
    let iconWidth: CGFloat = glyph == nil ? 0 : 20
    // Bound chip width to the input. Long names truncate visually; copy always keeps source.
    let width = min(250, ceil(title.size(withAttributes: attributes).width) + 14 + iconWidth)
    let size = CGSize(width: width, height: 24)
    image = UIGraphicsImageRenderer(size: size).image { _ in
      background.setFill()
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 5).fill()
      if let glyph {
        let image = iconTemplate ? glyph.withTintColor(foreground, renderingMode: .alwaysOriginal) : glyph
        image.draw(in: CGRect(x: 7, y: 4, width: 16, height: 16))
      }
      let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
      var drawing = attributes; drawing[.paragraphStyle] = paragraph
      title.draw(in: CGRect(x: 7 + iconWidth, y: 2, width: width - 14 - iconWidth, height: 22), withAttributes: drawing)
    }
    bounds = CGRect(x: 0, y: -5, width: width, height: 24)
  }
  required init?(coder: NSCoder) { return nil }
}

final class ComposerTextView: UITextView {
  override func copy(_ sender: Any?) {
    UIPasteboard.general.string = source(in: selectedRange)
  }
  override func cut(_ sender: Any?) {
    guard isEditable, let range = selectedTextRange else { return }
    copy(sender)
    replace(range, withText: "")
  }
  override func paste(_ sender: Any?) {
    guard isEditable, let text = UIPasteboard.general.string, let range = selectedTextRange else { return }
    replace(range, withText: text)
  }
  func source(in range: NSRange? = nil) -> String {
    let attributed = attributedText ?? NSAttributedString()
    let range = range ?? NSRange(location: 0, length: attributed.length)
    var source = ""
    attributed.enumerateAttributes(in: range) { attributes, part, _ in
      if let reference = attributes[.attachment] as? ReferenceAttachment { source += reference.source }
      else { source += (attributed.string as NSString).substring(with: part) }
    }
    return source
  }
  func sourceOffset(_ displayOffset: Int) -> Int {
    (source(in: NSRange(location: 0, length: max(0, min(displayOffset, textStorage.length)))) as NSString).length
  }
  func displayOffset(_ sourceOffset: Int) -> Int {
    var result = 0
    var source = 0
    textStorage.enumerateAttributes(in: NSRange(location: 0, length: textStorage.length)) { attributes, range, stop in
      let length = (attributes[.attachment] as? ReferenceAttachment).map { ($0.source as NSString).length } ?? range.length
      if sourceOffset <= source + length {
        result = range.location + (attributes[.attachment] == nil ? max(0, sourceOffset - source) : (sourceOffset > source ? 1 : 0))
        stop.pointee = true
      } else { source += length; result = NSMaxRange(range) }
    }
    return result
  }
}

final class DovoComposerInputView: ExpoView, UITextViewDelegate {
  static weak var active: DovoComposerInputView?
  let input = ComposerTextView()
  let placeholder = UILabel()
  let onTextChange = EventDispatcher()
  let onSourceSelection = EventDispatcher()
  let onFocus = EventDispatcher()
  let onBlur = EventDispatcher()
  let onSize = EventDispatcher()
  var foreground = UIColor.label
  var chipColor = UIColor.secondarySystemBackground
  var focusKey = ""
  private var revision: String?
  private var eventCount = 0
  private var changing = false
  private var pending: ComposerContentRecord?
  private var projectionUndoSource: String?
  private var height: CGFloat = 0
  private let font = UIFont.preferredFont(forTextStyle: .body)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    input.delegate = self
    input.backgroundColor = .clear
    input.font = font
    input.textContainerInset = UIEdgeInsets(top: 11, left: 7, bottom: 11, right: 7)
    input.autocorrectionType = .no
    input.spellCheckingType = .no
    input.smartInsertDeleteType = .no
    input.smartQuotesType = .no
    input.smartDashesType = .no
    input.accessibilityLabel = "Message"
    input.accessibilityIdentifier = "Message"
    placeholder.font = font
    placeholder.isUserInteractionEnabled = false
    addSubview(input); addSubview(placeholder)
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    input.frame = bounds
    placeholder.frame = CGRect(x: 12, y: 11, width: max(0, bounds.width - 24), height: 22)
    measure()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil && !focusKey.isEmpty { input.becomeFirstResponder() }
    if window == nil { input.resignFirstResponder() }
  }
  func receive(_ content: ComposerContentRecord) {
    guard content.eventCount >= eventCount else { return }
    pending = content
    // Leave IME marked text alone. Apply only when composition has committed.
    guard input.markedTextRange == nil else { return }
    apply(content)
  }
  private func apply(_ content: ComposerContentRecord, forceStyle: Bool = false) {
    let source = input.source()
    let external = revision != content.revision
    guard external || source == content.text else { return }
    revision = content.revision
    if external { projectionUndoSource = nil }
    // Do not recreate an autoformat step that the user has just undone.
    if !external && projectionUndoSource == source { return }
    if !forceStyle && source == content.text && matches(content.references) {
      placeholder.isHidden = !source.isEmpty
      measure()
      return
    }
    let selected = input.selectedRange
    let start = external ? (content.text as NSString).length : input.sourceOffset(selected.location)
    let end = external ? start : input.sourceOffset(NSMaxRange(selected))
    changing = true
    defer { changing = false }
    let text = NSMutableAttributedString(string: content.text, attributes: [.font: font, .foregroundColor: foreground])
    let length = text.length
    var nextStart = length
    for reference in content.references.reversed() {
      guard reference.start >= 0, reference.end > reference.start, reference.end <= nextStart else { continue }
      let range = NSRange(location: reference.start, length: reference.end - reference.start)
      let source = (content.text as NSString).substring(with: range)
      let chip = ReferenceAttachment(source: source, label: reference.kind.uppercased() + " " + reference.label,
        foreground: foreground, background: chipColor, font: font, icon: reference.icon, iconTemplate: reference.iconTemplate)
      text.replaceCharacters(in: range, with: NSAttributedString(attachment: chip))
      nextStart = reference.start
    }
    if !input.attributedText.isEqual(to: text) {
      if external {
        input.undoManager?.removeAllActions()
      } else if !forceStyle && input.textStorage.string != text.string {
        // Undo the display projection before UIKit replays text edits at its old offsets.
        registerDisplayUndo()
      }
      input.textStorage.setAttributedString(text)
      input.selectedRange = NSRange(location: input.displayOffset(start), length: max(0, input.displayOffset(end) - input.displayOffset(start)))
      input.typingAttributes = [.font: font, .foregroundColor: foreground]
    }
    placeholder.isHidden = !content.text.isEmpty
    input.accessibilityValue = content.text
    measure()
  }
  private func registerDisplayUndo() {
    let before = NSAttributedString(attributedString: input.textStorage)
    let selection = input.selectedRange
    input.undoManager?.registerUndo(withTarget: self) { view in
      view.registerDisplayUndo()
      let source = view.input.source()
      view.changing = true
      view.input.textStorage.setAttributedString(before)
      view.input.selectedRange = selection
      view.input.typingAttributes = [.font: view.font, .foregroundColor: view.foreground]
      view.changing = false
      if source == view.input.source() {
        view.projectionUndoSource = source
        view.selection()
        view.measure()
      } else { view.textViewDidChange(view.input) }
    }
  }
  private func matches(_ references: [ComposerReferenceRecord]) -> Bool {
    var actual: [(Int, Int, String, String, Bool)] = []
    input.textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: input.textStorage.length)) { value, range, _ in
      if let chip = value as? ReferenceAttachment {
        actual.append((input.sourceOffset(range.location), input.sourceOffset(NSMaxRange(range)), chip.label, chip.icon, chip.iconTemplate))
      }
    }
    return actual.count == references.count && zip(actual, references).allSatisfy { value, reference in
      value.0 == reference.start && value.1 == reference.end && value.2 == reference.kind.uppercased() + " " + reference.label && value.3 == reference.icon && value.4 == reference.iconTemplate
    }
  }
  func refreshStyle() {
    input.textColor = foreground
    if let content = pending, content.text == input.source(), input.markedTextRange == nil { apply(content, forceStyle: true) }
  }
  func textViewDidChange(_ textView: UITextView) {
    guard !changing else { return }
    projectionUndoSource = nil
    eventCount += 1
    let source = input.source()
    placeholder.isHidden = !source.isEmpty
    input.accessibilityValue = source
    onTextChange(["text": source, "eventCount": eventCount])
    selection()
    measure()
  }
  func textViewDidChangeSelection(_ textView: UITextView) {
    guard !changing else { return }
    selection()
    if input.markedTextRange == nil, let content = pending, content.eventCount >= eventCount { apply(content) }
  }
  private func selection() {
    onSourceSelection(["start": input.sourceOffset(input.selectedRange.location), "end": input.sourceOffset(NSMaxRange(input.selectedRange))])
  }
  func textViewDidBeginEditing(_ textView: UITextView) { Self.active = self; onFocus([:]) }
  func textViewDidEndEditing(_ textView: UITextView) { if Self.active === self { Self.active = nil }; onBlur([:]) }
  private func measure() {
    guard bounds.width > 0 else { return }
    let next = ceil(input.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
    if next != height { height = next; onSize(["height": next]) }
  }
}
