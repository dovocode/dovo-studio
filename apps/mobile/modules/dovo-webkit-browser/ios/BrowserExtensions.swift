import UIKit
import WebKit

/// Extension APIs Dovo does not back with a native implementation. WebKit makes them `undefined`
/// so extensions can feature-detect instead of failing at call time.
@available(iOS 18.4, *)
let browserUnsupportedApis: Set<String> = [
  "browser.runtime.connectNative",
  "browser.runtime.sendNativeMessage",
  "browser.windows.create",
  "browser.windows.remove",
]

/// Permissions Dovo never grants, even when the user approves everything.
@available(iOS 18.4, *)
let browserRefusedPermissions: Set<WKWebExtension.Permission> = [.nativeMessaging]

private struct PendingPrompt {
  let event: [String: Any]
  let allowedPermissions: Set<String>
  let allowedPatterns: Set<String>
  let resolve: (_ permissions: Set<String>, _ patterns: Set<String>) -> Void
}

/// Owns one profile's WKWebExtensionController and acts as its delegate.
@available(iOS 18.4, *)
@MainActor
final class ProfileExtensions: NSObject, WKWebExtensionControllerDelegate {
  let profileId: String
  let controller: WKWebExtensionController
  let window = BrowserExtensionWindow()
  private weak var engine: BrowserEngine?
  private weak var profile: BrowserProfileRuntime?
  private(set) var records: [String: ExtensionRecord] = [:]
  private(set) var contexts: [String: WKWebExtensionContext] = [:]
  private var prompts: [String: PendingPrompt] = [:]
  private(set) weak var presentedAction: WKWebExtension.Action?
  private var changeScheduled = false

  init(profile: BrowserProfileRuntime, engine: BrowserEngine) {
    profileId = profile.id
    self.profile = profile
    self.engine = engine
    let configuration = WKWebExtensionController.Configuration(identifier: profile.record.dataStoreIdentifier)
    configuration.defaultWebsiteDataStore = profile.dataStore
    controller = WKWebExtensionController(configuration: configuration)
    super.init()
    window.host = self
    controller.delegate = self
  }

  var tabs: [BrowserTab] { engine?.tabs(in: profileId) ?? [] }
  var activeTab: BrowserTab? {
    guard let id = profile?.activeTabId else { return nil }
    return tabs.first { $0.id == id }
  }

  func loadInstalled() async throws {
    guard let engine else { return }
    controller.didOpenWindow(window)
    controller.didFocusWindow(window)
    for record in try engine.storage.loadExtensions(profileId) {
      records[record.extensionId] = record
      guard record.enabled else { continue }
      do { try await load(record) } catch { NSLog("DovoWebKitBrowser: could not load extension %@: %@", record.extensionId, error.localizedDescription) }
    }
  }

  func shutdown() {
    closePopup()
    for (id, pending) in prompts { prompts[id] = nil; pending.resolve([], []) }
    for context in controller.extensionContexts { do { try controller.unload(context) } catch { NSLog("DovoWebKitBrowser: extension unload failed: %@", error.localizedDescription) } }
    contexts = [:]
    controller.delegate = nil
  }

  private func load(_ record: ExtensionRecord) async throws {
    guard let engine, contexts[record.extensionId] == nil else { return }
    let webExtension = try await WKWebExtension(resourceBaseURL: engine.storage.bundleURL(profileId, record.extensionId))
    guard engine.enabled, engine.profiles[profileId] === profile, records[record.extensionId]?.enabled == true, contexts[record.extensionId] == nil else { return }
    let context = WKWebExtensionContext(for: webExtension)
    context.uniqueIdentifier = record.extensionId
    if let baseURL = URL(string: "webkit-extension://\(record.baseHost)/") { context.baseURL = baseURL }
    context.unsupportedAPIs = browserUnsupportedApis
    #if DEBUG
      context.isInspectable = true
    #endif
    apply(record, to: context)
    try controller.load(context)
    // The record is authoritative over permission state WebKit restored from its own storage.
    apply(record, to: context)
    contexts[record.extensionId] = context
  }

