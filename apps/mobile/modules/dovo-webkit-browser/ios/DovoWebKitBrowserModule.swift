import ExpoModulesCore
import UIKit

struct OpenTabOptions: Record {
  @Field var tabId: String = ""
  @Field var profileId: String = ""
  @Field var url: String?
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
      "onTabCreated", "onTabUpdated", "onTabClosed", "onExternalUrlBlocked")

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
        return ["enabled": false, "browsingAvailable": false, "systemVersion": UIDevice.current.systemVersion, "maxTabs": 0, "websiteTabCaptureAvailable": false, "websiteTabCaptureUnavailableReason": "iOS WebKit has no public API for sharing an arbitrary browser tab and its audio.", "profiles": [], "tabs": []]
      }
      await BrowserEngine.shared.setEnabled(enabled)
      return try BrowserEngine.shared.status()
    }

    AsyncFunction("getStatus") { @MainActor () async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        return ["enabled": false, "browsingAvailable": false, "systemVersion": UIDevice.current.systemVersion, "maxTabs": 0, "websiteTabCaptureAvailable": false, "websiteTabCaptureUnavailableReason": "iOS WebKit has no public API for sharing an arbitrary browser tab and its audio.", "profiles": [], "tabs": []]
      }
      return try BrowserEngine.shared.status()
    }
    AsyncFunction("getActiveMediaTabIds") { @MainActor () async throws -> [String] in
      guard #available(iOS 17.0, *) else { return [] }
      return await BrowserEngine.shared.activeMediaTabIds()
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
