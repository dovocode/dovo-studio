// Typed contract for the iOS-only DovoWebKitBrowser native module.
// Native browsing uses WKWebView with one persistent WKWebsiteDataStore per profile (iOS 17+).
// Web extensions use WebKit's own WKWebExtension runtime (iOS 18.4+); nothing here emulates
// extension APIs in JavaScript. Android does not register this module.
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import type { ComponentType } from 'react'
import type { ViewProps } from 'react-native'

/** `^[A-Za-z0-9_-]{1,64}$`. Profiles, tabs and extensions share this id shape. */
export type BrowserId = string

export type BrowserLoadState = 'idle' | 'loading' | 'loaded' | 'failed'

export type BrowserTabState = {
  tabId: BrowserId
  /**
   * Unique per native tab. Reopening a tabId (for example in another profile) gets a new
   * instanceId; ignore events whose instanceId is not the one you currently track.
   */
  instanceId: string
  profileId: BrowserId
  /** Tab that opened this one through target=_blank, window.open or an extension. */
  openerTabId: BrowserId | null
  url: string | null
  title: string
  loadState: BrowserLoadState
  /** 0...1 */
  progress: number
  canGoBack: boolean
  canGoForward: boolean
  /** False for HTTP pages, including LAN/VPN runtimes. Informational only. */
  secure: boolean
  error: string | null
}

export type BrowserTabCreatedReason = 'api' | 'targetBlank' | 'windowOpen' | 'extension'

/**
 * api: closeTab(). page: window.close(), e.g. after OAuth. extension: tabs.remove().
 * profileRemoved: removeProfile(). setEnabled(false) closes tabs without events.
 */
export type BrowserTabClosedReason = 'api' | 'page' | 'extension' | 'profileRemoved'

export type BrowserSelection = { text: string; truncated: boolean }

export type BrowserProfile = { profileId: BrowserId; dataStoreIdentifier: string }

export type BrowserStatus = {
  enabled: boolean
  /** WKWebsiteDataStore(forIdentifier:) is available (iOS 17+). */
  browsingAvailable: boolean
  /** WKWebExtension and WKWebExtensionController are available (iOS 18.4+). */
  extensionsAvailable: boolean
  /** Arbitrary website tab video/audio capture has no public iOS WebKit API. */
  websiteTabCaptureAvailable: false
  websiteTabCaptureUnavailableReason: string
  systemVersion: string
  /** Live native tab cap across all profiles (100). openTab beyond it rejects with ERR_LIMIT. */
  maxTabs: number
  profiles: BrowserProfile[]
  tabs: BrowserTabState[]
}

export type ExtensionPermissionReview = {
  /** WKWebExtension.Permission values WebKit recognised from `permissions`. */
  requestedPermissions: string[]
  optionalPermissions: string[]
  /** Match pattern strings from `host_permissions` and content scripts. */
  requestedMatchPatterns: string[]
  optionalMatchPatterns: string[]
  /**
   * Manifest permissions WebKit does not implement or Dovo refuses (nativeMessaging). These are
   * never granted and the matching extension APIs stay unavailable.
   */
  unsupportedPermissions: string[]
}

export type StagedExtension = ExtensionPermissionReview & {
  stagingId: BrowserId
  name: string
  version: string | null
  description: string | null
  manifestVersion: number
  hasAction: boolean
  hasPopup: boolean
  hasBackground: boolean
  hasContentScripts: boolean
  hasOptionsPage: boolean
  /** WKWebExtension.errors, for example unsupported manifest keys. */
  warnings: string[]
}

export type InstalledExtension = ExtensionPermissionReview & {
  extensionId: BrowserId
  profileId: BrowserId
  name: string
  version: string | null
  description: string | null
  manifestVersion: number
  enabled: boolean
  loaded: boolean
  hasAction: boolean
  actionLabel: string | null
  actionBadge: string | null
  grantedPermissions: string[]
  grantedMatchPatterns: string[]
  /** Chrome/browser API paths hidden via WKWebExtensionContext.unsupportedAPIs. */
  unsupportedApis: string[]
  errors: string[]
}

export type ExtensionGrant = {
  /** Subset of requested/optional permissions the user approved. */
  permissions: string[]
  /** Subset of requested/optional match patterns the user approved. */
  matchPatterns: string[]
}

export type ExtensionPermissionPrompt = {
  requestId: string
  profileId: BrowserId
  extensionId: BrowserId
  tabId: BrowserId | null
  permissions: string[]
  matchPatterns: string[]
  urls: string[]
}