  private func apply(_ record: ExtensionRecord, to context: WKWebExtensionContext) {
    let granted = Set(record.grantedPermissions.map { WKWebExtension.Permission(rawValue: $0) }).subtracting(browserRefusedPermissions)
    context.grantedPermissions = Dictionary(uniqueKeysWithValues: granted.map { ($0, Date.distantFuture) })
    let patterns = record.grantedMatchPatterns.compactMap { (try? WKWebExtension.MatchPattern(string: $0)) }
    context.grantedPermissionMatchPatterns = Dictionary(patterns.map { ($0, Date.distantFuture) }, uniquingKeysWith: { first, _ in first })
    context.deniedPermissions = Dictionary(uniqueKeysWithValues: browserRefusedPermissions.map { ($0, Date.distantFuture) })
  }

  // MARK: Management

  func summary(_ record: ExtensionRecord) -> [String: Any] {
    let context = contexts[record.extensionId]
    let action = context?.action(for: activeTab)
    let errors = (context?.errors ?? []) + (context?.webExtension.errors ?? [])
    return [
      "extensionId": record.extensionId,
      "profileId": record.profileId,
      "name": record.name,
      "version": record.version as Any,
      "description": record.description as Any,
      "manifestVersion": record.manifestVersion,
      "enabled": record.enabled,
      "loaded": context?.isLoaded ?? false,
      "hasAction": context.map { $0.webExtension.manifest["action"] != nil || $0.webExtension.manifest["browser_action"] != nil } ?? false,
      "actionLabel": action?.label as Any,
      "actionBadge": action.map { $0.badgeText.isEmpty ? nil : $0.badgeText } as Any,
      "grantedPermissions": context.map { $0.currentPermissions.map(\.rawValue).sorted() } ?? record.grantedPermissions,
      "grantedMatchPatterns": context.map { $0.currentPermissionMatchPatterns.map(\.string).sorted() } ?? record.grantedMatchPatterns,
      "requestedPermissions": record.requestedPermissions,
      "optionalPermissions": record.optionalPermissions,
      "requestedMatchPatterns": record.requestedMatchPatterns,
      "optionalMatchPatterns": record.optionalMatchPatterns,
      "unsupportedPermissions": record.unsupportedPermissions,
      "unsupportedApis": browserUnsupportedApis.sorted(),
      "errors": errors.map(\.localizedDescription),
    ]
  }

  func list() -> [[String: Any]] {
    records.values.sorted { $0.installedAt < $1.installedAt }.map(summary)
  }

  func record(_ extensionId: String) throws -> ExtensionRecord {
    guard let record = records[extensionId] else { throw BrowserError.notFound("No extension \(extensionId) in profile \(profileId).") }
    return record
  }

  func validatedGrant(_ record: ExtensionRecord, permissions: [String], patterns: [String]) throws -> ([String], [String]) {
    let permissions = try BrowserInput.strings(permissions, "permissions")
    let patterns = try BrowserInput.strings(patterns, "matchPatterns")
    let allowedPermissions = Set(record.requestedPermissions + record.optionalPermissions).subtracting(browserRefusedPermissions.map(\.rawValue))
    let allowedPatterns = Set(record.requestedMatchPatterns + record.optionalMatchPatterns)
    if let refused = permissions.first(where: { !allowedPermissions.contains($0) }) {
      throw BrowserError.invalid("Permission \(refused) is not requested by this extension or cannot be granted.")
    }
    if let refused = patterns.first(where: { !allowedPatterns.contains($0) }) {
      throw BrowserError.invalid("Host access \(refused) is not requested by this extension.")
    }
    return (permissions, patterns)
  }

  func install(_ record: ExtensionRecord) async throws -> [String: Any] {
    guard records.count < BrowserLimits.maxExtensionsPerProfile else { throw BrowserError.invalid("Up to \(BrowserLimits.maxExtensionsPerProfile) extensions per profile are supported.") }
    try engine?.storage.saveExtension(record)
    records[record.extensionId] = record
    try await load(record)
    changed()
    return summary(record)
  }

