import ExpoModulesCore
import UIKit
import WebKit

public final class DovoKeyboardCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoKeyboardCommands")
    View(DovoKeyboardCommandsView.self) {
      Prop("enabledCommands") { (view: DovoKeyboardCommandsView, commands: [String]) in
        view.enabledCommands = Set(commands)
      }
      Events("onCommand")
    }
  }
}

public final class DovoKeyboardCommandsView: ExpoView {
  let onCommand = EventDispatcher()
  var enabledCommands = Set<String>()
  private let emptyInputView = UIView(frame: .zero)

  public override var canBecomeFirstResponder: Bool { true }
  public override var inputView: UIView? { emptyInputView }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    inputAssistantItem.leadingBarButtonGroups = []
    inputAssistantItem.trailingBarButtonGroups = []
    for name in [UITextView.textDidEndEditingNotification, UITextField.textDidEndEditingNotification, UIApplication.didBecomeActiveNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(reclaimResponder), name: name, object: nil)
    }
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    reclaimResponder()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    reclaimResponder()
  }

  @objc private func reclaimResponder() {
    DispatchQueue.main.async { [weak self] in
      guard let self, let window = self.window, window.isKeyWindow,
        window.rootViewController?.presentedViewController == nil,
        window.dovoFirstResponder == nil else { return }
      self.becomeFirstResponder()
    }
  }

  public override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    guard let window, window.isKeyWindow,
      window.rootViewController?.presentedViewController == nil else { return false }
    if let responder = window.dovoFirstResponder, responder !== self {
      if responder is UITextInput { return false }
      if let view = responder as? UIView {
        var ancestor: UIView? = view
        while let current = ancestor {
          if current is WKWebView { return false }
          ancestor = current.superview
        }
      }
    }
    return super.canPerformAction(action, withSender: sender)
  }

  public override var keyCommands: [UIKeyCommand]? {
    [
      command("search", input: "f", action: #selector(search), title: "Search threads"),
      command("newThread", input: "n", action: #selector(newThread), title: "New thread"),
      command("back", input: "[", action: #selector(back), title: "Back"),
    ].compactMap { $0 }
  }

  private func command(_ identifier: String, input: String, action: Selector, title: String) -> UIKeyCommand? {
    guard enabledCommands.contains(identifier) else { return nil }
    let result = UIKeyCommand(input: input, modifierFlags: .command, action: action)
    result.discoverabilityTitle = title
    return result
  }

  @objc private func search() { onCommand(["command": "search"]) }
  @objc private func newThread() { onCommand(["command": "newThread"]) }
  @objc private func back() { onCommand(["command": "back"]) }
}

private extension UIView {
  var dovoFirstResponder: UIResponder? {
    if isFirstResponder { return self }
    for subview in subviews {
      if let responder = subview.dovoFirstResponder { return responder }
    }
    return nil
  }
}
