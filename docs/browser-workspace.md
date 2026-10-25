# Browser workspace

Enable **Browser workspace** in **Settings → General → Experimental** (off by default), then open
**Browser** in the activity bar to browse independently of a thread. The vertical recent-tab list
puts the most recently visited tab first. Add a tab on this computer or a paired runtime, enter an
address or search terms, and choose a browser profile in **Browser options** for a separate session.
Tabs retain their computer and profile when you switch the active runtime.

Shared Browser sessions are separate from the thread's right-side preview. Profile names can be
reused across both surfaces, but their login cookies are isolated; signing in on one does not sign
you in on the other.

The address bar searches Google for words, uses HTTPS for bare public domains and HTTP for local
addresses such as `localhost:3000`. Explicit HTTP addresses stay HTTP. Local tabs reach services on
the desktop computer; paired-runtime tabs resolve localhost against that runtime's host. HTTP over
LAN and VPN remains supported. Pairing codes and device tokens remain required; no account or
external login is required.

Use the star or Ctrl/Cmd+D to bookmark a page. **Bookmarks and history** searches bookmarks, recent
visits and recently closed tabs by page, computer or profile. Opening a saved page retains its
source computer and profile. The library also removes bookmarks, clears history and reopens the last
closed tab.

In the Browser workspace, Ctrl/Cmd+L focuses the address bar, Ctrl/Cmd+T opens a tab with the
current tab's computer and profile, Ctrl/Cmd+W closes it, Ctrl/Cmd+Shift+T reopens the last closed
tab and Ctrl/Cmd+R reloads. Native page links that open a new window become tabs using the source
profile.

Select page text and use **Copy selection** to copy the literal selection, or **Add selection to
thread…** to append a quotation, page title and URL to an existing thread draft. **Add page to
thread…** appends the title and URL without requiring a selection. The destination can be on another
connected computer. Existing draft text is retained, conflicts are reported, and the thread opens
for you to review and send the draft. Empty selections produce feedback.

On desktop, use the tab-list **+** menu → **New browser window** for another window with its own
tabs. The action requires the desktop window bridge. Browser opened from a pop-out thread uses a
separate session identity and does not overwrite the main window's tabs.

Tabs, active tab, recent order, computer, profile and recently closed tabs are isolated per window.
Main-window tabs persist in localStorage. Extra windows use sessionStorage: their tabs survive a
reload, not app quit. Bookmarks and visit history use a shared localStorage library across windows.
Inactive restored remote tabs are not launched until selected. Remote sessions depend on the owning
computer being available and paired. Each remote runtime currently allows eight concurrent browser
sessions; saved inactive tabs do not reserve those sessions.

## Desktop extensions

In a local desktop Browser tab, open **Browser options → Browser extensions** and load an unpacked
Manifest V3 folder. Review its permissions and website access before loading. Extensions belong to
that Browser profile, can be enabled/disabled or removed, and can expose native action popups. They
are not loaded into thread previews or paired-runtime browsers. Turning Browser workspace off
unloads extensions, stops their workers and closes the affected native pages.

This uses Electron with `electron-chrome-extensions` 4.10.0; supported APIs are a subset of Chrome.
`nativeMessaging` is removed and blocked. Chrome Web Store installation is unavailable. No 1Password
compatibility, desktop password-manager integration or general Chrome extension compatibility is
claimed. Unsupported APIs/permissions and load errors are reported by the extension manager.
Extension-created tabs retain their native identity and profile, and native close events remove them
from the tab list. Extension URL pages are session-only and are not restored from saved tabs.

## Website and call tab capture