  func setEnabled(_ extensionId: String, _ enabled: Bool) async throws -> [String: Any] {
    var record = try record(extensionId)
    record.enabled = enabled
    try engine?.storage.saveExtension(record)
    records[extensionId] = record
    if enabled { try await load(record) } else { unload(extensionId) }
    changed()
    return summary(record)
  }

  func setGrant(_ extensionId: String, permissions: [String], patterns: [String]) throws -> [String: Any] {
    var record = try record(extensionId)
    (record.grantedPermissions, record.grantedMatchPatterns) = try validatedGrant(record, permissions: permissions, patterns: patterns)
    try engine?.storage.saveExtension(record)
    records[extensionId] = record
    if let context = contexts[extensionId] { apply(record, to: context) }
    changed()
    return summary(record)
  }

  func remove(_ extensionId: String) async throws {
    var record = try record(extensionId)
    guard let engine else { throw BrowserError.disabled }
    // Persist disabled before unloading/deleting: failed cleanup cannot revive enabled workers.
    record.enabled = false
    try engine.storage.saveExtension(record)
    records[extensionId] = record
    unload(extensionId)
    await removeData(Set([extensionId]))
    try engine.storage.remove(engine.storage.extensionURL(profileId, extensionId))
    records[extensionId] = nil
    changed()
  }

  func removeAll() async throws {
    for id in Array(records.keys) { try await remove(id) }
  }

  /// Clears extension storage (storage.local/session/sync) WebKit keeps for these contexts.
  private func removeData(_ ids: Set<String>) async {
    let types = WKWebExtensionController.allExtensionDataTypes
    let dataRecords = await controller.dataRecords(ofTypes: types).filter { ids.contains($0.uniqueIdentifier) }
    guard !dataRecords.isEmpty else { return }
    await controller.removeData(ofTypes: types, from: dataRecords)
  }

  private func unload(_ extensionId: String) {
    guard let context = contexts.removeValue(forKey: extensionId) else { return }
    if presentedAction?.webExtensionContext === context { closePopup() }
    for (id, pending) in prompts where pending.event["extensionId"] as? String == extensionId {
      prompts[id] = nil
      pending.resolve([], [])
    }
    do { try controller.unload(context) } catch { NSLog("DovoWebKitBrowser: extension unload failed: %@", error.localizedDescription) }
  }

  func performAction(_ extensionId: String, tab: BrowserTab?) throws {
    guard let context = contexts[extensionId] else { throw BrowserError.notFound("Extension \(extensionId) is not enabled.") }
    context.performAction(for: tab)
  }

  func closePopup() {
    presentedAction?.closePopup()
    presentedAction = nil
  }

