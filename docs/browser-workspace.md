# Browser workspace

Enable **Browser workspace** in **Settings → General → Experimental** (off by default), then open
**Browser** in the activity bar to browse independently of a thread. The vertical recent-tab list
puts the most recently visited tab first. Add a tab on this computer or a paired runtime, enter an
address or search terms, and choose a browser profile in **Browser options** for a separate session.
Tabs retain their computer and profile when you switch the active runtime.

**Thread for this tab** links only to threads on the tab's computer. On desktop, choose **Use
{computer}** if that computer is not active before editing or creating its thread. The tab keeps its
computer and profile. Restored links to another computer require choosing a matching thread.
Device-local mobile tabs have no computer-owned thread panel; use a paired-computer tab for agent
customization. Copying a page or selection to another computer's draft remains available.

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

Desktop pages become visible when their DOM is ready, while images and other resources can continue
loading. Tooltips appear above the page and return keyboard focus after dismissal, unless you click
or type in Studio in the meantime. Menus and dialogs take focus normally.

Select page text and open **Browser options → Copy selection** to copy the literal selection, or
**Add selection to thread…** to append a quotation, page title and URL to an existing thread draft.
**Add page to thread…** appends the title and URL without requiring a selection. The destination can
be on another connected computer. Existing draft text is retained, conflicts are reported, and the
thread opens for you to review and send the draft. Empty selections produce feedback.

On desktop, use the tab-list **+** menu → **New browser window** for another window with its own
tabs. The action requires the desktop window bridge. Browser opened from a pop-out thread uses a
separate session identity and does not overwrite the main window's tabs.

Tabs, active tab, recent order, computer, profile and recently closed tabs are isolated per window.
Main-window tabs persist in localStorage. Extra windows use sessionStorage: their tabs survive a
reload, not app quit. Bookmarks and visit history use a shared localStorage library across windows.
Inactive restored remote tabs are not launched until selected. Remote sessions depend on the owning
computer being available and paired. Each remote runtime currently allows eight concurrent browser
sessions; saved inactive tabs do not reserve those sessions.

Failed remote navigation retains the session and attempted address so Reload can retry when the
server returns. Crashed remote sessions are released for reconnect. Reconnecting viewers receive any
outstanding JavaScript dialog; disconnecting clears the viewer's old dialog. Agent inspection does
not expire a session while a human viewer is attached. Private desktop preview profiles use
memory-only storage, and self-closing pages release their native tab entries.

## Desktop extensions

In a local desktop Browser tab, open **Extensions → Manage extensions** and load an unpacked
Manifest V3 folder, or paste a Chrome Web Store detail URL/extension ID. Review its permissions and
website access before loading. Extensions belong to that Browser profile, can be enabled/disabled or
removed, and can expose native action popups. They are not loaded into thread previews or
paired-runtime browsers. Turning Browser workspace off unloads extensions, stops their workers and
closes the affected native pages.

