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
  func callAsFunction(_ event: [String: Any]) { bridgeEvents.append(event) }
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
          let report: [String: Any] = ["checks": checks, "failures": failures]
          let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("composer-results.json")
          try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: url)
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
