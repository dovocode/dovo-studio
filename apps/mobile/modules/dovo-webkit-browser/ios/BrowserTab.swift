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
  }

  private func observe<Value>(_ path: KeyPath<WKWebView, Value>, _ change: String) {
    observations.append(webView.observe(path, options: [.new]) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.scheduleUpdate(change) }
    })
  }

  private func scheduleUpdate(_ change: String) {
    if change == "loading" {
      if webView.isLoading { loadState = "loading"; lastError = nil } else if loadState == "loading" { loadState = "loaded" }
    }
    guard !updateScheduled else { return }
    updateScheduled = true
    DispatchQueue.main.async { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
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

  func load(_ url: URL) {
    lastError = nil
    webView.load(URLRequest(url: url))
  }

  func close() {
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
    guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
    let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
    switch scheme {
    case "http", "https", "about", "blob":
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
    loadState = "loaded"
    scheduleUpdate("loading")
  }

  /// Set when iOS reclaimed the content process of a tab that was not on screen.
  private(set) var reloadWhenShown = false

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView.window != nil else {
      // Reloading every background tab would bring the memory pressure straight back.
      reloadWhenShown = true
      loadState = "idle"
      lastError = "The page was unloaded to save memory and reloads when shown."
      scheduleUpdate("loading")
      return
    }
    lastError = "The page stopped responding and was reloaded."
    webView.reload()
  }

  func didMoveToHost() {
    guard reloadWhenShown else { return }
    reloadWhenShown = false
    lastError = nil
    webView.reload()
  }

  private func fail(_ error: Error) {
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