This uses Electron with `electron-chrome-extensions` 4.10.0; supported APIs are a subset of Chrome.
`nativeMessaging` connects to installed Chrome native helpers after explicit per-profile approval.
Host registrations must allow the extension’s origin; helpers use bounded Chrome stdio framing.
Turning Browser off or unloading the extension closes its helper connections. Store packages are
downloaded over official Google HTTPS endpoints; the CRX3 developer signature and requested
extension ID are verified before bounded ZIP extraction and permission review. Store extensions
update manually by installing the same link again. Older copies with removed `nativeMessaging` must
be reinstalled and reviewed to gain it. On macOS, 1Password also requires the signed Dovo Studio app
in **1Password Settings → Browser → Add Browser**
([1Password instructions](https://support.1password.com/additional-browsers/)). Dovo never
impersonates Chrome or bypasses that approval. Native transport is tested, but a real 1Password
desktop pairing has not been verified; general Chrome extension parity is not claimed. Unsupported
APIs/permissions and load errors are reported by the extension manager. Extension-created tabs
retain their native identity and profile, and native close events remove them from the tab list.
Extension URL pages are session-only and are not restored from saved tabs.

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
engine limits without interrupting navigation. Android uses the platform WebView through React
Native WebView; website tab/audio capture is not advertised or polyfilled and remains unverified on
an Android device.

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
Thread cases cover stale cross-computer links, owner activation, profile retention and real composer
draft persistence through panel close/reopen. `node scripts/check-remote-browser-sessions.mjs` uses
real managed Chromium for unavailable-server recovery, crash cleanup and dialog reattachment.
`node scripts/check-browser-viewer-ui-browser.mjs` checks dialog dismissal/reconnect and
Control/Meta workspace shortcut forwarding from the viewer. Screenshots are written to
`work/shared-browser/desktop.png`, `work/shared-browser/narrow.png` and
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
permission review and requests, approved native messaging, profile/preview isolation, feature-off
worker shutdown, restart persistence and removal. Its folder picker and confirmation dialogs are
scripted. `node scripts/check-browser-extensions-browser.mjs` also passed the extension-manager UI
checks. These results prove the fixture flows, not arbitrary third-party extensions or password
managers.

The same production fixture also passed both fresh-process runs on the Mac Studio using Electron
45.0.0 (darwin-arm64). It exercised a registered native helper through the actual extension API,
including UTF-8 framing and approval. Results and logs are retained under
`/tmp/dovo-desktop-native-review` on that Mac. The installed Studio app and its profiles were
untouched. Actual 1Password pairing remains unverified: older installations need reinstalling to
review native messaging access, and 1Password must trust the signed Studio app through **Settings →
Browser → Add Browser**.

## Mobile

The experimental mobile Browser works without pairing for device browsing. It keeps bounded tabs
(100), bookmarks (100), history (200) and recently closed tabs (20) on this phone. Use **Tabs** to
choose the device or a paired computer for a new tab; remote tabs retain their computer and named
profile. **Browser options** holds profile management so those controls do not crowd the page. Use
the header Back action to return to threads; page Back and Forward control website history.

**Browser extensions are desktop-only.** Mobile does not install or run browser extensions. Android
uses the existing platform WebView through React Native WebView, with OS-managed browser-engine
updates. The custom upstream Chromium APK effort has been stopped; its unpublished proof sources and
build cache are preserved locally, outside the shipped app. No Chromium companion or additional
browser activity ships with Studio.

The optional iOS native module provides separate website data profiles on **iOS 17+**. Android and
older iOS binaries use the RNWebView baseline: one device login session, without separate local
profiles. Saved named-profile tabs remain blocked on that fallback rather than silently sharing its
cookies. Localhost means this phone for device tabs and the paired host for remote tabs; explicit
HTTP stays HTTP. Use **Bookmarks and history** to find or reopen pages. Copy preserves selected
text; adding a page or selection appends to the chosen thread's **phone draft**, preserves existing
text and never sends. Review in the composer. If saving fails, the quotation may already be visible
there: inspect the composer before adding it again.

The optional native iOS engine follows the experimental app setting. Switching between Browser and a
thread detaches its view while retaining live tabs. Fallback and remote WebViews remain mounted
while Browser loses focus; remote transport reconnects on return. Pinned native tabs reopen if the
page closes itself, and background page errors do not replace the active tab's feedback. Feature-off
or app-shell teardown disables the engine. A bounded registry reconciles tabs created or closed
while the Browser route was hidden; native instance identities prevent stale close events from
removing a newer tab. Native status reports the live-tab limit, currently 100 across profiles.

Run `pnpm exec playwright install chromium`, then
`node scripts/check-mobile-shared-browser-browser.mjs`. This bundles the real `BrowserScreen`, route
gate, remote browser/toolbar, state model and draft append/storage implementation with React Native
DOM adapters and mock WebViews, remote viewer, clipboard and runtimes. It checks the default-off
gate without native calls, local HTTP/search, remote ownership/profiles, MRU, persistence,
library/reopen, exact selection copy, targeted draft preservation, persistence errors and absence of
workspace PATCH/send calls. Its separate native-contract fixture checks profiles in Browser options,
live-tab reuse, route changes, stale events and engine disable. These mocks do not prove either
native engine or a paired-host connection. Adapter screenshots verify UI flow and narrow overflow,
not native layout fidelity.

A review copy of the full DovoStudio Debug simulator app was installed with a separate bundle ID,
`com.dovo.studio.browserreview`, and loaded the checkout's actual Studio JavaScript through Metro.
The iOS 27 simulator check navigated an HTTP fixture through native WebKit, copied its exact
selected text to the simulator clipboard, and switched to a named profile with independent
localStorage (the original profile reported two visits, the new profile one). This verifies the
actual JS/native browsing path, rather than only a standalone native harness. The unsigned review
copy showed a keychain-entitlement warning, so pairing and authenticated flows were not verified.
The normal app and its pairings were preserved. After removing native extensions, the revised module
passed Mac Swift typechecking, a browser-only simulator harness (53 checks plus 7 in a fresh
process), and a full Debug simulator app build. The rebuilt isolated Studio app also passed HTTP
navigation and exact selection-to-clipboard through the actual JS/native bridge. Returning from
threads reused the live page. Earlier profile-isolation proof preceded this rebuild; the revised
standalone harness independently verifies profile isolation and persistence.

Physical iPhone behavior, iOS 17–18.3 runtime behavior and Android device browsing remain
unverified. Device Hub discovery on 26 October found no Android target. Website camera/microphone
access and arbitrary-tab capture are separate capabilities; see the media limits above. The native
iOS module's [README](../apps/mobile/modules/dovo-webkit-browser/README.md) documents its API and
verification commands.

## Browser usability

Selecting a tab preserves its position; navigating moves it to the top of the recent list. Desktop
tabs, bookmarks and history show favicons when available, with a globe fallback. Remote localhost
icons are never fetched from the local computer.

Detached Browser windows contain Browser controls only. Page and selection actions create or append
an unsent draft, preserving existing draft text. In the main window, workspace synchronization does
not block opening the draft; detached windows synchronize before opening a separate thread window.
Native desktop context menus provide copying, link navigation, editing and adding content to a
draft. Password selections are excluded from copying to threads.

Website requests use a standard Chromium user agent. Real Electron verification reached Teams'
Microsoft sign-in page; authenticated Teams calls and enterprise-account policies remain unverified.

### Client editors

“Open in” detects applications on the desktop client. The authenticated runtime only resolves the
checkout/file path; it does not launch an editor. Matching local runtime identities open local
paths. Other runtimes use their configured SSH address with Zed or VS Code, VS Code Insiders,
VSCodium, Cursor, Windsurf, Antigravity, or Devin Desktop. The chosen editor must have its SSH
support installed and the client must have SSH access. Missing SSH settings, unsupported remote
targets and missing client applications produce explicit errors. Browser-only clients explain that
the desktop app is required; they never silently launch an application on the server.
