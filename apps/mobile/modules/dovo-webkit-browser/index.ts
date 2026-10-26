// Typed contract for the iOS-only DovoWebKitBrowser native module.
// Native browsing uses WKWebView with one persistent WKWebsiteDataStore per profile (iOS 17+).
// Android uses its platform WebView and does not register this module.
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import type { ComponentType } from 'react'
import type { ViewProps } from 'react-native'

/** `^[A-Za-z0-9_-]{1,64}$`. Profiles and tabs share this id shape. */
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
  /** Tab that opened this one through target=_blank or window.open. */
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

export type BrowserTabCreatedReason = 'api' | 'targetBlank' | 'windowOpen'

/**
 * api: closeTab(). page: window.close(), e.g. after OAuth.
 * profileRemoved: removeProfile(). setEnabled(false) closes tabs without events.
 */
export type BrowserTabClosedReason = 'api' | 'page' | 'profileRemoved'

export type BrowserSelection = { text: string; truncated: boolean }

export type BrowserProfile = { profileId: BrowserId; dataStoreIdentifier: string }

export type BrowserStatus = {
  enabled: boolean
  /** WKWebsiteDataStore(forIdentifier:) is available (iOS 17+). */
  browsingAvailable: boolean
  /** Arbitrary website tab video/audio capture has no public iOS WebKit API. */
  websiteTabCaptureAvailable: false
  websiteTabCaptureUnavailableReason: string
  systemVersion: string
  /** Live native tab cap across all profiles (100). openTab beyond it rejects with ERR_LIMIT. */
  maxTabs: number
  profiles: BrowserProfile[]
  tabs: BrowserTabState[]
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
}

export type DovoWebKitBrowserModule = {
  /** Default off. Disabling closes all tabs and cancels native dialogs. */
  setEnabled(enabled: boolean): Promise<BrowserStatus>
  getStatus(): Promise<BrowserStatus>
  /** Older app binaries omit this; cleanup must keep their native tabs. */
  getActiveMediaTabIds?(): Promise<BrowserId[]>

  ensureProfile(profileId: BrowserId): Promise<BrowserProfile>
  /** Replaces this profile's DOM-ready website customizations for future loads. */
  setWebsiteCustomizationScripts?(profileId: BrowserId, scripts: string[]): Promise<void>
  /** Closes the profile's tabs and deletes its website data store. */
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
  /** Marks the tab active in its profile. */
  activateTab(tabId: BrowserId): Promise<void>
  navigate(tabId: BrowserId, url: string): Promise<void>
  goBack(tabId: BrowserId): Promise<void>
  goForward(tabId: BrowserId): Promise<void>
  reload(tabId: BrowserId): Promise<void>
  stopLoading(tabId: BrowserId): Promise<void>
  getTab(tabId: BrowserId): Promise<BrowserTabState>
  /** Exact `getSelection().toString()` from an isolated world, clamped to 32000 UTF-16 units, 3 s timeout. */
  getSelection(tabId: BrowserId): Promise<BrowserSelection>

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