  private func changed() {
    guard !changeScheduled else { return }
    changeScheduled = true
    DispatchQueue.main.async { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.changeScheduled = false
        self.engine?.emit("onExtensionsChanged", ["profileId": self.profileId])
      }
    }
  }

  // MARK: Tab and window events

  func tabOpened(_ tab: BrowserTab) { controller.didOpenTab(tab) }

  func tabClosed(_ tab: BrowserTab) { controller.didCloseTab(tab, windowIsClosing: false) }

  func tabActivated(_ tab: BrowserTab, previous: BrowserTab?) {
    controller.didActivateTab(tab, previousActiveTab: previous)
    if let previous { controller.didDeselectTabs([previous]) }
    controller.didSelectTabs([tab])
  }

  func tabChanged(_ tab: BrowserTab, changes: Set<String>) {
    var properties: WKWebExtension.TabChangedProperties = []
    if changes.contains("title") { properties.insert(.title) }
    if changes.contains("url") { properties.insert(.URL) }
    if changes.contains("loading") { properties.insert(.loading) }
    if !properties.isEmpty { controller.didChangeTabProperties(properties, for: tab) }
  }

  // MARK: Permission prompts

  private func prompt(
    _ context: WKWebExtensionContext, tab: (any WKWebExtensionTab)?, permissions: [String], patterns: [String], urls: [String],
    resolve: @escaping (Set<String>, Set<String>) -> Void
  ) {
    guard let engine, let extensionId = contexts.first(where: { $0.value === context })?.key else { return resolve([], []) }
    let requestId = UUID().uuidString
    let event: [String: Any] = [
      "requestId": requestId,
      "profileId": profileId,
      "extensionId": extensionId,
      "tabId": (tab as? BrowserTab)?.id as Any,
      "permissions": permissions.sorted(),
      "matchPatterns": patterns.sorted(),
      "urls": urls.sorted(),
    ]
    prompts[requestId] = PendingPrompt(event: event, allowedPermissions: Set(permissions), allowedPatterns: Set(patterns + urls), resolve: resolve)
    engine.emit("onExtensionPermissionPrompt", event)
    DispatchQueue.main.asyncAfter(deadline: .now() + BrowserLimits.permissionPromptTimeout) { [weak self] in
      MainActor.assumeIsolated {
        do { _ = try self?.resolvePrompt(requestId, permissions: [], patterns: []) }
        catch { NSLog("DovoWebKitBrowser: permission denial failed: %@", error.localizedDescription) }
      }
    }
  }

  @discardableResult
  func resolvePrompt(_ requestId: String, permissions: [String], patterns: [String]) throws -> Bool {
    guard let pending = prompts.removeValue(forKey: requestId) else { return false }
    let granted = Set(permissions).intersection(pending.allowedPermissions).subtracting(browserRefusedPermissions.map(\.rawValue))
    let grantedPatterns = Set(patterns).intersection(pending.allowedPatterns)
    if let extensionId = pending.event["extensionId"] as? String, var record = records[extensionId], !(granted.isEmpty && grantedPatterns.isEmpty) {
      record.grantedPermissions = Array(Set(record.grantedPermissions).union(granted)).sorted()
      let patternGrants = grantedPatterns.filter { (try? WKWebExtension.MatchPattern(string: $0)) != nil && !(pending.event["urls"] as? [String] ?? []).contains($0) }
      record.grantedMatchPatterns = Array(Set(record.grantedMatchPatterns).union(patternGrants)).sorted()
      do {
        guard let engine else { throw BrowserError.disabled }
        try engine.storage.saveExtension(record)
      } catch {
        pending.resolve([], [])
        throw error
      }
      records[extensionId] = record
      changed()
    }
    pending.resolve(granted, grantedPatterns)
    return true
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, promptForPermissions permissions: Set<WKWebExtension.Permission>,
    in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<WKWebExtension.Permission>, Date?) -> Void
  ) {
    let requested = permissions.subtracting(browserRefusedPermissions).map(\.rawValue)
    guard !requested.isEmpty else { return completionHandler([], nil) }
    prompt(extensionContext, tab: tab, permissions: requested, patterns: [], urls: []) { granted, _ in
      completionHandler(Set(granted.map { WKWebExtension.Permission(rawValue: $0) }), nil)
    }
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
    in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<WKWebExtension.MatchPattern>, Date?) -> Void
  ) {
    let byString = Dictionary(matchPatterns.map { ($0.string, $0) }, uniquingKeysWith: { first, _ in first })
    prompt(extensionContext, tab: tab, permissions: [], patterns: Array(byString.keys), urls: []) { _, granted in
      completionHandler(Set(granted.compactMap { byString[$0] }), nil)
    }
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, promptForPermissionToAccess urls: Set<URL>,
    in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<URL>, Date?) -> Void
  ) {
    let byString = Dictionary(urls.map { ($0.absoluteString, $0) }, uniquingKeysWith: { first, _ in first })
    prompt(extensionContext, tab: tab, permissions: [], patterns: [], urls: Array(byString.keys)) { _, granted in
      completionHandler(Set(granted.compactMap { byString[$0] }), nil)
    }
  }

  // MARK: Windows, tabs and UI

  func webExtensionController(_ controller: WKWebExtensionController, openWindowsFor extensionContext: WKWebExtensionContext) -> [any WKWebExtensionWindow] {
    [window]
  }

  func webExtensionController(_ controller: WKWebExtensionController, focusedWindowFor extensionContext: WKWebExtensionContext) -> (any WKWebExtensionWindow)? {
    window
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, openNewTabUsing configuration: WKWebExtension.TabConfiguration,
    for extensionContext: WKWebExtensionContext, completionHandler: @escaping ((any WKWebExtensionTab)?, (any Error)?) -> Void
  ) {
    guard let engine, let profile else { return completionHandler(nil, BrowserError.disabled) }
    if let url = configuration.url, !["http", "https", "about", "webkit-extension"].contains(url.scheme?.lowercased() ?? "") {
      return completionHandler(nil, BrowserError.invalid("Extensions can only open web or extension pages."))
    }
    do {
      let tab = try engine.openExtensionTab(profile: profile, url: configuration.url, opener: configuration.parentTab as? BrowserTab, activate: configuration.shouldBeActive)
      completionHandler(tab, nil)
    } catch {
      completionHandler(nil, error)
    }
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, openOptionsPageFor extensionContext: WKWebExtensionContext,
    completionHandler: @escaping ((any Error)?) -> Void
  ) {
    guard let engine, let profile, let url = extensionContext.optionsPageURL else { return completionHandler(BrowserError.notFound("This extension has no options page.")) }
    do {
      _ = try engine.openExtensionTab(profile: profile, url: url, opener: activeTab, activate: true)
      completionHandler(nil)
    } catch {
      completionHandler(error)
    }
  }

  func webExtensionController(_ controller: WKWebExtensionController, didUpdate action: WKWebExtension.Action, forExtensionContext context: WKWebExtensionContext) {
    changed()
  }

  func webExtensionController(
    _ controller: WKWebExtensionController, presentActionPopup action: WKWebExtension.Action,
    for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void
  ) {
    guard let engine, let popup = action.popupViewController, let presenter = engine.topViewController() else {
      return completionHandler(BrowserError(code: "ERR_UNAVAILABLE", message: "There is no window to present the extension popup in."))
    }
    closePopup()
    presentedAction = action
    if let popover = popup.popoverPresentationController {
      popover.sourceView = presenter.view
      popover.sourceRect = CGRect(x: presenter.view.bounds.maxX - 44, y: presenter.view.safeAreaInsets.top, width: 1, height: 1)
      popover.permittedArrowDirections = [.up]
    }
    let extensionId = contexts.first { $0.value === context }?.key ?? ""
    presenter.present(popup, animated: true) {
      completionHandler(nil)
    }
    engine.emit("onExtensionPopup", ["profileId": profileId, "extensionId": extensionId, "presented": true])
  }
}

