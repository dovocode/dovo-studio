import UIKit
import WebKit

/// One named browser profile: a persistent WKWebsiteDataStore keyed by a stable UUID and, on
/// iOS 18.4+, a WKWebExtensionController whose persistent storage uses the same UUID.
@available(iOS 17.0, *)
@MainActor
final class BrowserProfileRuntime {
  let record: ProfileRecord
  let dataStore: WKWebsiteDataStore
  var activeTabId: String?
  var loading: Task<Void, Error>?
  /// ProfileExtensions on iOS 18.4+. Stored untyped because stored properties cannot carry a
  /// newer availability than the enclosing type.
  var extensionHost: AnyObject?

  init(record: ProfileRecord) {
    self.record = record
    dataStore = WKWebsiteDataStore(forIdentifier: record.dataStoreIdentifier)
  }

  var id: String { record.profileId }

  @available(iOS 18.4, *)
  var extensions: ProfileExtensions? { extensionHost as? ProfileExtensions }

  func makeConfiguration() -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    configuration.allowsInlineMediaPlayback = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    if #available(iOS 18.4, *), let extensions { configuration.webExtensionController = extensions.controller }
    return configuration
  }

  var summary: [String: Any] { ["profileId": id, "dataStoreIdentifier": record.dataStoreIdentifier.uuidString] }
}

@available(iOS 17.0, *)
@MainActor
final class BrowserEngine {
  static let shared = BrowserEngine()

  var storage = BrowserStorage()
  var emitter: ((String, [String: Any]) -> Void)?
  private(set) var enabled = false
  private(set) var profiles: [String: BrowserProfileRuntime] = [:]
  private(set) var tabs: [BrowserTab] = []
  private var cancelDialog: (() -> Void)?
  private var hostViews = NSHashTable<BrowserHostView>.weakObjects()
  /// Staged extension folders awaiting review, keyed by staging id.
  var staged: [String: [String: Any]] = [:]

  static var extensionsAvailable: Bool {
    if #available(iOS 18.4, *) { return true }
    return false
  }

  func emit(_ name: String, _ body: [String: Any]) {
    guard enabled else { return }
    emitter?(name, body)
  }

  func requireEnabled() throws {
    guard enabled else { throw BrowserError.disabled }
  }

  // MARK: Gate

