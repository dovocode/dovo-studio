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
  @Field var links: [ComposerLinkRecord] = []
}
struct ComposerLinkRecord: Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
  @Field var url: String = ""
}
public class DovoComposerInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoComposerInput")
    Constants(["supportsReferenceMessages": true, "supportsDraftSnapshot": true])
    AsyncFunction("blur") { await MainActor.run { DovoComposerInputView.active?.input.resignFirstResponder() } }
    View(DovoComposerInputView.self) {
      AsyncFunction("readText") { (view: DovoComposerInputView) -> [String: Any] in view.readText() }
      Events("onTextChange", "onSourceSelection", "onFocus", "onBlur", "onSize", "onLink")
      Prop("content") { (view: DovoComposerInputView, content: ComposerContentRecord) in view.receive(content) }
      Prop("editable") { (view: DovoComposerInputView, value: Bool) in view.input.isEditable = value }
      Prop("displayOnly") { (view: DovoComposerInputView, value: Bool) in view.setDisplayOnly(value) }
      Prop("messageFontSize") { (view: DovoComposerInputView, value: Double) in view.messageFontSize = CGFloat(value); view.refreshStyle() }
      Prop("messageLineHeight") { (view: DovoComposerInputView, value: Double) in view.messageLineHeight = CGFloat(value); view.refreshStyle() }
      Prop("linkColor") { (view: DovoComposerInputView, value: UIColor) in view.input.linkTextAttributes = [.foregroundColor: value] }
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
    let height = max(24, ceil(font.lineHeight) + 4)
    let size = CGSize(width: width, height: height)
    image = UIGraphicsImageRenderer(size: size).image { _ in
      background.setFill()
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 5).fill()
      if let glyph {
        let image = iconTemplate ? glyph.withTintColor(foreground, renderingMode: .alwaysOriginal) : glyph
        image.draw(in: CGRect(x: 7, y: (height - 16) / 2, width: 16, height: 16))
      }
      let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
      var drawing = attributes; drawing[.paragraphStyle] = paragraph
      title.draw(in: CGRect(x: 7 + iconWidth, y: 2, width: width - 14 - iconWidth, height: height - 4), withAttributes: drawing)
    }
    bounds = CGRect(x: 0, y: font.descender - 1, width: width, height: height)
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
  let onLink = EventDispatcher()
  private var displayOnly = false
  var foreground = UIColor.label
  var chipColor = UIColor.secondarySystemBackground
  var focusKey = ""
  private var revision: String?
  private var eventCount = 0
  private var changing = false
  private var pending: ComposerContentRecord?
  private var projectionUndoSource: String?
  private var height: CGFloat = 0
  var messageFontSize: CGFloat = 17
  var messageLineHeight: CGFloat = 25
  private let inputFont = UIFont.preferredFont(forTextStyle: .body)
  private var font: UIFont { displayOnly ? .systemFont(ofSize: messageFontSize) : inputFont }
  private var textAttributes: [NSAttributedString.Key: Any] {
    var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: foreground]
    if displayOnly {
      let paragraph = NSMutableParagraphStyle()
      paragraph.minimumLineHeight = messageLineHeight
      attributes[.paragraphStyle] = paragraph
    }
    return attributes
  }

  private func restoreTypingStyle() {
    guard input.markedTextRange == nil else { return }
    input.typingAttributes = textAttributes
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    input.delegate = self
    input.backgroundColor = .clear
    input.font = font
    restoreTypingStyle()
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
  func setDisplayOnly(_ value: Bool) {
    displayOnly = value
    input.isEditable = !value
    input.isScrollEnabled = !value
    input.textContainerInset = value ? .zero : UIEdgeInsets(top: 11, left: 7, bottom: 11, right: 7)
    input.textContainer.lineFragmentPadding = value ? 0 : 5
    input.accessibilityLabel = value ? nil : "Message"
    input.accessibilityIdentifier = value ? "User message" : "Message"
    if let content = pending { apply(content, forceStyle: true) }
    measure()
  }
  func receive(_ content: ComposerContentRecord) {
    guard content.eventCount >= eventCount else { return }
    pending = content
    // Leave IME marked text alone. Apply only when composition has committed.
    guard input.markedTextRange == nil else { return }
    apply(content)
  }
  func readText() -> [String: Any] {
    input.unmarkText()
    return ["text": input.source(), "eventCount": eventCount, "revision": revision ?? ""]
  }
  private func apply(_ content: ComposerContentRecord, forceStyle: Bool = false) {
    let source = input.source()
    let external = revision != content.revision
    guard external || source == content.text else { return }
    revision = content.revision
    if external { projectionUndoSource = nil }
    // Do not recreate an autoformat step that the user has just undone.
    if !external && projectionUndoSource == source { return }
    if !forceStyle && source == content.text && matches(content.references) && !displayOnly {
      restoreTypingStyle()
      placeholder.isHidden = !source.isEmpty
      measure()
      return
    }
    let selected = input.selectedRange
    let start = external ? (content.text as NSString).length : input.sourceOffset(selected.location)
    let end = external ? start : input.sourceOffset(NSMaxRange(selected))
    changing = true
    defer { changing = false }
    let text = NSMutableAttributedString(string: content.text, attributes: textAttributes)
    let length = text.length
    if displayOnly {
      for link in content.links {
        guard link.start >= 0, link.end > link.start, link.end <= length,
          let url = URL(string: link.url) else { continue }
        text.addAttribute(.link, value: url, range: NSRange(location: link.start, length: link.end - link.start))
      }
    }
    var nextStart = length
    for reference in content.references.reversed() {
      guard reference.start >= 0, reference.end > reference.start, reference.end <= nextStart else { continue }
      let range = NSRange(location: reference.start, length: reference.end - reference.start)
      let source = (content.text as NSString).substring(with: range)
      let chip = ReferenceAttachment(source: source, label: reference.label,
        foreground: foreground, background: chipColor, font: font, icon: reference.icon, iconTemplate: reference.iconTemplate)
      // UIKit inherits attributes from the adjacent attachment when moving the caret.
      // Give the attachment the same base style as text, even though it draws its own image.
      let attachment = NSMutableAttributedString(attachment: chip)
      attachment.addAttributes(textAttributes, range: NSRange(location: 0, length: attachment.length))
      text.replaceCharacters(in: range, with: attachment)
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
      restoreTypingStyle()
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
      view.restoreTypingStyle()
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
      value.0 == reference.start && value.1 == reference.end && value.2 == reference.label && value.3 == reference.icon && value.4 == reference.iconTemplate
    }
  }
  func refreshStyle() {
    input.textColor = foreground
    restoreTypingStyle()
    if let content = pending, content.text == input.source(), input.markedTextRange == nil { apply(content, forceStyle: true) }
  }
  func textViewDidChange(_ textView: UITextView) {
    guard !changing else { return }
    restoreTypingStyle()
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
    restoreTypingStyle()
    selection()
    if input.markedTextRange == nil, let content = pending, content.eventCount >= eventCount { apply(content) }
  }
  private func selection() {
    onSourceSelection(["start": input.sourceOffset(input.selectedRange.location), "end": input.sourceOffset(NSMaxRange(input.selectedRange))])
  }
  func textViewDidBeginEditing(_ textView: UITextView) { restoreTypingStyle(); Self.active = self; onFocus([:]) }
  func textViewDidEndEditing(_ textView: UITextView) { if Self.active === self { Self.active = nil }; onBlur([:]) }
  func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange,
    interaction: UITextItemInteraction) -> Bool {
    guard displayOnly else { return true }
    // Route both a tap and the long-press menu through the existing app link chooser.
    onLink(["url": URL.absoluteString])
    return false
  }
  private func measure() {
    guard bounds.width > 0 else { return }
    let next = ceil(input.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height)
    if next != height { height = next; onSize(["height": next]) }
  }
}
