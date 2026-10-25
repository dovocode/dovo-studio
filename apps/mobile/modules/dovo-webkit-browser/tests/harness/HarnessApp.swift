import UIKit
import WebKit

// Simulator harness: compiles the module's core Swift files (everything except the Expo wrapper)
// into a standalone app, then drives real WKWebView tabs and WKWebExtension contexts.
// Phase 1 installs and exercises; phase 2 runs after a process restart to check persistence.

@main
final class HarnessApp: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Default", sessionRole: session.role)
    configuration.delegateClass = HarnessSceneDelegate.self
    return configuration
  }
}

final class HarnessSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    let host = BrowserHostView(frame: controller.view.bounds)
    host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.addSubview(host)
    let defaults = UserDefaults.standard
    let phase = defaults.integer(forKey: "phase")
    let port = defaults.integer(forKey: "port")
    Task { @MainActor in
      let harness = Harness(port: port, host: host)
      await harness.run(phase: phase)
      exit(harness.failures == 0 ? 0 : 1)
    }
  }
}

@MainActor
final class Harness {
  let port: Int
  let host: BrowserHostView
  let engine = BrowserEngine.shared
  var failures = 0
  var passes = 0
  var events: [(String, [String: Any])] = []

  init(port: Int, host: BrowserHostView) {
    self.port = port
    self.host = host
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    engine.storage = BrowserStorage(root: documents.appendingPathComponent("dwb-harness", isDirectory: true))
    engine.emitter = { [weak self] name, body in self?.events.append((name, body)) }
  }

  func url(_ path: String, host: String = "127.0.0.1") -> String { "http://\(host):\(port)/\(path)" }

  func check(_ name: String, _ condition: Bool, _ detail: Any = "") {
    if condition { passes += 1 } else { failures += 1 }
    print("DWB-CHECK \(condition ? "PASS" : "FAIL") \(name) \(condition ? "" : String(describing: detail))")
    fflush(stdout)
  }