  func setEnabled(_ value: Bool) async {
    guard value != enabled else { return }
    if value {
      enabled = true
      return
    }
    enabled = false
    cancelDialog?()
    for tab in tabs { removeTab(tab, reason: nil) }
    tabs = []
    if #available(iOS 18.4, *) {
      for profile in profiles.values { profile.extensions?.shutdown() }
    }
    for profile in profiles.values { profile.loading?.cancel() }
    profiles = [:]
    for (stagingId, _) in staged {
      do { try storage.remove(storage.stagingURL(stagingId)) }
      catch { NSLog("DovoWebKitBrowser: staging cleanup failed: %@", error.localizedDescription) }
    }
    staged = [:]
    enabled = false
    refreshHostViews()
  }

  func status() throws -> [String: Any] {
    [
      "enabled": enabled,
      "browsingAvailable": true,
      "extensionsAvailable": Self.extensionsAvailable,
      "systemVersion": UIDevice.current.systemVersion,
      "maxTabs": BrowserLimits.maxTabs,
      "profiles": try storage.loadProfiles().values.sorted { $0.profileId < $1.profileId }.map { ["profileId": $0.profileId, "dataStoreIdentifier": $0.dataStoreIdentifier.uuidString] },
      "websiteTabCaptureAvailable": false,
      "websiteTabCaptureUnavailableReason": "iOS WebKit has no public API for sharing an arbitrary browser tab and its audio.",
      "tabs": tabs.map(\.state),
    ]
  }

  // MARK: Profiles

  func ensureProfile(_ rawId: String) async throws -> BrowserProfileRuntime {
    try requireEnabled()
    let profileId = try BrowserInput.id(rawId, "profileId")
    if let profile = profiles[profileId] {
      try await profile.loading?.value
      try requireEnabled()
      guard profiles[profileId] === profile else { throw BrowserError.disabled }
      return profile
    }
    var records = try storage.loadProfiles()
    let record: ProfileRecord
    if let existing = records[profileId] {
      record = existing
    } else {
      guard records.count < BrowserLimits.maxProfiles else { throw BrowserError.invalid("Up to \(BrowserLimits.maxProfiles) browser profiles are supported.") }
      record = ProfileRecord(profileId: profileId, dataStoreIdentifier: UUID())
      records[profileId] = record
      try storage.saveProfiles(records)
    }
    let profile = BrowserProfileRuntime(record: record)
    profiles[profileId] = profile
    if #available(iOS 18.4, *) {
      let extensions = ProfileExtensions(profile: profile, engine: self)
      profile.extensionHost = extensions
      profile.loading = Task { @MainActor in try await extensions.loadInstalled() }
      try await profile.loading?.value
    }
    try requireEnabled()
    guard profiles[profileId] === profile else { throw BrowserError.disabled }
    return profile
  }

  func removeProfile(_ rawId: String) async throws {
    try requireEnabled()
    let profileId = try BrowserInput.id(rawId, "profileId")
    var records = try storage.loadProfiles()
    let profile = try await ensureProfile(profileId)
    for tab in tabs where tab.profileId == profileId { removeTab(tab, reason: "profileRemoved") }
    if #available(iOS 18.4, *), let extensions = profile.extensions {
      try await extensions.removeAll()
      extensions.shutdown()
    }
    profiles[profileId] = nil
    try storage.remove(storage.profileExtensionsURL(profileId))
    records[profileId] = nil
    try storage.saveProfiles(records)
    do {
      try await WKWebsiteDataStore.remove(forIdentifier: profile.record.dataStoreIdentifier)
    } catch {
      // WebKit refuses while a released web view still holds the store; clear its data instead.
      await profile.dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }
  }

  // MARK: Tabs

  func tab(_ rawId: String) throws -> BrowserTab {
    try requireEnabled()
    let tabId = try BrowserInput.id(rawId, "tabId")
    guard let tab = tabs.first(where: { $0.id == tabId }) else { throw BrowserError.notFound("No open browser tab \(tabId).") }
    return tab
  }

  func tabs(in profileId: String) -> [BrowserTab] { tabs.filter { $0.profileId == profileId } }

  func openTab(tabId rawTabId: String, profileId: String, url rawUrl: String?) async throws -> BrowserTab {
    try requireEnabled()
    let tabId = try BrowserInput.id(rawTabId, "tabId")
    let url = try rawUrl.map(BrowserInput.pageURL)
    let profile = try await ensureProfile(profileId)
    // Idempotent for the same profile: return the existing tab without an event or navigation.
    if let existing = tabs.first(where: { $0.id == tabId }) {
      guard existing.profileId == profile.id else {
        throw BrowserError(code: "ERR_TAB_EXISTS", message: "Browser tab \(tabId) is open in profile \(existing.profileId). Close it first.")
      }
      return existing
    }
    guard tabs.count < BrowserLimits.maxTabs else { throw BrowserError(code: "ERR_LIMIT", message: "Up to \(BrowserLimits.maxTabs) browser tabs can be open.") }
    let tab = register(BrowserTab(id: tabId, profileId: profile.id, openerTabId: nil, configuration: profile.makeConfiguration(), engine: self), reason: "api")
    if let url { tab.load(url) }
    return tab
  }

  /// Opens a tab for target=_blank/window.open using WebKit's configuration for the opener.
  func openChildTab(opener: BrowserTab, configuration: WKWebViewConfiguration, reason: String) -> BrowserTab? {
    guard enabled, tabs.count < BrowserLimits.maxTabs, profiles[opener.profileId] != nil else { return nil }
    let tab = BrowserTab(id: Self.generatedId(), profileId: opener.profileId, openerTabId: opener.id, configuration: configuration, engine: self)
    return register(tab, reason: reason)
  }

  /// Opens a tab on behalf of an extension (tabs.create, options page) in the extension's profile.
  func openExtensionTab(profile: BrowserProfileRuntime, url: URL?, opener: BrowserTab?, activate: Bool) throws -> BrowserTab {
    try requireEnabled()
    guard tabs.count < BrowserLimits.maxTabs else { throw BrowserError(code: "ERR_LIMIT", message: "Up to \(BrowserLimits.maxTabs) browser tabs can be open.") }
    let tab = register(BrowserTab(id: Self.generatedId(), profileId: profile.id, openerTabId: opener?.id, configuration: profile.makeConfiguration(), engine: self), reason: "extension")
    if let url { tab.load(url) }
    if activate { try? activateTab(tab.id) }
    return tab
  }

  private func register(_ tab: BrowserTab, reason: String) -> BrowserTab {
    tabs.append(tab)
    let profile = profiles[tab.profileId]
    if profile?.activeTabId == nil { profile?.activeTabId = tab.id }
    if #available(iOS 18.4, *) { profile?.extensions?.tabOpened(tab) }
    refreshHostViews()
    emit("onTabCreated", tab.state.merging(["reason": reason]) { current, _ in current })
    return tab
  }

  func activateTab(_ tabId: String) throws {
    let tab = try tab(tabId)
    guard let profile = profiles[tab.profileId] else { return }
    let previous = profile.activeTabId.flatMap { id in tabs.first { $0.id == id } }
    profile.activeTabId = tab.id
    if previous !== tab, #available(iOS 18.4, *) { profile.extensions?.tabActivated(tab, previous: previous) }
  }

  /// Idempotent: closing a tab that is not open resolves without an event.
  func closeTab(_ rawTabId: String) throws {
    try requireEnabled()
    let tabId = try BrowserInput.id(rawTabId, "tabId")
    guard let tab = tabs.first(where: { $0.id == tabId }) else { return }
    removeTab(tab, reason: "api")
  }

  /// Closes from window.close() or an extension; ignores a newer tab that reused the id.
  func closeTabFromPage(_ tabId: String, instanceId: String, reason: String) {
    guard let tab = tabs.first(where: { $0.id == tabId && $0.instanceId == instanceId }) else { return }
    removeTab(tab, reason: reason)
  }

  /// `reason` nil closes silently (module being disabled).
  private func removeTab(_ tab: BrowserTab, reason: String?) {
    guard let index = tabs.firstIndex(where: { $0 === tab }) else { return }
    tabs.remove(at: index)
    let profile = profiles[tab.profileId]
    if #available(iOS 18.4, *) { profile?.extensions?.tabClosed(tab) }
    if profile?.activeTabId == tab.id { profile?.activeTabId = tabs.last { $0.profileId == tab.profileId }?.id }
    tab.close()
    refreshHostViews()
    if let reason { emit("onTabClosed", ["tabId": tab.id, "instanceId": tab.instanceId, "profileId": tab.profileId, "reason": reason]) }
  }

  func tabDidUpdate(_ tab: BrowserTab, changes: Set<String>) {
    guard tabs.contains(where: { $0 === tab }) else { return }
    if #available(iOS 18.4, *) { profiles[tab.profileId]?.extensions?.tabChanged(tab, changes: changes) }
    emit("onTabUpdated", tab.state)
  }

  func selection(_ tabId: String) async throws -> [String: Any] {
    let tab = try tab(tabId)
    let (text, truncated) = try await withCheckedThrowingContinuation { continuation in
      tab.selection { continuation.resume(with: $0) }
    }
    return ["text": text, "truncated": truncated]
  }

  static func generatedId() -> String {
    "tab-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  }

  // MARK: Hosting

  func attach(_ view: BrowserHostView) {
    hostViews.add(view)
    view.refresh()
  }

  func refreshHostViews() {
    for view in hostViews.allObjects { view.refresh() }
  }

  func hostedTab(_ tabId: String?) -> BrowserTab? {
    guard enabled, let tabId else { return nil }
    return tabs.first { $0.id == tabId }
  }

  func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first
    var controller = window?.rootViewController
    while let presented = controller?.presentedViewController, !presented.isBeingDismissed { controller = presented }
    return controller
  }

  func presentDialog(title: String, message: String, cancellable: Bool, completion: @escaping (Bool) -> Void) {
    presentPrompt(title: title, message: message, defaultText: nil, textInput: false, cancellable: cancellable) { completion($0 != nil) }
  }

  func presentPrompt(title: String, message: String, defaultText: String?, textInput: Bool = true, cancellable: Bool = true, completion: @escaping (String?) -> Void) {
    guard enabled, cancelDialog == nil, let presenter = topViewController(), !(presenter is UIAlertController) else { return completion(nil) }
    let alert = UIAlertController(title: String(title.prefix(200)), message: String(message.prefix(2000)), preferredStyle: .alert)
    if textInput { alert.addTextField { $0.text = defaultText } }
    var finished = false
    let finish: (String?) -> Void = { [weak self, weak alert] value in
      guard !finished else { return }
      finished = true
      self?.cancelDialog = nil
      alert?.dismiss(animated: false)
      completion(value)
    }
    cancelDialog = { finish(nil) }
    if cancellable { alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in finish(nil) }) }
    alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in finish(textInput ? (alert?.textFields?.first?.text ?? "") : "") })
    presenter.present(alert, animated: true)
  }

}

/// Plain UIKit host that shows the web view of one tab. The Expo view embeds this.
@MainActor
final class BrowserHostView: UIView {
  var tabId: String? {
    didSet { if tabId != oldValue { refresh() } }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    if #available(iOS 17.0, *) { BrowserEngine.shared.attach(self) }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func refresh() {
    guard #available(iOS 17.0, *) else { return }
    let tab = BrowserEngine.shared.hostedTab(tabId)
    let webView = tab?.webView
    for subview in subviews where subview !== webView && subview is WKWebView { subview.removeFromSuperview() }
    guard let tab, let webView else { return }
    if webView.superview !== self {
      webView.removeFromSuperview()
      addSubview(webView)
    }
    webView.frame = bounds
    tab.didMoveToHost()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    for subview in subviews where subview is WKWebView { subview.frame = bounds }
  }
}
