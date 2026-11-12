import UIKit

// Only the Expo bridge is replaced. The production UITextView, attachments and view logic run
// unchanged on UIKit. The separate pod build verifies the real Expo API and module registration.
typealias AppContext = NSObject
class ExpoView: UIView {
  required init(appContext: AppContext? = nil) { super.init(frame: .zero) }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
}
var bridgeEvents: [[String: Any]] = []
struct EventDispatcher {
  func callAsFunction(_ event: [String: Any]) {
    bridgeEvents.append(event)
    if event["url"] != nil {
      let events = bridgeEvents.filter { $0["url"] != nil }
      let report = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("composer-link-events.json")
      try! JSONSerialization.data(withJSONObject: events).write(to: report)
    }
  }
}

@main class Harness: UIResponder, UIApplicationDelegate {}

@objc(HarnessScene) class HarnessScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    DispatchQueue.main.async { self.check(controller.view) }
  }
  func check(_ surface: UIView) {
    var failures: [String] = []
    var checks = 0
    func expect(_ result: @autoclosure () -> Bool, _ message: String) {
      checks += 1
      if !result() { failures.append(message) }
    }
    let view = DovoComposerInputView()
    view.frame = CGRect(x: 16, y: 120, width: 350, height: 144)
    surface.addSubview(view)
    view.layoutIfNeeded()
    let source = "🚀 Read @src/file.ts and `model:codex/gpt` please"
    let nsSource = source as NSString
    let fileRange = nsSource.range(of: "@src/file.ts")
    let modelRange = nsSource.range(of: "`model:codex/gpt`")
    let file = ComposerReferenceRecord(start: fileRange.location, end: NSMaxRange(fileRange), kind: "file", label: "file.ts")
    let model = ComposerReferenceRecord(start: modelRange.location, end: NSMaxRange(modelRange), kind: "model", label: "gpt", icon: "__HARNESS_ICON_PNG__")
    view.receive(ComposerContentRecord(text: source, revision: "initial", eventCount: 0, references: [file, model]))
    let input = view.input
    let snapshotView = DovoComposerInputView()
    snapshotView.frame = CGRect(x: 0, y: 0, width: 350, height: 120)
    surface.addSubview(snapshotView)
    snapshotView.receive(ComposerContentRecord(text: source, revision: "snapshot", eventCount: 0, references: [file, model]))
    snapshotView.input.becomeFirstResponder()
    snapshotView.input.selectedRange = NSRange(location: snapshotView.input.textStorage.length, length: 0)
    snapshotView.input.insertText(" complete 🚀")
    snapshotView.input.setMarkedText("に", selectedRange: NSRange(location: 1, length: 0))
    let completeSource = snapshotView.input.source()
    let snapshot = snapshotView.readText()
    expect(snapshot["text"] as? String == completeSource, "Send snapshot lost pending typing or chip source")
    expect(snapshotView.input.markedTextRange == nil, "Send snapshot did not commit IME composition")
    expect(snapshot["revision"] as? String == "snapshot", "Send snapshot lost draft identity")
    let snapshotCount = snapshot["eventCount"] as? Int ?? -1
    expect(snapshotCount > 0, "Send snapshot did not acknowledge native events")
    snapshotView.receive(ComposerContentRecord(text: "", revision: "sent", eventCount: snapshotCount, references: []))
    expect(snapshotView.input.source().isEmpty, "Acknowledged send left text in the composer")
    snapshotView.removeFromSuperview()
    let modelChip = input.textStorage.attribute(.attachment, at: input.displayOffset(modelRange.location), effectiveRange: nil) as? ReferenceAttachment
    let plainModel = ReferenceAttachment(source: "`model:codex/gpt`", label: "gpt", foreground: .label, background: .secondarySystemBackground, font: .preferredFont(forTextStyle: .body))
    expect(modelChip?.image != nil && modelChip!.bounds.width == plainModel.bounds.width + 20, "Model icon did not reserve drawing space")
    expect(modelChip?.icon == model.icon && modelChip?.iconTemplate == true, "Model icon did not reach attachment")
    expect(modelChip?.label == "gpt", "Model chip has a redundant type prefix")
    view.foreground = .systemBlue
    view.refreshStyle()
    expect(input.source() == source, "Icon theme update changed source")
    expect(input.source() == source, "Initial reference source changed")
    expect(input.textStorage.length == nsSource.length - fileRange.length - modelRange.length + 2, "References did not collapse into attachments")
    expect(input.sourceOffset(input.displayOffset(fileRange.location)) == fileRange.location, "UTF-16 chip start mapping failed")
    expect(input.sourceOffset(input.displayOffset(NSMaxRange(fileRange))) == NSMaxRange(fileRange), "Chip end mapping failed")
    input.selectedRange = NSRange(location: input.displayOffset(fileRange.location), length: 1)
    input.copy(nil)
    expect(UIPasteboard.general.string == "@src/file.ts", "Copy lost the complete path")
    input.selectedRange = NSRange(location: 0, length: input.textStorage.length)
    input.copy(nil)
    expect(UIPasteboard.general.string == source, "Copy lost reference Markdown or Unicode")
    input.becomeFirstResponder()
    input.selectedRange = NSRange(location: input.textStorage.length, length: 0)
    input.insertText("!")
    expect(input.source() == source + "!", "Typing changed reference source")
    let count = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
    expect(count > 0, "Typing did not reach the bridge")
    view.receive(ComposerContentRecord(text: "stale", revision: "old", eventCount: 0, references: []))
    expect(input.source() == source + "!", "Stale JS update replaced newer native typing")
    view.receive(ComposerContentRecord(text: source + "!", revision: "initial", eventCount: count, references: [file, model]))
    input.selectedRange = NSRange(location: input.displayOffset(NSMaxRange(fileRange)), length: 0)
    input.undoManager?.removeAllActions()
    input.deleteBackward()
    let withoutFile = nsSource.replacingCharacters(in: fileRange, with: "") + "!"
    expect(input.source() == withoutFile, "Backspace did not delete one complete reference")
    input.undoManager?.undo()
    expect(input.source() == source + "!", "Undo did not restore deleted reference: \(input.source())")
    input.selectedRange = NSRange(location: input.textStorage.length, length: 0)
    UIPasteboard.general.string = " pasted 🚀"
    input.paste(nil)
    expect(input.source().hasSuffix(" pasted 🚀"), "Paste lost text or Unicode")
    let composed = input.source()
    input.setMarkedText("に", selectedRange: NSRange(location: 1, length: 0))
    let marked = input.source()
    let latestCount = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? count
    view.receive(ComposerContentRecord(text: composed, revision: "composition", eventCount: latestCount, references: []))
    expect(input.markedTextRange != nil && input.source() == marked, "JS update interrupted IME composition")
    input.unmarkText()
    let beforeTokenCount = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
    view.receive(ComposerContentRecord(text: "@src/file.ts", revision: "token", eventCount: beforeTokenCount, references: []))
    input.undoManager?.removeAllActions()
    input.selectedRange = NSRange(location: input.textStorage.length, length: 0)
    input.insertText(" ")
    let tokenCount = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
    let token = ComposerReferenceRecord(start: 0, end: 12, kind: "file", label: "file.ts")
    view.receive(ComposerContentRecord(text: "@src/file.ts ", revision: "token", eventCount: tokenCount, references: [token]))
    expect(input.textStorage.length == 2, "Typed reference did not become a chip")
    input.undoManager?.undo()
    expect(input.source() == "@src/file.ts", "Undo after chip conversion lost text: \(input.source())")
    input.undoManager?.redo()
    expect(input.source() == "@src/file.ts ", "Redo after chip conversion lost text: \(input.source())")
    // Run a second conversion on a later run-loop turn, as the real JS bridge does.
    DispatchQueue.main.async {
      let latest = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
      view.receive(ComposerContentRecord(text: "@src/file.ts", revision: "async-token", eventCount: latest, references: []))
      input.undoManager?.removeAllActions()
      input.selectedRange = NSRange(location: input.textStorage.length, length: 0)
      input.insertText(" ")
      DispatchQueue.main.async {
        let count = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
        let content = ComposerContentRecord(text: "@src/file.ts ", revision: "async-token", eventCount: count, references: [token])
        view.receive(content)
        DispatchQueue.main.async {
          input.undoManager?.undo()
          expect(input.source() == "@src/file.ts ", "First async undo changed source while undoing formatting")
          view.receive(content)
          expect(input.textStorage.length == 13, "Bridge reapplied an undone chip conversion")
          input.undoManager?.undo()
          expect(input.source() == "@src/file.ts", "Async typing undo lost source: \(input.source())")
          // Use a non-default color so UIKit's small black fallback cannot pass unnoticed.
          let styled = DovoComposerInputView()
          styled.frame = CGRect(x: 16, y: 280, width: 350, height: 80)
          styled.foreground = .systemPurple
          surface.addSubview(styled)
          styled.layoutIfNeeded()
          let styledInput = styled.input
          let bodyFont = UIFont.preferredFont(forTextStyle: .body)
          func expectTypingStyle(_ operation: String) {
            expect((styledInput.typingAttributes[.font] as? UIFont) == bodyFont, "\(operation) lost the typing font")
            expect((styledInput.typingAttributes[.foregroundColor] as? UIColor) == styled.foreground, "\(operation) lost the typing color")
            if styledInput.textStorage.length > 0 {
              let attributes = styledInput.textStorage.attributes(at: styledInput.textStorage.length - 1, effectiveRange: nil)
              expect((attributes[.font] as? UIFont) == bodyFont, "\(operation) inserted the wrong font")
              expect((attributes[.foregroundColor] as? UIColor) == styled.foreground, "\(operation) inserted the wrong color")
            }
          }
          styled.receive(ComposerContentRecord(text: "@src/file.ts", revision: "style", references: [token]))
          styledInput.becomeFirstResponder()
          styledInput.selectedRange = NSRange(location: 1, length: 0)
          expectTypingStyle("Caret after chip")
          styledInput.insertText("x")
          expectTypingStyle("Typing after chip")
          let styleCount = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
          styled.receive(ComposerContentRecord(text: "@src/file.ts", revision: "delete-style", eventCount: styleCount, references: [token]))
          styledInput.selectedRange = NSRange(location: 1, length: 0)
          styledInput.deleteBackward()
          expect(styledInput.source().isEmpty, "Sole chip deletion left text behind")
          expectTypingStyle("Deleting the last chip")
          styledInput.insertText("After")
          expectTypingStyle("Typing before the deletion reaches JS")
          styledInput.selectedRange = NSRange(location: 0, length: styledInput.textStorage.length)
          styledInput.deleteBackward()
          UIPasteboard.general.string = "Pasted"
          styledInput.paste(nil)
          expectTypingStyle("Pasting into the cleared composer")
          styledInput.resignFirstResponder()
          styled.removeFromSuperview()
          let message = DovoComposerInputView()
          message.frame = CGRect(x: 16, y: 300, width: 230, height: 200)
          surface.addSubview(message)
          message.setDisplayOnly(true)
          let url = "https://github.com/team/repo/pull/42"
          let sent = "🚀 Read @src/file.ts\n" + url
          let sentText = sent as NSString
          let sentFile = sentText.range(of: "@src/file.ts")
          let sentLink = sentText.range(of: url)
          message.receive(ComposerContentRecord(text: sent, revision: "sent", references: [
            ComposerReferenceRecord(start: sentFile.location, end: NSMaxRange(sentFile), kind: "file", label: "file.ts")
          ], links: [ComposerLinkRecord(start: sentLink.location, end: NSMaxRange(sentLink), url: url)]))
          message.layoutIfNeeded()
          expect(!message.input.isEditable && message.input.isSelectable, "Sent message must be read-only and selectable")
          expect(!message.input.isScrollEnabled && message.input.textContainerInset == .zero, "Sent message retained input scroll or padding")
          expect(message.input.source() == sent, "Sent message projection changed source")
          message.input.selectedRange = NSRange(location: 0, length: message.input.textStorage.length)
          message.input.copy(nil)
          expect(UIPasteboard.general.string == sent, "Sent message copy lost source")
          let displayLink = message.input.displayOffset(sentLink.location)
          expect((message.input.textStorage.attribute(.link, at: displayLink, effectiveRange: nil) as? URL)?.absoluteString == url, "PR link shifted after chip projection")
          for interaction in [UITextItemInteraction.invokeDefaultAction, .presentActions] {
            let handled = message.textView(message.input, shouldInteractWith: URL(string: url)!,
              in: NSRange(location: displayLink, length: sentLink.length), interaction: interaction)
            expect(!handled && bridgeEvents.last?["url"] as? String == url, "Sent PR link did not use app chooser")
          }
          message.messageFontSize = 30
          message.messageLineHeight = 44
          message.refreshStyle()
          expect((message.input.textStorage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)?.pointSize == 30,
            "Sent message did not apply scaled text size")
          let scaledChip = message.input.textStorage.attribute(.attachment,
            at: message.input.displayOffset(sentFile.location), effectiveRange: nil) as? ReferenceAttachment
          expect((scaledChip?.bounds.height ?? 0) >= UIFont.systemFont(ofSize: 30).lineHeight,
            "Scaled chip clipped its label")
          expect(message.input.source() == sent, "Scaling a sent message changed source")
          message.messageFontSize = 17
          message.messageLineHeight = 25
          message.refreshStyle()
          let sentLabel = UILabel(frame: CGRect(x: 16, y: 275, width: 300, height: 22))
          sentLabel.text = "Sent user message"
          sentLabel.font = .preferredFont(forTextStyle: .caption1)
          surface.addSubview(sentLabel)
          let report: [String: Any] = ["checks": checks, "failures": failures]
          let reportURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("composer-results.json")
          try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: reportURL)
          let label = UILabel(frame: CGRect(x: 16, y: 60, width: 360, height: 44))
          label.text = "\(checks) checks · \(failures.count) failures"
          label.textColor = failures.isEmpty ? .systemGreen : .systemRed
          surface.addSubview(label)
          let preview = "Review @src/App.tsx and @package.json with $review and @docs using `model:harness%3Acodex/gpt-6.1-sol`"
          view.foreground = .label
          let previewText = preview as NSString
          let examples = [
            ("@src/App.tsx", "file", "App.tsx", "__REFERENCE_ICON_file-code__"),
            ("@package.json", "file", "package.json", "__REFERENCE_ICON_file-data__"),
            ("$review", "skill", "review", "__REFERENCE_ICON_skill__"),
            ("@docs", "mcp", "docs", "__REFERENCE_ICON_mcp__"),
            ("`model:harness%3Acodex/gpt-6.1-sol`", "model", "gpt-6.1-sol", "__HARNESS_ICON_PNG__"),
          ]
          let references = examples.map { token, kind, title, icon in
            let range = previewText.range(of: token)
            return ComposerReferenceRecord(start: range.location, end: NSMaxRange(range), kind: kind, label: title, icon: icon)
          }
          let finalCount = bridgeEvents.compactMap { $0["eventCount"] as? Int }.max() ?? 0
          view.receive(ComposerContentRecord(text: preview, revision: "visual-preview", eventCount: finalCount, references: references))
          input.resignFirstResponder()
        }
      }
    }
  }
}
