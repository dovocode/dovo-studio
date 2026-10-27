import UIKit
import WebKit

/// One native browser tab. Pages get no script message handlers, so untrusted content has no
/// path into the app, and the tab never answers authentication challenges with credentials.
@available(iOS 17.0, *)
@MainActor
final class BrowserTab: NSObject, WKNavigationDelegate, WKUIDelegate {
  let id: String
  let profileId: String
  let openerTabId: String?
  /// Unique per native tab, so JS can tell a reopened tabId from late events of the old tab.
  let instanceId = UUID().uuidString.lowercased()
  let webView: WKWebView
  private(set) var loadState = "idle"
  private(set) var lastError: String?
  private var observations: [NSKeyValueObservation] = []
  private var updateScheduled = false
  private var closed = false
  private var appActive = UIApplication.shared.applicationState == .active
  private var processLost = false
  private var automaticRecoveryUsed = false
  /// A reclaimed page waits for its visible, foreground host before one automatic reload.
  private(set) var reloadWhenShown = false
  weak var engine: BrowserEngine?

  init(id: String, profileId: String, openerTabId: String?, configuration: WKWebViewConfiguration, engine: BrowserEngine) {
    self.id = id
    self.profileId = profileId
    self.openerTabId = openerTabId
    self.engine = engine
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsLinkPreview = false
    observe(\.title, "title")
    observe(\.url, "url")
    observe(\.isLoading, "loading")
    observe(\.estimatedProgress, "progress")
    observe(\.canGoBack, "history")
    observe(\.canGoForward, "history")
    observe(\.hasOnlySecureContent, "secure")
    NotificationCenter.default.addObserver(self, selector: #selector(applicationBecameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(applicationResignedActive), name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(applicationBecameActive), name: UIScene.didActivateNotification, object: nil)
  }

  private func observe<Value>(_ path: KeyPath<WKWebView, Value>, _ change: String) {
    observations.append(webView.observe(path, options: [.new]) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.scheduleUpdate(change) }
    })
  }

  private func scheduleUpdate(_ change: String) {
    guard !closed else { return }
    if change == "loading" && !processLost {
      if webView.isLoading { loadState = "loading"; lastError = nil } else if loadState == "loading" { loadState = "loaded" }
    }
    guard !updateScheduled else { return }
    updateScheduled = true
    DispatchQueue.main.async { [weak self] in
      MainActor.assumeIsolated {
        guard let self, !self.closed else { return }
        self.updateScheduled = false
        self.engine?.tabDidUpdate(self)
      }
    }
  }

  var state: [String: Any] {
    [
      "tabId": id,
      "instanceId": instanceId,
      "profileId": profileId,
      "openerTabId": openerTabId as Any,
      "url": webView.url?.absoluteString as Any,
      "title": webView.title ?? "",
      "loadState": loadState,
      "progress": webView.estimatedProgress,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward,
      "secure": webView.url?.scheme?.lowercased() == "https" && webView.hasOnlySecureContent,
      "error": lastError as Any,
    ]
  }

  private func resetRecovery() {
    automaticRecoveryUsed = false
    reloadWhenShown = false
    processLost = false
    lastError = nil
  }

  func load(_ url: URL) {
    guard !closed else { return }
    resetRecovery()
    webView.load(URLRequest(url: url))
  }

  func reload() {
    guard !closed else { return }
    resetRecovery()
    webView.reload()
  }

  func goBack() {
    guard !closed, webView.canGoBack else { return }
    resetRecovery()
    webView.goBack()
  }

  func goForward() {
    guard !closed, webView.canGoForward else { return }
    resetRecovery()
    webView.goForward()
  }

  func close() {
    guard !closed else { return }
    closed = true
    reloadWhenShown = false
    NotificationCenter.default.removeObserver(self)
    observations.forEach { $0.invalidate() }
    observations = []
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.removeFromSuperview()
  }

  /// Reads `getSelection()` (or the selected part of a focused text field) from an isolated
  /// world so page scripts cannot observe or intercept the call.
  func selection(completion: @escaping (Result<(String, Bool), Error>) -> Void) {
    var finished = false
    let finish: (Result<(String, Bool), Error>) -> Void = { result in
      guard !finished else { return }
      finished = true
      completion(result)
    }
    let limit = BrowserLimits.selectionLimit + 1
    let script = """
      (() => {
        const active = document.activeElement;
        let text = '';
        if (active instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'email'].includes(active.type)) return '';

        if (active && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
            typeof active.selectionStart === 'number' && active.type !== 'password') {
          text = active.value.slice(active.selectionStart, active.selectionEnd ?? active.selectionStart);
        } else {
          const selection = window.getSelection();
          text = selection ? selection.toString() : '';
        }
        return text.length > \(limit) ? text.slice(0, \(limit)) : text;
      })()
      """
    webView.evaluateJavaScript(script, in: nil, in: WKContentWorld.world(name: "dovo-browser-selection")) { result in
      switch result {
      case .success(let value): finish(.success(clampSelection(value as? String ?? "")))
      case .failure(let error): finish(.failure(error))
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + BrowserLimits.selectionTimeout) {
      finish(.failure(BrowserError(code: "ERR_TIMEOUT", message: "Reading the selection timed out.")))
    }
  }

  // MARK: WKNavigationDelegate

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    guard !closed, webView === self.webView, !processLost,
      let url = navigationAction.request.url, let scheme = url.scheme?.lowercased()
    else { return decisionHandler(.cancel) }
    let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
    switch scheme {
    case "http", "https", "about", "blob":
      // A new user navigation gets its own recovery budget. Redirects and the automatic
      // reload (.reload) must not replenish it, otherwise a crashing page loops forever.
      if mainFrame && [.linkActivated, .formSubmitted, .formResubmitted, .backForward].contains(navigationAction.navigationType) {
        resetRecovery()
      }
      decisionHandler(.allow)
    case "data":
      // Top-level data: navigations are a phishing vector; subframes keep working.
      decisionHandler(mainFrame ? .cancel : .allow)
    default:
      decisionHandler(.cancel)
      if mainFrame { engine?.emit("onExternalUrlBlocked", ["tabId": id, "url": String(url.absoluteString.prefix(BrowserLimits.maxUrlLength))]) }
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !closed, !processLost, webView === self.webView else { return }
    loadState = "loaded"
    scheduleUpdate("loading")
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard !closed, webView === self.webView else { return }
    processLost = true
    if automaticRecoveryUsed {
      reloadWhenShown = false
      loadState = "failed"
      lastError = "The page stopped responding again. Reload the page to try again."
    } else {
      reloadWhenShown = true
      loadState = "idle"
      lastError = "The page was unloaded to save memory and reloads when shown."
      recoverWhenVisible()
    }
    scheduleUpdate("loading")
  }

  /// A window can stay attached while the app is backgrounded or its containing view hidden.
  private var visibleInForeground: Bool {
    guard appActive, UIApplication.shared.applicationState == .active,
      let window = webView.window, window.windowScene?.activationState == .foregroundActive
    else { return false }
    var view: UIView? = webView
    while let current = view {
      if current.isHidden || current.alpha == 0 { return false }
      view = current.superview
    }
    return true
  }

  private func recoverWhenVisible() {
    guard !closed, reloadWhenShown, visibleInForeground else { return }
    reloadWhenShown = false
    automaticRecoveryUsed = true
    processLost = false
    loadState = "loading"
    lastError = nil
    webView.reload()
  }

  @objc private func applicationResignedActive() {
    appActive = false
  }

  @objc private func applicationBecameActive() {
    appActive = true
    recoverWhenVisible()
  }

  func didMoveToHost() {
    recoverWhenVisible()
  }

  private func fail(_ error: Error) {
    guard !closed, !processLost else { return }
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
    // Frame load interrupted by policy change (WebKit error 102) follows a cancelled navigation.
    if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
    loadState = "failed"
    lastError = nsError.localizedDescription
    scheduleUpdate("loading")
  }

  // MARK: WKUIDelegate

  /// target=_blank links, window.open (including OAuth popups).
  /// The returned web view must use WebKit's configuration so it shares the opener's profile data
  /// store and window.opener relationship.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let engine else { return nil }
    if let scheme = navigationAction.request.url?.scheme?.lowercased(), !["http", "https", "about", "blob"].contains(scheme) {
      return nil
    }
    let reason = navigationAction.navigationType == .linkActivated ? "targetBlank" : "windowOpen"
    return engine.openChildTab(opener: self, configuration: configuration, reason: reason)?.webView
  }

  func webViewDidClose(_ webView: WKWebView) {
    engine?.closeTabFromPage(id, instanceId: instanceId, reason: "page")
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void
  ) {
    // Background tabs cannot raise dialogs over whatever the user is looking at.
    guard webView.window != nil, let engine else { return completionHandler() }
    engine.presentDialog(title: frame.request.url?.host ?? "", message: message, cancellable: false) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void
  ) {
    guard webView.window != nil, let engine else { return completionHandler(false) }
    engine.presentDialog(title: frame.request.url?.host ?? "", message: message, cancellable: true) { completionHandler($0) }
  }
  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor (String?) -> Void
  ) {
    guard webView.window != nil, let engine else { return completionHandler(nil) }
    engine.presentPrompt(title: frame.request.url?.host ?? "", message: prompt, defaultText: defaultText, completion: completionHandler)
  }

}