/// The single extension-visible window of a profile. Its tabs are the profile's open tabs.
@available(iOS 18.4, *)
@MainActor
final class BrowserExtensionWindow: NSObject, WKWebExtensionWindow {
  weak var host: ProfileExtensions?

  func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { host?.tabs ?? [] }
  func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { host?.activeTab }
  func windowType(for context: WKWebExtensionContext) -> WKWebExtension.WindowType { .normal }
  func windowState(for context: WKWebExtensionContext) -> WKWebExtension.WindowState { .normal }
  func isPrivate(for context: WKWebExtensionContext) -> Bool { false }
  func frame(for context: WKWebExtensionContext) -> CGRect { host?.windowBounds ?? .zero }
}

@available(iOS 18.4, *)
extension ProfileExtensions {
  var windowBounds: CGRect {
    (UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene)?.coordinateSpace.bounds ?? .zero
  }
}

@available(iOS 18.4, *)
extension BrowserTab: WKWebExtensionTab {
  private var extensions: ProfileExtensions? { engine?.profiles[profileId]?.extensions }

  func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { extensions?.window }
  func indexInWindow(for context: WKWebExtensionContext) -> Int { extensions?.tabs.firstIndex { $0 === self } ?? NSNotFound }
  func parentTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? {
    openerTabId.flatMap { id in extensions?.tabs.first { $0.id == id } }
  }
  func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
  func title(for context: WKWebExtensionContext) -> String? { webView.title }
  func url(for context: WKWebExtensionContext) -> URL? { webView.url }
  func isLoadingComplete(for context: WKWebExtensionContext) -> Bool { !webView.isLoading }
  func isSelected(for context: WKWebExtensionContext) -> Bool { extensions?.activeTab === self }
  func size(for context: WKWebExtensionContext) -> CGSize { webView.bounds.size }

