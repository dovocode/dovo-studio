import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

struct OpenTabOptions: Record {
  @Field var tabId: String = ""
  @Field var profileId: String = ""
  @Field var url: String?
}

struct ExtensionGrantRecord: Record {
  @Field var permissions: [String] = []
  @Field var matchPatterns: [String] = []
}

struct InstallExtensionOptions: Record {
  @Field var stagingId: String = ""
  @Field var profileId: String = ""
  @Field var grant: ExtensionGrantRecord = ExtensionGrantRecord()
}

/// Maps core errors to coded JS errors and keeps every call on the main actor.
@MainActor
private func run<T>(_ body: @MainActor () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch let error as BrowserError {
    throw Exception(name: "DovoWebKitBrowserError", description: error.message, code: error.code)
  }
}

private func unsupported() -> Exception {
  Exception(name: "DovoWebKitBrowserError", description: BrowserError.unsupported.message, code: BrowserError.unsupported.code)
}

public class DovoWebKitBrowserModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoWebKitBrowser")

    Events(
      "onTabCreated", "onTabUpdated", "onTabClosed", "onExternalUrlBlocked", "onExtensionsChanged",
      "onExtensionPermissionPrompt", "onExtensionPopup")

    OnCreate { [weak self] in
      Task { @MainActor in
        guard #available(iOS 17.0, *) else { return }
        BrowserEngine.shared.emitter = { name, body in self?.sendEvent(name, body) }
      }
    }

    OnDestroy {
      Task { @MainActor in
        guard #available(iOS 17.0, *) else { return }
        BrowserEngine.shared.emitter = nil
        await BrowserEngine.shared.setEnabled(false)
      }
    }

    AsyncFunction("setEnabled") { @MainActor (enabled: Bool) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        if enabled { throw unsupported() }
        return ["enabled": false, "browsingAvailable": false, "extensionsAvailable": false, "systemVersion": UIDevice.current.systemVersion, "maxTabs": 0, "websiteTabCaptureAvailable": false, "websiteTabCaptureUnavailableReason": "iOS WebKit has no public API for sharing an arbitrary browser tab and its audio.", "profiles": [], "tabs": []]
      }
      await BrowserEngine.shared.setEnabled(enabled)
      return try BrowserEngine.shared.status()
    }

    AsyncFunction("getStatus") { @MainActor () async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        return ["enabled": false, "browsingAvailable": false, "extensionsAvailable": false, "systemVersion": UIDevice.current.systemVersion, "maxTabs": 0, "websiteTabCaptureAvailable": false, "websiteTabCaptureUnavailableReason": "iOS WebKit has no public API for sharing an arbitrary browser tab and its audio.", "profiles": [], "tabs": []]
      }
      return try BrowserEngine.shared.status()
    }

    AsyncFunction("ensureProfile") { @MainActor (profileId: String) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      return try await run { try await BrowserEngine.shared.ensureProfile(profileId).summary }
    }

    AsyncFunction("removeProfile") { @MainActor (profileId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { try await BrowserEngine.shared.removeProfile(profileId) }
    }

    AsyncFunction("openTab") { @MainActor (options: OpenTabOptions) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      return try await run { try await BrowserEngine.shared.openTab(tabId: options.tabId, profileId: options.profileId, url: options.url).state }
    }

    AsyncFunction("closeTab") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { try BrowserEngine.shared.closeTab(tabId) }
    }

    AsyncFunction("activateTab") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { try BrowserEngine.shared.activateTab(tabId) }
    }

    AsyncFunction("navigate") { @MainActor (tabId: String, url: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { try BrowserEngine.shared.tab(tabId).load(BrowserInput.pageURL(url)) }
    }

    AsyncFunction("goBack") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { _ = try BrowserEngine.shared.tab(tabId).webView.goBack() }
    }

    AsyncFunction("goForward") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { _ = try BrowserEngine.shared.tab(tabId).webView.goForward() }
    }

    AsyncFunction("reload") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { _ = try BrowserEngine.shared.tab(tabId).webView.reload() }
    }

    AsyncFunction("stopLoading") { @MainActor (tabId: String) async throws in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      try await run { try BrowserEngine.shared.tab(tabId).webView.stopLoading() }
    }

    AsyncFunction("getTab") { @MainActor (tabId: String) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      return try await run { try BrowserEngine.shared.tab(tabId).state }
    }

    AsyncFunction("getSelection") { @MainActor (tabId: String) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else { throw unsupported() }
      return try await run { try await BrowserEngine.shared.selection(tabId) }
    }

    AsyncFunction("pickExtensionFolder") { @MainActor () async throws -> [String: Any]? in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run {
        try BrowserEngine.shared.requireEnabled()
        guard let folder = await ExtensionFolderPicker.pick() else { return nil }
        return try await BrowserEngine.shared.stageExtension(from: folder)
      }
    }

    AsyncFunction("stageExtension") { @MainActor (folderUri: String) async throws -> [String: Any] in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run {
        guard folderUri.utf16.count <= BrowserLimits.maxUrlLength, let url = URL(string: folderUri), url.isFileURL
        else { throw BrowserError.invalid("Pass a file:// URI of an unpacked extension folder.") }
        return try await BrowserEngine.shared.stageExtension(from: url)
      }
    }

    AsyncFunction("discardStagedExtension") { @MainActor (stagingId: String) async throws in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      try await run { try BrowserEngine.shared.discardStaged(stagingId) }
    }

    AsyncFunction("installExtension") { @MainActor (options: InstallExtensionOptions) async throws -> [String: Any] in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run {
        try await BrowserEngine.shared.installExtension(
          stagingId: options.stagingId, profileId: options.profileId,
          permissions: options.grant.permissions, matchPatterns: options.grant.matchPatterns)
      }
    }

    AsyncFunction("listExtensions") { @MainActor (profileId: String) async throws -> [[String: Any]] in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run { try await BrowserEngine.shared.extensions(profileId).list() }
    }

    AsyncFunction("setExtensionEnabled") { @MainActor (profileId: String, extensionId: String, enabled: Bool) async throws -> [String: Any] in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run {
        try await BrowserEngine.shared.extensions(profileId).setEnabled(BrowserInput.id(extensionId, "extensionId"), enabled)
      }
    }

    AsyncFunction("setExtensionGrant") { @MainActor (profileId: String, extensionId: String, grant: ExtensionGrantRecord) async throws -> [String: Any] in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      return try await run {
        try await BrowserEngine.shared.extensions(profileId).setGrant(
          BrowserInput.id(extensionId, "extensionId"), permissions: grant.permissions, patterns: grant.matchPatterns)
      }
    }

    AsyncFunction("removeExtension") { @MainActor (profileId: String, extensionId: String) async throws in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      try await run { try await BrowserEngine.shared.extensions(profileId).remove(BrowserInput.id(extensionId, "extensionId")) }
    }

    AsyncFunction("performExtensionAction") { @MainActor (profileId: String, extensionId: String, tabId: String?) async throws in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      try await run {
        let extensions = try await BrowserEngine.shared.extensions(profileId)
        let tab = try tabId.map { try BrowserEngine.shared.tab($0) } ?? extensions.activeTab
        if let tab, tab.profileId != extensions.profileId { throw BrowserError.invalid("The tab belongs to another profile.") }
        try extensions.performAction(BrowserInput.id(extensionId, "extensionId"), tab: tab)
      }
    }

    AsyncFunction("closeExtensionPopup") { @MainActor () async throws in
      guard #available(iOS 18.4, *) else { return }
      BrowserEngine.shared.closeExtensionPopups()
    }

    AsyncFunction("resolveExtensionPermissionPrompt") { @MainActor (requestId: String, grant: ExtensionGrantRecord) async throws in
      guard #available(iOS 18.4, *) else { throw unsupported() }
      try await run {
        guard UUID(uuidString: requestId) != nil else { throw BrowserError.invalid("Unknown permission request.") }
        try BrowserEngine.shared.resolvePrompt(requestId, permissions: grant.permissions, matchPatterns: grant.matchPatterns)
      }
    }

    View(DovoWebKitBrowserView.self) {
      Prop("tabId") { (view: DovoWebKitBrowserView, tabId: String?) in
        view.host.tabId = tabId
      }
    }
  }
}

final class DovoWebKitBrowserView: ExpoView {
  let host = BrowserHostView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.frame = bounds
    addSubview(host)
  }
}
