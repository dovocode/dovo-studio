import UIKit
import WebKit

// Simulator harness: compiles the module's core Swift files (everything except the Expo wrapper)
// into a standalone app, then drives real WKWebView tabs with named persistent profiles.
// Phase 1 exercises browser behavior; phase 2 runs after a process restart to check persistence.

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
      if phase == 1 { try await phaseOne() } else if phase == 2 { try await phaseTwo() } else if phase == 6 { try await privateTabs() } else if phase == 7 { try await processRecovery() } else { await experiment(phase) }
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
    default: break
    }
  }

  func privateTabs() async throws {
    await engine.setEnabled(true)
    let id = "private-" + UUID().uuidString.lowercased()
    let profile = try await engine.ensureProfile(id)
    check("private data store is nonpersistent", !profile.dataStore.isPersistent)
    check("private profile never enters catalogue", try engine.storage.loadProfiles()[id] == nil)
    let first = try await engine.openTab(tabId: "private-first", profileId: id, url: url("page.html"))
    host.tabId = first.id
    check("private tab loads", await loaded(first))
    _ = await page(first, "localStorage.setItem('privateSecret','test');document.cookie='privateSecret=test; path=/';return 'ok'")
    try engine.closeTab(first.id)
    check("closing last private tab releases profile", engine.profiles[id] == nil)
    let second = try await engine.openTab(tabId: "private-second", profileId: id, url: url("page.html"))
    host.tabId = second.id
    check("replacement private tab loads", await loaded(second))
    check("replacement private tab has no cookies", await page(second, "return document.cookie.includes('privateSecret')") == "false")
    check("replacement private tab has no local storage", await page(second, "return localStorage.getItem('privateSecret')") == "null")
    check("replacement gets a fresh temporary data store", engine.profiles[id] !== profile)
    try engine.closeTab(second.id)
    await engine.setEnabled(false)
  }

  /// Invoke the real WKNavigationDelegate on real tabs, keeping reloads and lifecycle
  /// notifications deterministic without killing a shared WebKit process or other apps.
  func processRecovery() async throws {
    check("harness scene is foreground", await wait {
      UIApplication.shared.applicationState == .active && self.host.window?.windowScene?.activationState == .foregroundActive
    })
    await engine.setEnabled(true)
    let profileId = "private-" + UUID().uuidString.lowercased()
    let profile = try await engine.ensureProfile(profileId)
    profile.websiteScripts = ["sessionStorage.setItem('recoveryLoads', String(Number(sessionStorage.getItem('recoveryLoads') || 0) + 1))"]
    func loads(_ tab: BrowserTab) async -> String {
      await page(tab, "return sessionStorage.getItem('recoveryLoads')")
    }
    func loadedTimes(_ tab: BrowserTab, _ count: Int) async -> Bool {
      await wait {
        guard tab.loadState == "loaded", !tab.webView.isLoading else { return false }
        return await loads(tab) == String(count)
      }
    }

    let visible = try await engine.openTab(tabId: "recovery-visible", profileId: profileId, url: url("page.html"))
    host.tabId = visible.id
    check("visible recovery fixture loaded once", await loadedTimes(visible, 1))
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("first visible loss reloads once", await loadedTimes(visible, 2))
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("second visible loss fails without automatic reload", visible.loadState == "failed" && !visible.reloadWhenShown && visible.lastError?.contains("Reload") == true)
    // Even late completion/KVO and repeated host attachment cannot hide the failed state.
    visible.webView(visible.webView, didFinish: nil)
    visible.didMoveToHost()
    try? await Task.sleep(nanoseconds: 300_000_000)
    check("failed page stays failed and does not reload again", await loads(visible) == "2" && visible.loadState == "failed")
    visible.reload()
    check("manual reload retries the failed page", await loadedTimes(visible, 3))
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("manual reload grants one new automatic recovery", await loadedTimes(visible, 4))
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("retry budget is bounded again", visible.loadState == "failed")
    visible.load(try BrowserInput.pageURL(url("other.html")))
    check("explicit navigation retries and resets recovery", await loadedTimes(visible, 5))
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("navigated page can recover once", await loadedTimes(visible, 6))
    visible.goBack()
    check("back navigation resets recovery", await wait { visible.loadState == "loaded" && !visible.webView.isLoading && visible.webView.url?.path == "/page.html" })
    let afterBack = Int(await loads(visible)) ?? 0
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("back navigation has one recovery", await loadedTimes(visible, afterBack + 1))
    visible.goForward()
    check("forward navigation resets recovery", await wait { visible.loadState == "loaded" && !visible.webView.isLoading && visible.webView.url?.path == "/other.html" })
    let afterForward = Int(await loads(visible)) ?? 0
    visible.webViewWebContentProcessDidTerminate(visible.webView)
    check("forward navigation has one recovery", await loadedTimes(visible, afterForward + 1))

    let hidden = try await engine.openTab(tabId: "recovery-hidden", profileId: profileId, url: url("page.html"))
    check("detached fixture loads once", await loadedTimes(hidden, 1))
    hidden.webViewWebContentProcessDidTerminate(hidden.webView)
    hidden.didMoveToHost()
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
    check("detached process loss waits without reloading", await loads(hidden) == "1" && hidden.reloadWhenShown && hidden.loadState == "idle")
    host.tabId = hidden.id
    check("showing a detached tab consumes one recovery", await loadedTimes(hidden, 2))
    host.isHidden = true
    hidden.webViewWebContentProcessDidTerminate(hidden.webView)
    host.isHidden = false
    check("hiding and showing cannot replenish recovery budget", await loads(hidden) == "2" && hidden.loadState == "failed" && !hidden.reloadWhenShown)
    hidden.reload()
    check("hidden-view case retries explicitly", await loadedTimes(hidden, 3))
    host.isHidden = true
    hidden.webViewWebContentProcessDidTerminate(hidden.webView)
    check("attached hidden host defers its first loss", await loads(hidden) == "3" && hidden.webView.window != nil && hidden.reloadWhenShown)
    host.isHidden = false
    check("unhiding the host resumes recovery", await loadedTimes(hidden, 4))

    let background = try await engine.openTab(tabId: "recovery-background", profileId: profileId, url: url("page.html"))
    host.tabId = background.id
    check("background fixture loads once", await loadedTimes(background, 1))
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: UIApplication.shared)
    background.webViewWebContentProcessDidTerminate(background.webView)
    background.didMoveToHost()
    check("attached window is insufficient while application inactive", await loads(background) == "1" && background.webView.window != nil && background.reloadWhenShown)
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
    check("foreground notification resumes exactly one recovery", await loadedTimes(background, 2))
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
    background.webViewWebContentProcessDidTerminate(background.webView)
    check("repeat foreground transitions do not reset budget", background.loadState == "failed" && !background.reloadWhenShown)

    let closing = try await engine.openTab(tabId: "recovery-reused", profileId: profileId, url: url("page.html"))
    check("close fixture loads once", await loadedTimes(closing, 1))
    closing.webViewWebContentProcessDidTerminate(closing.webView)
    check("close fixture has deferred recovery", closing.reloadWhenShown)
    try engine.closeTab(closing.id)
    let reopened = try await engine.openTab(tabId: closing.id, profileId: profileId, url: url("page.html"))
    host.tabId = reopened.id
    check("reused tab identity starts with fresh page", await loadedTimes(reopened, 1))
    events.removeAll()
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
    closing.webViewWebContentProcessDidTerminate(closing.webView)
    closing.webView(closing.webView, didFinish: nil)
    closing.didMoveToHost()
    closing.reload()
    closing.load(try BrowserInput.pageURL(url("other.html")))
    reopened.webViewWebContentProcessDidTerminate(closing.webView)
    try? await Task.sleep(nanoseconds: 300_000_000)
    check("closed tab cannot revive deferred or explicit loads", await loads(closing) == "1" && !closing.reloadWhenShown && closing.webView.superview == nil)
    check("stale delegates do not alter reopened tab", await loads(reopened) == "1" && reopened.instanceId != closing.instanceId && reopened.loadState == "loaded")
    check("closed delegates emit no stale events", !events.contains { $0.1["instanceId"] as? String == closing.instanceId })
    await engine.setEnabled(false)
  }

  func storageChecks() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let storage = BrowserStorage(root: root)
    defer { do { try storage.remove(root) } catch { check("storage test cleanup", false, error) } }
    func rejects(_ name: String, _ body: () throws -> Void) {
      do { try body(); check(name, false, "no error") } catch { check(name, true) }
    }
    check("missing catalogue is empty", try storage.loadProfiles().isEmpty)
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
    rejects("credential URL rejected") { _ = try BrowserInput.pageURL("http://user:password@localhost:3000/") }
    check("HTTP remains HTTP", try BrowserInput.pageURL("http://localhost:3000/").scheme == "http")
  }

  func phaseOne() async throws {
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

    // A fresh named profile must load promptly.
    let p0 = try await engine.openTab(tabId: "p0", profileId: "personal", url: url("other.html"))
    check("fresh profile first load", await loaded(p0))
    try engine.closeTab("p0")

    let a1 = try await engine.openTab(tabId: "a1", profileId: "work", url: url("page.html"))
    host.tabId = "a1"
    check("work tab loaded", await loaded(a1), a1.state)
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
    events.removeAll()
    engine.closeTabFromPage("swap", instanceId: oldInstance, reason: "page")
    engine.tabDidUpdate(swap)
    check("stale close and update ignore reused tabId", try engine.tab("swap") === swapped && events.isEmpty)
    check("stale opener cannot create child tab", engine.openChildTab(opener: swap, configuration: swap.webView.configuration, reason: "windowOpen") == nil)
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

    let b1 = try await engine.openTab(tabId: "b1", profileId: "personal", url: url("page.html"))
    check("personal tab loaded", await loaded(b1))
    try? await Task.sleep(nanoseconds: 1_000_000_000)
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

    // target=_blank keeps the opener's profile.
    events.removeAll()
    _ = await page(a1, "document.getElementById('blank').click(); return 'ok'")
    let blankOpened = await wait { self.engine.tabs.contains { $0.openerTabId == "a1" } }
    check("target=_blank opened a native tab", blankOpened, events.map(\.0))
    if let child = engine.tabs.first(where: { $0.openerTabId == "a1" }) {
      check("target=_blank tab keeps profile", child.profileId == "work")
      check("target=_blank event reason", events.contains { $0.0 == "onTabCreated" && $0.1["reason"] as? String == "targetBlank" }, events.map { "\($0.0) \($0.1["reason"] ?? "")" })
      check("target=_blank tab loaded", await loaded(child))
      check("target=_blank tab shares cookies", await page(child, "return document.cookie.includes('dovo=work')") == "true")
      try engine.closeTab(child.id)
    }

    // OAuth-style popup: window.open keeps window.opener, posts back and closes itself.
    events.removeAll()
    _ = await page(a1, "window.open('/oauth.html', 'oauth', 'width=400,height=600'); return 'ok'")
    let oauthOpened = await wait { self.events.contains { $0.0 == "onTabCreated" && $0.1["reason"] as? String == "windowOpen" } }
    check("window.open popup opened in same profile", oauthOpened && engine.tabs.contains { $0.openerTabId == "a1" && $0.profileId == "work" })
    check("popup posted to window.opener", await wait { await self.attr(a1, "oauth") == "ok" })
    check("popup window.close closed native tab with reason page", await wait { self.events.contains { $0.0 == "onTabClosed" && $0.1["reason"] as? String == "page" } })

    check("background JavaScript prompt is suppressed", await page(b1, "return prompt('background', 'draft') === null") == "true")
    check("native prompt delegate exists", BrowserTab.instancesRespond(to: NSSelectorFromString("webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:")))
    var promptCompletions = 0
    var promptValue: String? = "not cancelled"
    engine.presentPrompt(title: "Fixture", message: "Prompt", defaultText: "unsent text") { value in promptCompletions += 1; promptValue = value }
    check("native prompt presents default text", await wait { (self.engine.topViewController() as? UIAlertController)?.textFields?.first?.text == "unsent text" })

    // Turning the gate off unloads everything.
    await engine.setEnabled(false)
    check("opt-out cancels prompt exactly once", promptCompletions == 1 && promptValue == nil)
    let catalogue = try engine.status()["profiles"] as? [[String: Any]] ?? []
    check("disabled status lists saved profiles without opening stores", catalogue.contains { $0["profileId"] as? String == "work" } && engine.profiles.isEmpty)
    check("tab capture capability is false", try engine.status()["websiteTabCaptureAvailable"] as? Bool == false)
    check("disable closes tabs and profiles", engine.tabs.isEmpty && engine.profiles.isEmpty)
    await expectError("calls rejected after disable", code: "ERR_DISABLED") { _ = try await self.engine.ensureProfile("work") }
  }

  func phaseTwo() async throws {
    await engine.setEnabled(true)
    let a1 = try await engine.openTab(tabId: "a1", profileId: "work", url: url("page.html"))
    host.tabId = "a1"
    check("work tab loaded after restart", await loaded(a1))
    check("localStorage persisted in profile", await page(a1, "return localStorage.getItem('profile')") == "work")
    check("cookie persisted in profile", await page(a1, "return document.cookie.includes('dovo=work')") == "true")
    let b1 = try await engine.openTab(tabId: "b1", profileId: "personal", url: url("page.html"))
    check("personal tab loaded after restart", await loaded(b1))
    check("other profile storage persisted separately", await page(b1, "return localStorage.getItem('profile')") == "personal")
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