  func wait(_ seconds: Double = 10, _ condition: () async -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      if await condition() { return true }
      try? await Task.sleep(nanoseconds: 100_000_000)
    }
    return await condition()
  }

  /// Test-only page-world evaluation; production tabs never expose this to JS callers.
  func page(_ tab: BrowserTab, _ script: String) async -> String {
    await withCheckedContinuation { continuation in
      tab.webView.evaluateJavaScript("String((() => { \(script) })())") { value, error in
        continuation.resume(returning: (value as? String) ?? "error: \(error?.localizedDescription ?? "nil")")
      }
    }
  }

  func loaded(_ tab: BrowserTab) async -> Bool {
    let start = Date()
    let done = await wait(30) { tab.loadState == "loaded" && !tab.webView.isLoading }
    print("DWB-LOAD \(tab.id) \(tab.webView.url?.absoluteString ?? "-") \(String(format: "%.2f", Date().timeIntervalSince(start)))s \(done)")
    return done
  }

  func attr(_ tab: BrowserTab, _ name: String) async -> String {
    await page(tab, "return document.documentElement.dataset.\(name) ?? 'absent'")
  }

  func expectError(_ name: String, code: String, _ body: () async throws -> Void) async {
    do {
      try await body()
      check(name, false, "no error thrown")
    } catch let error as BrowserError {
      check(name, error.code == code, "\(error.code): \(error.message)")
    } catch {
      check(name, false, error)
    }
  }

  func run(phase: Int) async {
    print("DWB-START phase=\(phase) port=\(port) ios=\(UIDevice.current.systemVersion)")
    do {
      if phase == 1 { try await phaseOne() } else if phase == 2 { try await phaseTwo() } else { await experiment(phase) }
    } catch {
      check("phase \(phase) threw", false, "\((error as? BrowserError)?.message ?? error.localizedDescription)")
    }
    print("DWB-DONE phase=\(phase) pass=\(passes) fail=\(failures)")
    fflush(stdout)
  }

  /// Diagnostics for first-load latency of plain WKWebViews outside the engine.
  func experiment(_ phase: Int) async {
    final class Delegate: NSObject, WKNavigationDelegate {
      var done = false
      func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done = true }
    }
    func timeLoad(_ label: String, _ store: WKWebsiteDataStore) async {
      let configuration = WKWebViewConfiguration()
      configuration.websiteDataStore = store
      let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 300, height: 300), configuration: configuration)
      let delegate = Delegate()
      webView.navigationDelegate = delegate
      host.addSubview(webView)
      let start = Date()
      webView.load(URLRequest(url: URL(string: url("other.html"))!))
      let ok = await wait(65) { delegate.done }
      print("DWB-EXP \(label) \(String(format: "%.2f", Date().timeIntervalSince(start)))s \(ok)")
      webView.removeFromSuperview()
    }
    switch phase {
    case 3: await timeLoad("default-store", .default()); await timeLoad("fresh-identifier", WKWebsiteDataStore(forIdentifier: UUID()))
    case 4: await timeLoad("fresh-identifier", WKWebsiteDataStore(forIdentifier: UUID())); await timeLoad("fresh-identifier-2", WKWebsiteDataStore(forIdentifier: UUID()))
    case 5: await timeLoad("nonpersistent", .nonPersistent()); await timeLoad("fresh-identifier", WKWebsiteDataStore(forIdentifier: UUID()))
    case 6: await showcase()
    default: break
    }
  }

  /// Visual proof for screenshots: shows a profile tab with the fixture extension injected, then its
  /// native action popup, then a second profile without the extension. Needs phase 1 state.
  func showcase() async {
    do {
      await engine.setEnabled(true)
      let extensions = try await engine.extensions("work")
      guard let extensionId = extensions.list().first?["extensionId"] as? String else { return print("DWB-SHOW no extension installed; run phase 1 first") }
      let work = try await engine.openTab(tabId: "show-work", profileId: "work", url: url("page.html"))
      host.tabId = "show-work"
      _ = await loaded(work)
      _ = await wait { await self.attr(work, "dovoFixture") == "injected" }
      try engine.activateTab("show-work")
      print("DWB-SHOW work-tab \(work.state)"); fflush(stdout)
      try? await Task.sleep(nanoseconds: 12_000_000_000)
      try extensions.performAction(extensionId, tab: work)
      _ = await wait { extensions.presentedAction?.popupWebView != nil }
      print("DWB-SHOW popup presented=\(extensions.presentedAction != nil)"); fflush(stdout)
      try? await Task.sleep(nanoseconds: 12_000_000_000)
      engine.closeExtensionPopups()
      try? await Task.sleep(nanoseconds: 1_000_000_000)
      let personal = try await engine.openTab(tabId: "show-personal", profileId: "personal", url: url("page.html"))
      host.tabId = "show-personal"
      _ = await loaded(personal)
      print("DWB-SHOW personal-tab injected=\(await attr(personal, "dovoFixture"))"); fflush(stdout)
      try? await Task.sleep(nanoseconds: 12_000_000_000)
      await engine.setEnabled(false)
    } catch {
      print("DWB-SHOW error \(error)")
    }
  }

  func selectorChecks() {
    let delegateSelectors = [
      "webExtensionController:openWindowsForExtensionContext:",
      "webExtensionController:focusedWindowForExtensionContext:",
      "webExtensionController:openNewTabUsingConfiguration:forExtensionContext:completionHandler:",
      "webExtensionController:openOptionsPageForExtensionContext:completionHandler:",
      "webExtensionController:promptForPermissions:inTab:forExtensionContext:completionHandler:",
      "webExtensionController:promptForPermissionToAccessURLs:inTab:forExtensionContext:completionHandler:",
      "webExtensionController:promptForPermissionMatchPatterns:inTab:forExtensionContext:completionHandler:",
      "webExtensionController:didUpdateAction:forExtensionContext:",
      "webExtensionController:presentPopupForAction:forExtensionContext:completionHandler:",
    ]
    for selector in delegateSelectors {
      check("delegate responds to \(selector)", ProfileExtensions.instancesRespond(to: NSSelectorFromString(selector)))
    }
    for selector in ["sendMessage:toApplicationWithIdentifier:", "connectUsingMessagePort:"] {
      check("native messaging not implemented (\(selector))", !ProfileExtensions.instancesRespond(to: NSSelectorFromString("webExtensionController:\(selector)forExtensionContext:replyHandler:")) && !ProfileExtensions.instancesRespond(to: NSSelectorFromString("webExtensionController:\(selector)forExtensionContext:completionHandler:")))
    }
    let tabSelectors = [
      "windowForWebExtensionContext:", "indexInWindowForWebExtensionContext:", "parentTabForWebExtensionContext:",
      "webViewForWebExtensionContext:", "titleForWebExtensionContext:", "urlForWebExtensionContext:",
      "isLoadingCompleteForWebExtensionContext:", "isSelectedForWebExtensionContext:", "sizeForWebExtensionContext:",
      "loadURL:forWebExtensionContext:completionHandler:", "reloadFromOrigin:forWebExtensionContext:completionHandler:",
      "goBackForWebExtensionContext:completionHandler:", "goForwardForWebExtensionContext:completionHandler:",
      "activateForWebExtensionContext:completionHandler:", "closeForWebExtensionContext:completionHandler:",
      "takeSnapshotUsingConfiguration:forWebExtensionContext:completionHandler:",
    ]
    for selector in tabSelectors { check("tab responds to \(selector)", BrowserTab.instancesRespond(to: NSSelectorFromString(selector))) }
    let windowSelectors = [
      "tabsForWebExtensionContext:", "activeTabForWebExtensionContext:", "windowTypeForWebExtensionContext:",
      "windowStateForWebExtensionContext:", "isPrivateForWebExtensionContext:", "frameForWebExtensionContext:",
    ]
    for selector in windowSelectors { check("window responds to \(selector)", BrowserExtensionWindow.instancesRespond(to: NSSelectorFromString(selector))) }
  }

  func popupCheck(profile: String, extensionId: String, tab: BrowserTab, expectedCount: String) async throws {
    let extensions = try await engine.extensions(profile)
    try extensions.performAction(extensionId, tab: tab)
    let presented = await wait { extensions.presentedAction?.popupWebView != nil }
    check("action popup presented natively", presented)
    guard let popup = extensions.presentedAction?.popupWebView else { return }
    let ready = await wait {
      await withCheckedContinuation { continuation in
        popup.evaluateJavaScript("document.body?.dataset.ready ?? ''") { value, _ in continuation.resume(returning: (value as? String) == "1") }
      }
    }
    check("popup script ran", ready)
    let data: [String: String] = await withCheckedContinuation { continuation in
      popup.evaluateJavaScript("JSON.stringify(document.body.dataset)") { value, _ in
        let json = (value as? String).flatMap { $0.data(using: .utf8) }
        continuation.resume(returning: json.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:])
      }
    }
    // storage.local is shared by every tab of the profile, so other tabs may have counted further.
    check("popup reads extension storage.local", (Int(data["count"] ?? "") ?? 0) >= (Int(expectedCount) ?? 1), data)
    check("popup sees active tab through window adapter", data["activeTabUrl"] == tab.webView.url?.absoluteString, data)
    check("runtime.sendNativeMessage hidden", data["sendNativeMessage"] == "undefined", data)
    check("windows.create hidden", data["windowsCreate"] == "undefined", data)
    check("popup had no error", data["error"] == nil, data)
    engine.closeExtensionPopups()
    let closed = await wait(5) { extensions.presentedAction == nil && (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first?.rootViewController?.presentedViewController == nil }
    check("popup closed", closed)
  }

  func storageChecks() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let storage = BrowserStorage(root: root)
    defer { do { try storage.remove(root) } catch { check("storage test cleanup", false, error) } }
    func rejects(_ name: String, _ body: () throws -> Void) {
      do { try body(); check(name, false, "no error") } catch { check(name, true) }
    }
    check("missing catalogue is empty", try storage.loadProfiles().isEmpty)
    check("missing extensions are empty", try storage.loadExtensions("work").isEmpty)
    try storage.ensureDirectory(root)
    let catalogue = root.appendingPathComponent("profiles.json")
    try Data("broken".utf8).write(to: catalogue)
    rejects("corrupt catalogue surfaces error") { _ = try storage.loadProfiles() }
    let profile = ProfileRecord(profileId: "work", dataStoreIdentifier: UUID())
    try JSONEncoder().encode([profile, profile]).write(to: catalogue)
    rejects("duplicate profile rejected") { _ = try storage.loadProfiles() }
    try JSONEncoder().encode([ProfileRecord(profileId: "../escape", dataStoreIdentifier: UUID())]).write(to: catalogue)
    rejects("invalid saved profile rejected") { _ = try storage.loadProfiles() }
    try JSONEncoder().encode([profile, ProfileRecord(profileId: "other", dataStoreIdentifier: profile.dataStoreIdentifier)]).write(to: catalogue)
    rejects("duplicate data store rejected") { _ = try storage.loadProfiles() }
    let extensionDirectory = storage.extensionURL("work", "fixture")
    try storage.ensureDirectory(extensionDirectory)
    try Data("broken".utf8).write(to: extensionDirectory.appendingPathComponent("record.json"))
    rejects("corrupt extension surfaces error") { _ = try storage.loadExtensions("work") }
    rejects("extension path traversal rejected") { _ = try storage.loadExtensions("../escape") }
    rejects("credential URL rejected") { _ = try BrowserInput.pageURL("http://user:password@localhost:3000/") }
    check("HTTP remains HTTP", try BrowserInput.pageURL("http://localhost:3000/").scheme == "http")
  }

  func phaseOne() async throws {
    selectorChecks()
    try storageChecks()
    // Start clean. (Earlier runs leave orphaned stores; WKWebsiteDataStore.allDataStoreIdentifiers
    // crashes inside WebKit when called before any web view exists, so it is not used.)
    try engine.storage.remove(engine.storage.root)

    await expectError("disabled by default", code: "ERR_DISABLED") { _ = try await self.engine.openTab(tabId: "x", profileId: "work", url: nil) }
    await engine.setEnabled(true)
    await expectError("rejects invalid tab id", code: "ERR_INVALID_ARGUMENT") { _ = try await self.engine.openTab(tabId: "../x", profileId: "work", url: nil) }
    await expectError("rejects file URL", code: "ERR_INVALID_ARGUMENT") { _ = try await self.engine.openTab(tabId: "x", profileId: "work", url: "file:///etc/passwd") }
    await expectError("rejects javascript URL", code: "ERR_INVALID_ARGUMENT") { _ = try await self.engine.openTab(tabId: "x", profileId: "work", url: "javascript:alert(1)") }

    let work = try await engine.ensureProfile("work")
    let personal = try await engine.ensureProfile("personal")
    check("profiles use distinct persistent data stores", work.dataStore.identifier != nil && work.dataStore.identifier != personal.dataStore.identifier && work.dataStore.isPersistent)

    // A fresh profile without extensions must load promptly.
    let p0 = try await engine.openTab(tabId: "p0", profileId: "personal", url: url("other.html"))
    check("fresh profile first load", await loaded(p0))
    try engine.closeTab("p0")

    // Stage the fixture from the read-only app bundle into managed storage.
    let fixture = Bundle.main.bundleURL.appendingPathComponent("fixture-extension", isDirectory: true)
    let review = try await engine.stageExtension(from: fixture)
    print("DWB-REVIEW \(review)")
    let stagingId = review["stagingId"] as? String ?? ""
    check("review lists storage permission", (review["requestedPermissions"] as? [String] ?? []).contains("storage"), review)
    check("review lists host permission", (review["requestedMatchPatterns"] as? [String] ?? []).contains("http://127.0.0.1/*"), review)
    check("review flags debugger as unsupported", (review["unsupportedPermissions"] as? [String] ?? []).contains("debugger"), review)
    check("review flags nativeMessaging as refused", (review["unsupportedPermissions"] as? [String] ?? []).contains("nativeMessaging"), review)
    check("review reports popup", review["hasPopup"] as? Bool == true)
    check("staged a managed copy", FileManager.default.fileExists(atPath: engine.storage.stagingURL(stagingId).appendingPathComponent("manifest.json").path))

    await expectError("nativeMessaging cannot be granted", code: "ERR_INVALID_ARGUMENT") {
      _ = try await self.engine.installExtension(stagingId: stagingId, profileId: "work", permissions: ["storage", "nativeMessaging"], matchPatterns: [])
    }
    await expectError("unrequested host cannot be granted", code: "ERR_INVALID_ARGUMENT") {
      _ = try await self.engine.installExtension(stagingId: stagingId, profileId: "work", permissions: ["storage"], matchPatterns: ["https://example.com/*"])
    }
    let installed = try await engine.installExtension(stagingId: stagingId, profileId: "work", permissions: ["storage"], matchPatterns: ["http://127.0.0.1/*"])
    print("DWB-INSTALLED \(installed)")
    let extensionId = installed["extensionId"] as? String ?? ""
    check("installed extension loaded", installed["loaded"] as? Bool == true, installed)
    check("granted only approved permissions", (installed["grantedPermissions"] as? [String]) == ["storage"], installed)
    check("granted only approved hosts", (installed["grantedMatchPatterns"] as? [String]) == ["http://127.0.0.1/*"], installed)
    check("installed extension has no load errors", (installed["errors"] as? [String] ?? []).isEmpty, installed)
    check("extension not installed in other profile", try await engine.extensions("personal").list().isEmpty)

    // Content script in its isolated world, with persistent storage.local.
    let a1 = try await engine.openTab(tabId: "a1", profileId: "work", url: url("page.html"))
    host.tabId = "a1"
    check("work tab loaded", await loaded(a1), a1.state)
    let injected = await wait { await self.attr(a1, "dovoFixture") == "injected" }
    check("content script injected on granted host", injected, await attr(a1, "dovoFixtureError"))
    check("content script storage.local counter = 1", await attr(a1, "dovoCount") == "1", await attr(a1, "dovoCount"))
    check("content script cannot see page globals", await attr(a1, "dovoPageGlobalSeenByContent") == "undefined")
    check("page cannot see content script globals", await page(a1, "return typeof window.__dovoContentGlobal") == "undefined")
    check("chrome alias available to content script", await attr(a1, "dovoChromeAlias") == "string", await attr(a1, "dovoChromeAlias"))
    check("tab state reports title and http", a1.state["title"] as? String == "Fixture Page" && a1.state["secure"] as? Bool == false, a1.state)
    _ = await page(a1, "localStorage.setItem('profile', 'work'); document.cookie = 'dovo=work; max-age=86400; path=/'; return 'ok'")

    // Tab identity: idempotent open, cross-profile reuse of a tabId, idempotent close.
    events.removeAll()
    let again = try await engine.openTab(tabId: "a1", profileId: "work", url: url("other.html"))
    check("openTab is idempotent for same profile", again === a1 && !events.contains { $0.0 == "onTabCreated" } && a1.webView.url?.path == "/page.html")
    await expectError("openTab rejects tabId open in another profile", code: "ERR_TAB_EXISTS") { _ = try await self.engine.openTab(tabId: "a1", profileId: "personal", url: nil) }
    try engine.closeTab("does-not-exist")
    check("closeTab unknown id is a no-op", !events.contains { $0.0 == "onTabClosed" || $0.0 == "onTabCreated" }, events.map(\.0))
    let swap = try await engine.openTab(tabId: "swap", profileId: "work", url: nil)
    let oldInstance = swap.instanceId
    try engine.closeTab("swap")
    let swapped = try await engine.openTab(tabId: "swap", profileId: "personal", url: nil)
    let closed = events.first { $0.0 == "onTabClosed" }?.1 ?? [:]
    check("onTabClosed carries reason api and old instanceId", closed["reason"] as? String == "api" && closed["instanceId"] as? String == oldInstance && closed["profileId"] as? String == "work", closed)
    let closedIndex = events.firstIndex { $0.0 == "onTabClosed" } ?? -1
    let reopenedIndex = events.lastIndex { $0.0 == "onTabCreated" && $0.1["instanceId"] as? String == swapped.instanceId } ?? -1
    check("native emits close before reopen", closedIndex >= 0 && closedIndex < reopenedIndex, events.map(\.0))
    check("reopened tabId gets new instanceId and profile", swapped.instanceId != oldInstance && swapped.profileId == "personal" && swapped.state["instanceId"] as? String == swapped.instanceId)
    try engine.closeTab("swap")

    // Tab cap: 100 live tabs across profiles, then ERR_LIMIT.
    check("status reports maxTabs 100", (try engine.status())["maxTabs"] as? Int == 100)
    var bulk: [String] = []
    while engine.tabs.count < BrowserLimits.maxTabs {
      let id = "bulk-\(bulk.count)"
      _ = try await engine.openTab(tabId: id, profileId: bulk.count % 2 == 0 ? "work" : "personal", url: "about:blank")
      bulk.append(id)
    }
    check("opened up to 100 live tabs", engine.tabs.count == 100, engine.tabs.count)
    await expectError("101st tab rejected with ERR_LIMIT", code: "ERR_LIMIT") { _ = try await self.engine.openTab(tabId: "bulk-over", profileId: "work", url: nil) }
    for id in bulk { try engine.closeTab(id) }

    // Host permission enforcement: <all_urls> content script, but localhost was not granted.
    let a2 = try await engine.openTab(tabId: "a2", profileId: "work", url: url("page.html", host: "localhost"))
    check("ungranted host tab loaded", await loaded(a2))
    try? await Task.sleep(nanoseconds: 1_500_000_000)
    check("content script not injected on ungranted host", await attr(a2, "dovoFixture") == "absent", await attr(a2, "dovoFixture"))
    try engine.closeTab("a2")

    // Second profile: no extension, separate cookies and storage.
    let b1 = try await engine.openTab(tabId: "b1", profileId: "personal", url: url("page.html"))
    check("personal tab loaded", await loaded(b1))
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    check("extension absent from other profile", await attr(b1, "dovoFixture") == "absent")
    check("localStorage isolated between profiles", await page(b1, "return localStorage.getItem('profile')") == "null")
    check("cookies isolated between profiles", await page(b1, "return document.cookie.includes('dovo=work')") == "false")
    _ = await page(b1, "localStorage.setItem('profile', 'personal'); return 'ok'")

    // Selection: exact text, isolated world, UTF-16 clamp without splitting a surrogate pair.
    _ = await page(a1, "getSelection().selectAllChildren(document.getElementById('sel')); return 'ok'")
    let selection = try await engine.selection("a1")
    check("selection exact text", selection["text"] as? String == "Selected text with ünïcode 😀 and spaces" && selection["truncated"] as? Bool == false, selection)
    for type in ["password", "number", "checkbox"] {
      _ = await page(a1, "getSelection().selectAllChildren(document.getElementById('sel')); const input=document.createElement('input'); input.type='\(type)'; input.value='private'; document.body.append(input); input.focus(); return 'ok'")
      let excluded = try await engine.selection("a1")
      check("excluded input \(type) suppresses stale document selection", excluded["text"] as? String == "", excluded)
    }
    try await engine.navigateForTest("a1", url("big.html"))
    check("big page loaded", await loaded(a1))
    _ = await page(a1, "getSelection().selectAllChildren(document.getElementById('big')); return 'ok'")
    let big = try await engine.selection("a1")
    check("selection clamped to 32000 without splitting emoji", (big["text"] as? String)?.utf16.count == 31_999 && big["truncated"] as? Bool == true, (big["text"] as? String)?.utf16.count as Any)
    try await engine.navigateForTest("a1", url("page.html"))
    check("back on fixture page", await loaded(a1))
    check("can go back after navigation", a1.webView.canGoBack)

    // target=_blank keeps the opener's profile and extension controller.
    events.removeAll()
    _ = await page(a1, "document.getElementById('blank').click(); return 'ok'")
    let blankOpened = await wait { self.engine.tabs.contains { $0.openerTabId == "a1" } }
    check("target=_blank opened a native tab", blankOpened, events.map(\.0))
    if let child = engine.tabs.first(where: { $0.openerTabId == "a1" }) {
      check("target=_blank tab keeps profile", child.profileId == "work")
      check("target=_blank event reason", events.contains { $0.0 == "onTabCreated" && $0.1["reason"] as? String == "targetBlank" }, events.map { "\($0.0) \($0.1["reason"] ?? "")" })
      check("target=_blank tab loaded", await loaded(child))
      check("target=_blank tab shares cookies", await page(child, "return document.cookie.includes('dovo=work')") == "true")
      check("target=_blank tab gets content script", await wait { await self.attr(child, "dovoFixture") == "injected" })
      try engine.closeTab(child.id)
    }

    // OAuth-style popup: window.open keeps window.opener, posts back and closes itself.
    events.removeAll()
    _ = await page(a1, "window.open('/oauth.html', 'oauth', 'width=400,height=600'); return 'ok'")
    let oauthOpened = await wait { self.events.contains { $0.0 == "onTabCreated" && $0.1["reason"] as? String == "windowOpen" } }
    check("window.open popup opened in same profile", oauthOpened && engine.tabs.contains { $0.openerTabId == "a1" && $0.profileId == "work" })
    check("popup posted to window.opener", await wait { await self.attr(a1, "oauth") == "ok" })
    check("popup window.close closed native tab with reason page", await wait { self.events.contains { $0.0 == "onTabClosed" && $0.1["reason"] as? String == "page" } })

    // Action popup through WKWebExtension's own popup view controller.
    try engine.activateTab("a1")
    try await popupCheck(profile: "work", extensionId: extensionId, tab: a1, expectedCount: await attr(a1, "dovoCount"))

    check("background JavaScript prompt is suppressed", await page(b1, "return prompt('background', 'draft') === null") == "true")
    check("native prompt delegate exists", BrowserTab.instancesRespond(to: NSSelectorFromString("webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:")))
    var promptCompletions = 0
    var promptValue: String? = "not cancelled"
    engine.presentPrompt(title: "Fixture", message: "Prompt", defaultText: "unsent text") { value in promptCompletions += 1; promptValue = value }
    check("native prompt presents default text", await wait { (self.engine.topViewController() as? UIAlertController)?.textFields?.first?.text == "unsent text" })

    // Turning the gate off unloads everything.
    weak let controller = work.extensions?.controller
    check("controller had loaded context", controller?.extensionContexts.count == 1)
    await engine.setEnabled(false)
    check("opt-out cancels prompt exactly once", promptCompletions == 1 && promptValue == nil)
    let catalogue = try engine.status()["profiles"] as? [[String: Any]] ?? []
    check("disabled status lists saved profiles without workers", catalogue.contains { $0["profileId"] as? String == "work" } && engine.profiles.isEmpty)
    check("tab capture capability is false", try engine.status()["websiteTabCaptureAvailable"] as? Bool == false)
    check("disable closes tabs and profiles", engine.tabs.isEmpty && engine.profiles.isEmpty)
    check("disable unloads extension contexts", controller == nil || controller?.extensionContexts.isEmpty == true)
    await expectError("calls rejected after disable", code: "ERR_DISABLED") { _ = try await self.engine.ensureProfile("work") }
    await engine.setEnabled(true)
    let pendingProfile = try await engine.ensureProfile("race")
    pendingProfile.loading = Task { @MainActor in try? await Task.sleep(nanoseconds: 100_000_000) }
    let pendingEnsure = Task { @MainActor in try await engine.ensureProfile("race") }
    await Task.yield()
    await engine.setEnabled(false)
    await expectError("existing profile await rejects after opt-out", code: "ERR_DISABLED") { _ = try await pendingEnsure.value }
    print("DWB-EXTENSION-ID \(extensionId)")
  }

  func phaseTwo() async throws {
    await engine.setEnabled(true)
    let extensions = try await engine.extensions("work")
    let list = extensions.list()
    print("DWB-LIST \(list)")
    check("extension persisted across restart", list.count == 1 && list.first?["loaded"] as? Bool == true, list)
    guard let extensionId = list.first?["extensionId"] as? String else { return }
    check("grants persisted across restart", (list.first?["grantedPermissions"] as? [String]) == ["storage"] && (list.first?["grantedMatchPatterns"] as? [String]) == ["http://127.0.0.1/*"], list)

    let a1 = try await engine.openTab(tabId: "a1", profileId: "work", url: url("page.html"))
    host.tabId = "a1"
    check("work tab loaded after restart", await loaded(a1))
    check("content script injected after restart", await wait { await self.attr(a1, "dovoFixture") == "injected" })
    let count = await attr(a1, "dovoCount")
    check("storage.local persisted across restart (count >= 2)", (Int(count) ?? 0) >= 2, count)
    check("localStorage persisted in profile", await page(a1, "return localStorage.getItem('profile')") == "work")
    check("cookie persisted in profile", await page(a1, "return document.cookie.includes('dovo=work')") == "true")
    let b1 = try await engine.openTab(tabId: "b1", profileId: "personal", url: url("page.html"))
    check("personal tab loaded after restart", await loaded(b1))
    check("other profile storage persisted separately", await page(b1, "return localStorage.getItem('profile')") == "personal")
    try await popupCheck(profile: "work", extensionId: extensionId, tab: a1, expectedCount: count)

    // Revoking host access stops injection.
    _ = try extensions.setGrant(extensionId, permissions: ["storage"], patterns: [])
    a1.webView.reload()
    try? await Task.sleep(nanoseconds: 300_000_000)
    check("reloaded after revoke", await loaded(a1))
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    check("revoked host no longer injected", await attr(a1, "dovoFixture") == "absent", await attr(a1, "dovoFixture"))
    _ = try extensions.setGrant(extensionId, permissions: ["storage"], patterns: ["http://127.0.0.1/*"])

    // Disable stops injection; enable restores it.
    let disabled = try await extensions.setEnabled(extensionId, false)
    check("disabled extension unloaded", disabled["loaded"] as? Bool == false && extensions.controller.extensionContexts.isEmpty, disabled)
    a1.webView.reload()
    try? await Task.sleep(nanoseconds: 300_000_000)
    check("reloaded after disable", await loaded(a1))
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    check("disabled extension not injected", await attr(a1, "dovoFixture") == "absent")
    let enabled = try await extensions.setEnabled(extensionId, true)
    check("re-enabled extension loaded", enabled["loaded"] as? Bool == true, enabled)

    // A failed deletion must report the error and cannot restore an enabled extension.
    let parentDirectory = engine.storage.profileExtensionsURL("work")
    try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: parentDirectory.path)
    do {
      try await extensions.remove(extensionId)
      check("failed extension deletion surfaces error", false, "unexpected success")
    } catch { check("failed extension deletion surfaces error", true, error) }
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: parentDirectory.path)
    do {
      let disk = try engine.storage.loadExtensions("work")
      check("failed removal cannot reload enabled extension", disk.allSatisfy { !$0.enabled })
    } catch {
      // Partial filesystem deletion is explicit corruption, never an empty/auto-enabled catalogue.
      check("failed removal cannot silently reset catalogue", true, error)
    }
    check("failed removal leaves worker unloaded", extensions.controller.extensionContexts.isEmpty)

    // Remove deletes managed copy and data.
    try await extensions.remove(extensionId)
    check("removed from list", extensions.list().isEmpty)
    check("managed copy deleted", !FileManager.default.fileExists(atPath: engine.storage.extensionURL("work", extensionId).path))
    let leftover = await extensions.controller.dataRecords(ofTypes: WKWebExtensionController.allExtensionDataTypes).filter { $0.uniqueIdentifier == extensionId }
    check("extension storage removed", leftover.allSatisfy { $0.totalSizeInBytes == 0 }, leftover.map(\.totalSizeInBytes))

    try await engine.removeProfile("personal")
    check("profile removed", engine.profiles["personal"] == nil && !engine.tabs.contains { $0.profileId == "personal" })
    await engine.setEnabled(false)
    check("disabled at end", !engine.enabled && engine.tabs.isEmpty)
  }
}

extension BrowserEngine {
  func navigateForTest(_ tabId: String, _ url: String) async throws {
    try tab(tabId).load(BrowserInput.pageURL(url))
    try? await Task.sleep(nanoseconds: 200_000_000)
  }
}
