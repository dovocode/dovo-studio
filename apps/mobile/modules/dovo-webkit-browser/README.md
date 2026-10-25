# DovoWebKitBrowser (iOS)

Native browser tabs for the mobile app, built on `WKWebView`, persistent named `WKWebsiteDataStore`s
and WebKit's own `WKWebExtension` runtime. It does not emulate extension APIs in JavaScript and it
is not a Chrome engine: extensions run on WebKit's implementation of the WebExtensions API, with
Apple's API surface and behaviour. Android does not register this module.

`index.ts` is the typed contract. The module is off until `setEnabled(true)`; turning it off closes
every tab and popup and unloads every extension context. All other calls then reject with
`ERR_DISABLED`.

## Availability

| Feature                                                        | Requirement |
| -------------------------------------------------------------- | ----------- |
| Tabs and named profiles (`WKWebsiteDataStore(forIdentifier:)`) | iOS 17      |
| `WKWebExtension`, `WKWebExtensionController`, action popups    | iOS 18.4    |

The pod targets iOS 16.4 like ExpoModulesCore and checks availability at runtime. Calls that need a
newer system reject with `ERR_UNSUPPORTED`. `getStatus()` reports both flags.

## Profiles

Each `profileId` maps to a UUID stored in `Application Support/DovoWebKitBrowser/profiles.json`.
That UUID names both the profile's `WKWebsiteDataStore` (cookies, localStorage, IndexedDB, cache)
and its persistent `WKWebExtensionController.Configuration`, so extension storage is per profile
too. Tabs opened by `target=_blank`, `window.open` (OAuth popups keep `window.opener`) or an
extension use the opener's WebKit configuration, so they stay in the same profile.

## Security model

- Page web views have no script message handlers, so untrusted pages have no bridge into the app.
- Authentication challenges use WebKit's default handling. The module never supplies credentials.
- Tabs can only be pointed at `http`, `https` and `about:blank` from JS. HTTP stays supported for
  LAN and VPN hosts and is never upgraded. Top-level `data:` navigations and other schemes are
  blocked (`onExternalUrlBlocked`).
- Alerts and confirms only show for tabs on screen.
- Selection reads run in a private `WKContentWorld`, are clamped to 32000 UTF-16 units without
  splitting a surrogate pair, and time out after 3 s.

## Extensions

1. `pickExtensionFolder()` (system folder picker) or `stageExtension(fileUri)` copies an unpacked
   folder into managed storage. Symlinks, special files, more than 5000 files or 64 MB are refused.
   The returned review lists requested and optional permissions and host match patterns, plus
   `unsupportedPermissions`: manifest permissions WebKit does not implement (for example `debugger`,
   `identity`, `offscreen`) and `nativeMessaging`, which Dovo never grants.
2. `installExtension({ stagingId, profileId, grant })` grants exactly the approved subset. Anything
   outside the extension's requests, and `nativeMessaging`, is rejected. Nothing is auto-granted; a
   content script that matches `<all_urls>` only runs on hosts the user granted.
3. Installed extensions reload from disk with their recorded grants after an app restart. The record
   is authoritative over permission state WebKit persisted itself.
4. `permissions.request()` and host-access requests raise `onExtensionPermissionPrompt`; answer with
   `resolveExtensionPermissionPrompt`. Unanswered prompts are denied after 60 s.
5. `performExtensionAction` runs the action; if it has a popup, WebKit's own `popupViewController`
   is presented natively.

`browser.runtime.sendNativeMessage`, `browser.runtime.connectNative`, `browser.windows.create` and
`browser.windows.remove` are set as `unsupportedAPIs`, so they are `undefined` for feature
detection. Each profile exposes one extension window holding that profile's tabs.

### Limits

- Up to 100 live tabs across all profiles (`getStatus().maxTabs`); more rejects with `ERR_LIMIT`.
  Each tab is a live `WKWebView`. When iOS reclaims the content process of a tab that is not on
  screen, the tab reports `loadState: 'idle'` with an error note and reloads when it is shown again.

- Unpacked folders only. `.crx` files and Chrome Web Store installs are not supported; unzip first.
  WebKit loads arbitrary third-party unpacked folders through `WKWebExtension(resourceBaseURL:)`;
  the fixture test confirms this on iOS 27.
- WebKit's API coverage differs from Chrome's: Chrome-only APIs (`debugger`, `identity`,
  `offscreen`, `sidePanel`, `downloads`, `history`, `bookmarks`, …) do not exist. `webRequest`
  blocking is not available; use `declarativeNetRequest`.
- Selection reads the main frame only. Downloads, file uploads beyond WebKit's defaults, and
  extension keyboard commands are not wired up.
- Extension pages opened from an extension popup (inside WebKit's popup web view) are handled by
  WebKit, not routed through the module's tab registry.
- `WKWebsiteDataStore.allDataStoreIdentifiers` crashes inside WebKit when called before any web view
  exists, so the module never enumerates stores. `removeProfile` removes the store by its
  identifier, or clears its data if WebKit still holds it.

## Simulator tests

`tests/run-simulator-harness.sh <simulator-udid>` runs on a Mac with Xcode. It compiles the core
Swift files (everything except the Expo wrapper) into a standalone harness app with bundle id
`com.dovo.webkitbrowser.harness`, installs it on the given booted simulator, serves
`tests/fixture-site` over plain HTTP and runs:

- phase 4: warms the host HTTP server. The first simulator request to a freshly started Python
  `http.server` on macOS stalls about 30 s whatever the data store is.
- phase 1: input validation, the disabled gate, two profiles with isolated cookies and storage,
  staging and permission review of `tests/fixture-extension`, refused grants, content script
  injection in the isolated world on granted hosts only, `storage.local`, selection exactness and
  clamping, `target=_blank` and OAuth-style `window.open`/`window.opener`/`window.close`, the native
  action popup (`tabs.query`, hidden unsupported APIs), and unloading on disable.
- phase 2 (new process): the extension and its grants reload from disk, extension storage, cookies
  and localStorage persist per profile, revoke/disable/enable/remove, and profile removal.

`PHASES="1 2" run-simulator-harness.sh …` selects phases. `PHASES="4 1 6"` adds a visual showcase
for screenshots: a `work` tab with the fixture's content-script banner, the native action popup,
then a `personal` tab without the extension.

## Storage and media limits

Persisted profile and extension catalogues reject corrupt, duplicate or mismatched identities; only
missing files mean empty state. Status lists saved profiles without starting their extension
workers. Removal saves an extension as disabled before unloading and deleting its files, and reports
cleanup errors rather than silently restoring an enabled extension after restart. Inspect reported
storage errors before retrying; Dovo does not reset damaged catalogues automatically.

`BrowserStatus.websiteTabCaptureAvailable` is `false`, with `websiteTabCaptureUnavailableReason`:
iOS WebKit has no public API for sharing an arbitrary browser tab and its audio. Website camera and
microphone requests still use WebKit's normal permission prompts and app/OS permission settings.
There is no fake `getDisplayMedia` polyfill. Alert, confirm and text prompt dialogs are native,
suppressed in detached background tabs and cancelled on opt-out.
