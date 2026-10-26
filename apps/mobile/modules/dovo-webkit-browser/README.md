# DovoWebKitBrowser (iOS)

Native browser tabs built on `WKWebView` and persistent named `WKWebsiteDataStore`s (iOS 17+).
Android uses its platform WebView and does not register this module. Browser extensions are not
supported. `index.ts` is the typed contract.

The module defaults off. `setEnabled(false)` closes every tab, cancels native dialogs and releases
profile runtimes. Browser operations reject with `ERR_DISABLED` until enabled. Status remains
readable and reports saved profiles without opening their stores. The pod targets iOS 16.4 like
ExpoModulesCore; browsing calls reject with `ERR_UNSUPPORTED` below iOS 17.

## Profiles and tabs

Each `profileId` maps to a stable UUID in `Application Support/DovoWebKitBrowser/profiles.json`.
That UUID names its persistent website data store (cookies, localStorage, IndexedDB and cache).
`target=_blank` and `window.open` use the opener's WebKit configuration and profile; OAuth popups
keep `window.opener` and can close themselves through `window.close`.

Opening the same tab ID in the same profile returns the existing tab without navigation or another
creation event. Reuse in another profile rejects until closed. Reopening creates a new `instanceId`;
callers must match it when processing events. Native callbacks from closed instances are ignored.
Closing an unknown tab is a no-op. Up to 100 live tabs and 16 saved profiles are supported.
Background tabs whose content process iOS reclaims reload when shown, avoiding mass background
reloads.

Profile catalogues reject corruption, invalid IDs and duplicate identities; only missing files mean
empty state. Removal closes the profile's tabs and removes its named store, or clears its data if
WebKit still holds the store. The module never enumerates all stores because that WebKit API can
crash before any web view exists.

## Safety and limits

- Page web views have no script message handlers or app bridge. The module supplies no
  authentication credentials; WebKit handles authentication challenges normally.
- JS navigation accepts HTTP, HTTPS and `about:blank`, rejecting URLs containing credentials. HTTP
  stays supported for LAN and VPN connections and is never upgraded.
- Other external schemes and top-level `data:` navigation are blocked. `onExternalUrlBlocked` lets
  the app offer external opening where appropriate.
- Alert, confirm and text prompt dialogs are native, suppressed for detached background tabs and
  cancelled on opt-out.
- Selection reads the main frame in a private `WKContentWorld`, preserving exact text and focused
  text-field ranges while excluding password and other unsuitable inputs. Results are capped at
  32000 UTF-16 units without splitting surrogate pairs, with a 3-second timeout.
- `websiteTabCaptureAvailable` is always `false`, with an explanatory reason: iOS WebKit has no
  public API for sharing arbitrary website tabs and their audio. Camera/microphone access still
  follows WebKit and app/OS permission settings. There is no `getDisplayMedia` polyfill.

## Simulator harness

On a Mac with Xcode, run `tests/run-simulator-harness.sh <booted-simulator-udid> [port]`. This
compiles the current core Swift files (excluding the Expo wrapper) into the separate
`com.dovo.webkitbrowser.harness` app, installs only that harness and serves browser fixtures over
HTTP. It does not install Dovo Studio.

- Phase 4 warms the HTTP fixture server and diagnoses first-load latency.
- Phase 1 checks the default-off gate, URL/catalogue validation, isolated profiles, tab identity,
  stale callback guards, tab limits, exact and clamped selection, target-blank/OAuth behavior,
  background prompt suppression, native prompt cancellation and capture capability.
- Phase 2 starts a new process to verify per-profile cookies/localStorage persistence and profile
  removal.

Use `PHASES="1 2"` to select phases; phases 3–5 are plain-WKWebView latency diagnostics. Historical
extension-heavy harness results do not validate this browser-only source. Run the revised harness,
Swift typecheck and full app build when verifying this version; the harness alone does not compile
the Expo wrapper or prove the app's JavaScript/native integration.