  func loadURL(_ url: URL, for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    guard ["http", "https", "about", "webkit-extension"].contains(url.scheme?.lowercased() ?? "") else {
      return completionHandler(BrowserError.invalid("Extensions can only load web or extension pages."))
    }
    load(url)
    completionHandler(nil)
  }

  func reload(fromOrigin: Bool, for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    if fromOrigin { webView.reloadFromOrigin() } else { webView.reload() }
    completionHandler(nil)
  }

  func goBack(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    webView.goBack()
    completionHandler(nil)
  }

  func goForward(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    webView.goForward()
    completionHandler(nil)
  }

  func activate(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    do { try engine?.activateTab(id); completionHandler(nil) } catch { completionHandler(error) }
  }

  func close(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
    engine?.closeTabFromPage(id, instanceId: instanceId, reason: "extension")
    completionHandler(nil)
  }

  func takeSnapshot(using configuration: WKSnapshotConfiguration, for context: WKWebExtensionContext, completionHandler: @escaping (UIImage?, (any Error)?) -> Void) {
    webView.takeSnapshot(with: configuration) { image, error in completionHandler(image, error) }
  }
}

// MARK: Staging and installation

@available(iOS 18.4, *)
extension BrowserEngine {
  func stageExtension(from source: URL) async throws -> [String: Any] {
    try requireEnabled()
    guard source.isFileURL else { throw BrowserError.invalid("Choose a local unpacked extension folder.") }
    guard staged.count < 8 else { throw BrowserError.invalid("Install or discard staged extensions first.") }
    let stagingId = "stage-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    let destination = storage.stagingURL(stagingId)
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    try storage.copyExtensionFolder(from: source, to: destination)
    do {
      let webExtension: WKWebExtension
      do {
        webExtension = try await WKWebExtension(resourceBaseURL: destination)
      } catch {
        throw BrowserError.invalid("WebKit could not load this extension: \(error.localizedDescription)")
      }
      let review = Self.review(webExtension, stagingId: stagingId)
      try requireEnabled()
      staged[stagingId] = review
      return review
    } catch {
      do { try storage.remove(destination) }
      catch let cleanup { throw BrowserError(code: "ERR_STORAGE", message: "\(error.localizedDescription) Cleanup failed: \(cleanup.localizedDescription)") }
      throw error
    }
  }

  func discardStaged(_ rawId: String) throws {
    let stagingId = try BrowserInput.id(rawId, "stagingId")
    try storage.remove(storage.stagingURL(stagingId))
    staged[stagingId] = nil
  }

  static func review(_ webExtension: WKWebExtension, stagingId: String) -> [String: Any] {
    let manifest = webExtension.manifest
    let manifestPermissions = Self.manifestStrings(manifest["permissions"]) + Self.manifestStrings(manifest["optional_permissions"])
    let recognised = Set((webExtension.requestedPermissions.union(webExtension.optionalPermissions)).map(\.rawValue))
    // Entries that are neither WebKit permissions nor match patterns (for example "debugger",
    // "identity" or "offscreen") have no WebKit implementation.
    let unsupported = manifestPermissions.filter { permission in
      !recognised.contains(permission) && (try? WKWebExtension.MatchPattern(string: permission)) == nil
    } + webExtension.requestedPermissions.union(webExtension.optionalPermissions).intersection(browserRefusedPermissions).map(\.rawValue)
    let action = (manifest["action"] ?? manifest["browser_action"]) as? [String: Any]
    let background = manifest["background"] as? [String: Any]
    return [
      "stagingId": stagingId,
      "name": webExtension.displayName ?? "Extension",
      "version": webExtension.displayVersion ?? webExtension.version as Any,
      "description": webExtension.displayDescription as Any,
      "manifestVersion": webExtension.manifestVersion,
      "hasAction": action != nil,
      "hasPopup": (action?["default_popup"] as? String)?.isEmpty == false,
      "hasBackground": webExtension.hasBackgroundContent || background != nil,
      "hasContentScripts": webExtension.hasInjectedContent,
      "hasOptionsPage": webExtension.hasOptionsPage,
      "requestedPermissions": webExtension.requestedPermissions.map(\.rawValue).sorted(),
      "optionalPermissions": webExtension.optionalPermissions.map(\.rawValue).sorted(),
      "requestedMatchPatterns": webExtension.requestedPermissionMatchPatterns.map(\.string).sorted(),
      "optionalMatchPatterns": webExtension.optionalPermissionMatchPatterns.map(\.string).sorted(),
      "unsupportedPermissions": Array(Set(unsupported)).sorted(),
      "warnings": webExtension.errors.map(\.localizedDescription),
    ]
  }