export type DovoWebKitBrowserEvents = {
  onTabCreated: (event: BrowserTabState & { reason: BrowserTabCreatedReason }) => void
  onTabUpdated: (event: BrowserTabState) => void
  /**
   * Events and promise results reach JS on separate paths, so this may arrive after closeTab()
   * resolves or after the same tabId was reopened. Match on instanceId.
   */
  onTabClosed: (event: {
    tabId: BrowserId
    instanceId: string
    profileId: BrowserId
    reason: BrowserTabClosedReason
  }) => void
  /** Non-web schemes (mailto:, tel:, app links) are blocked; JS may offer to open them. */
  onExternalUrlBlocked: (event: { tabId: BrowserId; url: string }) => void
  onExtensionsChanged: (event: { profileId: BrowserId }) => void
  /** Extension called permissions.request(). Unanswered prompts are denied after 60 s. */
  onExtensionPermissionPrompt: (event: ExtensionPermissionPrompt) => void
  onExtensionPopup: (event: {
    profileId: BrowserId
    extensionId: BrowserId
    presented: boolean
  }) => void
}

export type DovoWebKitBrowserModule = {
  /** Default off. Disabling closes all tabs and popups and unloads every extension context. */
  setEnabled(enabled: boolean): Promise<BrowserStatus>
  getStatus(): Promise<BrowserStatus>

  ensureProfile(profileId: BrowserId): Promise<BrowserProfile>
  /** Closes the profile's tabs, removes its extensions and deletes its website data store. */
  removeProfile(profileId: BrowserId): Promise<void>

  /**
   * Idempotent for the same tabId and profileId: returns the existing tab unchanged (no
   * onTabCreated, `url` ignored; call navigate). Rejects with ERR_TAB_EXISTS when the tabId is
   * open in another profile; close it first. A new tab emits onTabCreated with reason 'api'.
   */
  openTab(options: {
    tabId: BrowserId
    profileId: BrowserId
    /** http, https or about:blank. */
    url?: string
  }): Promise<BrowserTabState>
  /** Idempotent: an unknown tabId resolves without an event. Emits onTabClosed reason 'api'. */
  closeTab(tabId: BrowserId): Promise<void>
  /** Marks the tab active for extension tabs/windows APIs. */
  activateTab(tabId: BrowserId): Promise<void>
  navigate(tabId: BrowserId, url: string): Promise<void>
  goBack(tabId: BrowserId): Promise<void>
  goForward(tabId: BrowserId): Promise<void>
  reload(tabId: BrowserId): Promise<void>
  stopLoading(tabId: BrowserId): Promise<void>
  getTab(tabId: BrowserId): Promise<BrowserTabState>
  /** Exact `getSelection().toString()` from an isolated world, clamped to 32000 UTF-16 units, 3 s timeout. */
  getSelection(tabId: BrowserId): Promise<BrowserSelection>

  /** Presents the system folder picker and stages a managed copy for review. Null if cancelled. */
  pickExtensionFolder(): Promise<StagedExtension | null>
  /** Stages a managed copy from an unpacked folder file:// URI the app can read. */
  stageExtension(folderUri: string): Promise<StagedExtension>
  discardStagedExtension(stagingId: BrowserId): Promise<void>
  /** Installs into one profile with only the approved grant. Nothing is auto-granted. */
  installExtension(options: {
    stagingId: BrowserId
    profileId: BrowserId
    grant: ExtensionGrant
  }): Promise<InstalledExtension>
  listExtensions(profileId: BrowserId): Promise<InstalledExtension[]>
  setExtensionEnabled(
    profileId: BrowserId,
    extensionId: BrowserId,
    enabled: boolean,
  ): Promise<InstalledExtension>
  /** Replaces the grant; anything left out is no longer granted (takes effect on the next page load). */
  setExtensionGrant(
    profileId: BrowserId,
    extensionId: BrowserId,
    grant: ExtensionGrant,
  ): Promise<InstalledExtension>
  removeExtension(profileId: BrowserId, extensionId: BrowserId): Promise<void>
  /** Runs the extension action for the tab; WebKit presents its popup natively when it has one. */
  performExtensionAction(
    profileId: BrowserId,
    extensionId: BrowserId,
    tabId?: BrowserId | null,
  ): Promise<void>
  closeExtensionPopup(): Promise<void>
  /**
   * Answers onExtensionPermissionPrompt. `grant` must be a subset of the prompt; for URL prompts put
   * the approved entries of `urls` in `grant.matchPatterns`. An empty grant denies.
   */
  resolveExtensionPermissionPrompt(requestId: string, grant: ExtensionGrant): Promise<void>

  addListener<K extends keyof DovoWebKitBrowserEvents>(
    name: K,
    listener: DovoWebKitBrowserEvents[K],
  ): { remove(): void }
}

export type DovoWebKitBrowserViewProps = ViewProps & {
  /** Hosts the native WKWebView of an open tab. One mounted view per tab. */
  tabId: BrowserId
}

export const DovoWebKitBrowser =
  requireOptionalNativeModule<DovoWebKitBrowserModule>('DovoWebKitBrowser')

export const DovoWebKitBrowserView: ComponentType<DovoWebKitBrowserViewProps> | null =
  DovoWebKitBrowser ? requireNativeView('DovoWebKitBrowser') : null