Website screen sharing (for example, a call's `getDisplayMedia` request) is separate from audio in
Dovo's remote browser stream. On desktop, the consent picker offers HTTP/HTTPS tabs from the same
Browser profile and window. Optional tab audio starts unchecked; camera and microphone access
require separate approval. A visible global indicator shows active sharing, and Stop waits for
native confirmation before reporting that capture has ended.

The production Linux fixture, `node apps/desktop/scripts/check-browser-media-native.mjs`, passed
three runs (baseline, hardened and final), recorded in
`/tmp/dovo-media-native-{baseline,hardened,final}.log`. The final run captured real 1200×732 video
frames (876,936 colored pixels) and sampled tab audio (peak 0.1367). Explicitly declining audio
produced a video-only stream even when the page requested audio. Stop ended real tracks and the
native capturer count without reloading or losing an unsent draft. The fixture also covers
cancellation, separate camera/microphone approvals, source closure and feature opt-out. Hardened
handling uses document-scoped grants, keepAlive and source-exclusive track attribution; the final
desktop capture hardening suite passed 91 tests. The native script is registered in the root checks
and CI. An additional real background-capture run, `/tmp/dovo-media-native-background.log`, passed
with the source created first and requester visible: video and audio continued after seven idle tabs
triggered the greater-than-four-tab eviction threshold. Both capture participants survived, and the
requester's page marker stayed unchanged on return. That run also verifies explicit audio opt-out.
This is Linux fixture proof: live Meet/Discord accounts and macOS/Windows OS permission prompts have
not been tested.

iOS does not support arbitrary-tab video/audio capture through `getDisplayMedia`; Dovo does not
provide a fake polyfill. Website calls can request camera and microphone access with separate
approval; this does not enable arbitrary-tab sharing. Mobile **Browser options** explains these
engine limits without interrupting navigation. The Android backend preserves upstream Chromium's
capture picker and Stop controls, but its APK build and device verification remain pending.

## Comparison reference

Comparison pinned to
[T3 `03d1a909153d593805a80b4c691eda31ac3f3c46`](https://github.com/pingdotgg/t3code/tree/03d1a909153d593805a80b4c691eda31ac3f3c46/apps/desktop/src/preview):
`Manager.ts`, `BrowserSession.ts`, `BrowserImport/*` and `PasskeyBridge.ts`. No Chrome extension
support was found in that implementation. Patterns being adopted cover popup handling, menu
shortcuts and POST navigation. Cookie import and passkeys were investigated only; neither is
implemented in Dovo. Dovo’s extension behavior is described separately above; the comparison and
earlier feasibility spike do not establish third-party extension compatibility.

## Limits and verification

This is a development browsing surface, not a promise of Chrome parity. Saved tabs are local UI
state, not synchronized browser sessions. Restoring a tab does not promise restoration of forms,
navigation stacks or a live remote process. Remote interaction depends on connectivity and the
streamed browser. Selection capture is bounded to 32,000 characters; it is not a page scraper. Copy
uses the client clipboard permission. Extension support depends on the platform, available APIs and
reviewed permissions; Chrome parity is not promised. Page-created links open in background tabs with
the source profile, without changing the active tab, up to the 100-tab workspace cap.

Run `pnpm exec playwright install chromium`, then `node scripts/check-shared-browser-browser.mjs`.
The check bundles the real BrowserPane and production DOM selection extractor with two mocked
runtime owners and a mock remote viewer. It covers literal document/textarea selections, password
exclusion, the selection bound, exact clipboard text, source-preserving thread drafts, remote
conflicts, tab ownership/profiles, recent ordering, persistence, lazy restoration, search, library
filtering/reopening, shortcuts, page drafts and native opened-link status handling. It also checks
that **New browser window** calls the desktop bridge once and native session keys include the window
and tab. Direct BrowserPane checks bypass the experimental gate. A separate case in this same script
renders the real BrowserView: default-off mounts no pane or host calls, enabling mounts the pane,
and disabling unmounts it and hides its native session. Native window creation has separate tests.
Additional cases flood background opened links to the 100-tab cap and verify pop-out thread
native/session-storage isolation from main-window tabs. Native `createdTabs`/`closedTabs` cases
verify adoption without opening a duplicate view, retained profiles and session-only extension URLs.
Screenshots are written to `work/shared-browser/desktop.png`, `work/shared-browser/narrow.png` and
`work/shared-browser/narrow-library.png`. Narrow checks use a 380-pixel viewport and reject
horizontal document overflow. Styles are reapplied after fixture reloads.

The check does not launch Electron's native browser view, authenticate against a real paired
runtime, or verify arbitrary websites. Those require a desktop and paired-host smoke test. Shortcuts
are tested with Control in the web shell; native-view focus and macOS Command handling still need
desktop testing. Opened-link coverage injects the native status queue rather than clicking a real
`target=_blank` link in Electron.

The separate production Electron fixture,
`node apps/desktop/scripts/check-browser-extensions-native.mjs`, passed both process runs. It
verifies a small MV3 fixture’s content script, popup messaging, tabs/windows/storage/action APIs,
permission review and requests, blocked native messaging, profile/preview isolation, feature-off
worker shutdown, restart persistence and removal. Its folder picker and confirmation dialogs are
scripted. `node scripts/check-browser-extensions-browser.mjs` also passed the extension-manager UI
checks. These results prove the fixture flows, not arbitrary third-party extensions or password
managers.

## Mobile

The experimental mobile Browser works without pairing for device browsing. It keeps bounded tabs
(100), bookmarks (100), history (200) and recently closed tabs (20) on this phone. Use **Tabs** to
choose the device or a paired computer for a new tab; remote tabs retain their computer and named
profile. The optional iOS native module provides separate website data profiles on **iOS 17+** and
WebKit WebExtensions on **iOS 18.4+**. Older binaries and unsupported systems retain the RNWebView
baseline: one device login session, without separate local profiles. Saved named-profile tabs stay
blocked on that fallback rather than sharing its cookies. Localhost means this phone for device tabs
and the paired host for remote tabs; explicit HTTP stays HTTP. Use **Bookmarks and history** to find
or reopen pages. Copy preserves selected text; adding a page or selection appends to the chosen
thread's **phone draft**, preserves existing text and never sends. Review in the composer. If saving
fails, the quotation may already be visible there: inspect the composer before adding it again.

Run `pnpm exec playwright install chromium`, then
`node scripts/check-mobile-shared-browser-browser.mjs`. This bundles the real `BrowserScreen`, route
gate, remote browser/toolbar, state model and draft append/storage implementation with React Native
DOM adapters and mock WebViews, remote viewer, clipboard and runtimes. It checks the default-off
gate without native calls, local HTTP/search, remote ownership/profiles, MRU, persistence,
library/reopen, exact selection copy, targeted draft preservation, persistence errors and absence of
workspace PATCH/send calls. Reviewed 390-pixel dark screenshots are written to
`work/mobile-shared-browser/narrow.png` and `narrow-library.png`. Adapter screenshots verify UI flow
and narrow document overflow, not native layout fidelity. This suite does not verify WKWebView, an
Android Chromium backend, extension engines, real clipboard permissions or a paired-host connection.
Native engine work remains separate; no Chrome extension compatibility is established by these UI
checks.

The optional native iOS engine follows the app experimental setting: switching between Browser and a
thread detaches its native view while retaining live tabs and extension workers. Feature-off or
app-shell teardown disables the engine. WebKit WebExtension controls appear only when the module
reports extension availability: choose an unpacked folder, review supported permissions and website
patterns, then install with only checked grants. Unsupported permissions are never offered.
Enable/disable and removal require confirmation; extension actions use native popups. Later access
requests require another review and are denied on dismissal. Changes to installed grants apply on
the next page load; reload the page to apply them. Unpacked folders are supported; `.crx` and Chrome
Web Store installs are not. This is WebKit WebExtension integration, not a claim of Chrome
compatibility. The UI suite separately mocks this contract to check native profile changes, live-tab
reuse, tab events while visiting a thread, exact copy, permission subsets, confirmations and engine
disable. It does not prove the Swift module, popup presentation or extension execution on a device.

The native owner reports a passing full DovoStudio Debug simulator build from a scratch copy on Mac
Studio (Xcode 27.1, iOS 27.1 SDK): the pod autolinks without Podfile/app changes and the native
module compiles with zero warnings. The TypeScript contract also passes the mobile typecheck. The
real core passed **120/120** checks in phase 1 and **31/31** in a fresh phase-2 process using
`apps/mobile/modules/dovo-webkit-browser/tests/run-simulator-harness.sh` on the iOS 27 simulator.
This standalone harness uses WKWebView/WKWebExtension directly, separate from the Dovo app. The
final hardening run also verifies corrupt/duplicate catalogue rejection, failed deletion without
enabled worker resurrection, credential-URL rejection, password/non-text input selection exclusion,
persisted-profile discovery without starting workers, native prompt cancellation and profile-loading
opt-out races. Final logs are `/tmp/dovo-ios-hardening-harness-final.log` and
`/tmp/dovo-ios-hardening-app-build.log`; the latter is a successful full Debug simulator build of
the updated native sources. `websiteTabCaptureAvailable: false` and its reason are native status
fields, not an inferred result from the UI fixture.

Its MV3 fixture proves host-granted isolated-world content scripts, native action popups, refused
`nativeMessaging`, profile isolation, extension/grant/storage persistence, revoke/disable/remove,
profile removal, same-profile `target=_blank` and OAuth opener/close behavior, exact bounded
selection, and gate shutdown. Device Hub screenshots show the work profile’s injected banner and
native popup, and the personal profile without the extension. This proves the fixture, not general
Chrome compatibility. Native-to-JS calls inside the actual Dovo app remain unverified: that app was
compiled but not installed. Runtime behavior on iOS 17–18.3 also remains unverified. See the
module’s [README](../apps/mobile/modules/dovo-webkit-browser/README.md) for security details and API
limits. Native status reports the live-tab limit (currently 100 across profiles); the saved
workspace also allows 100 tabs.

Android’s chosen direction is **one APK with separate Chrome and Studio activities**, using an
upstream Chromium build rather than a claim of Chrome extensions inside Android WebView. That build
and integration are in progress with the Android backend owner; no successful build, extension
execution or device verification is claimed here. RNWebView remains the baseline until an available,
integrated native backend is verified.