  private static func manifestStrings(_ value: Any?) -> [String] { (value as? [Any])?.compactMap { $0 as? String } ?? [] }

  func installExtension(stagingId rawStagingId: String, profileId: String, permissions: [String], matchPatterns: [String]) async throws -> [String: Any] {
    try requireEnabled()
    let stagingId = try BrowserInput.id(rawStagingId, "stagingId")
    guard let review = staged[stagingId] else { throw BrowserError.notFound("Stage the extension again before installing it.") }
    let profile = try await ensureProfile(profileId)
    guard let extensions = profile.extensions else { throw BrowserError.unsupported }
    let extensionId = "ext-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    var record = ExtensionRecord(
      extensionId: extensionId,
      profileId: profile.id,
      baseHost: UUID().uuidString.lowercased(),
      name: review["name"] as? String ?? "Extension",
      version: review["version"] as? String,
      description: review["description"] as? String,
      manifestVersion: review["manifestVersion"] as? Double ?? 0,
      enabled: true,
      grantedPermissions: [],
      grantedMatchPatterns: [],
      requestedPermissions: review["requestedPermissions"] as? [String] ?? [],
      optionalPermissions: review["optionalPermissions"] as? [String] ?? [],
      requestedMatchPatterns: review["requestedMatchPatterns"] as? [String] ?? [],
      optionalMatchPatterns: review["optionalMatchPatterns"] as? [String] ?? [],
      unsupportedPermissions: review["unsupportedPermissions"] as? [String] ?? [],
      installedAt: Date()
    )
    (record.grantedPermissions, record.grantedMatchPatterns) = try extensions.validatedGrant(record, permissions: permissions, patterns: matchPatterns)
    let bundle = storage.bundleURL(profile.id, extensionId)
    try storage.ensureDirectory(bundle.deletingLastPathComponent())
    try FileManager.default.moveItem(at: storage.stagingURL(stagingId), to: bundle)
    staged[stagingId] = nil
    do {
      return try await extensions.install(record)
    } catch {
      do { try await extensions.remove(extensionId) }
      catch let cleanup { throw BrowserError(code: "ERR_STORAGE", message: "\(error.localizedDescription) Install cleanup failed: \(cleanup.localizedDescription)") }
      throw error
    }
  }

  func extensions(_ profileId: String) async throws -> ProfileExtensions {
    let profile = try await ensureProfile(profileId)
    guard let extensions = profile.extensions else { throw BrowserError.unsupported }
    return extensions
  }

  func resolvePrompt(_ requestId: String, permissions: [String], matchPatterns: [String]) throws {
    try requireEnabled()
    let permissions = try BrowserInput.strings(permissions, "permissions")
    let matchPatterns = try BrowserInput.strings(matchPatterns, "matchPatterns")
    for profile in profiles.values {
      if try profile.extensions?.resolvePrompt(requestId, permissions: permissions, patterns: matchPatterns) == true { return }
    }
    throw BrowserError.notFound("The permission request is no longer pending.")
  }

  func closeExtensionPopups() {
    for profile in profiles.values { profile.extensions?.closePopup() }
  }
}
