# Browser workspace

Enable **Browser workspace** in **Settings → General → Experimental** (off by default), then open
**Browser** in the activity bar to browse independently of a thread. The vertical recent-tab list
puts the most recently visited tab first. Add a tab on this computer or a paired runtime, enter an
address or search terms, and choose a browser profile in **Browser options** for a separate session.
Tabs retain their computer and profile when you switch the active runtime. New blank tabs focus the
starter address input in Browser and Unified. This also applies when a profile or private tab opens
from the new-tab menu.

On desktop and web, use the sidebar to switch Browser tabs. Use the plus button next to Bookmarks to
open a tab. Use the chevron for profile and private tab options. Back and Forward sit next to the
address field in the workspace header. A pinned tab also shows its Home button before Back. Pages
fill the preview pane. In the desktop app, choose **Browser options → Open DevTools** on a local
page to open the inspector below it. Close it with the inspector's close button. The **Workspace
tools** button at the right of the navigation bar also opens the tab's side thread or DevTools for a
local page.

The **Snoozed** and **Settled** tab sections use the thread section headers, counts and disclosure
controls. Empty sections stay hidden. Collapsed sections stay below open sections in the sidebar. On
mobile, the tab category picker hides **Snoozed** when no tabs are snoozed.

The iOS Browser has no top header. Device-local tabs on mobile use one solid navigation row. The
address shows the host until you edit it, then shows the full URL. Back and Forward hide during
editing to give the field more space. On narrow phones, **Forward** is in **Browser options** when
the next page is available. Go and Tabs keep their positions when focus changes. Use **Browser
options → Page actions** for sharing and page commands, or choose **Bookmarks** or **History** in
Browser options.

Run `node scripts/check-mobile-browser-navigation-browser.mjs` and
`node scripts/check-mobile-shared-browser-browser.mjs` after installing Playwright Chromium. These
checks cover layout and browser state through native adapters. A separate iOS simulator check
verified the previous navigation control, keyboard avoidance and URL submission. The current solid
navigation row has browser adapter coverage.

Choose **Browser options → Tab & page actions → Snooze tab → Choose date and time…** to set a custom
wake time on desktop/web. The tab context menu and the unified sidebar's Snooze menu have the same
option. On mobile, choose **Browser options → Choose date and time…**. The picker uses the device's
local time zone. Past times are rejected. Cancel keeps the page and tab state. A snoozed tab returns
to the active list when its wake time arrives.

Pinned tabs show a compact profile badge. Choose its emoji in **Settings → Browser → Local browser
profiles** or **Remote browser profiles**; profiles without an emoji show initials. Pinning saves
the current URL as the tab's home. Use the home button to return there. At narrow desktop widths,
find it in **Browser options**. Right-click the pin to edit its home URL. The pinned grid adapts to
the sidebar width.

**Thread for this tab** links only to threads on the tab's computer. New threads default to **No
Project**. You can select a project before you create the thread. On desktop, choose **Use
{computer}** if that computer is not active before editing or creating its thread. The tab keeps its
computer and profile. Restored links to another computer require choosing a matching thread.
Device-local mobile tabs have no computer-owned thread panel; use a paired-computer tab for agent
customization. Copying a page or selection to another computer's draft remains available.

Shared Browser sessions are separate from the thread's right-side preview. Profile names can be
reused across both surfaces, but their login cookies are isolated; signing in on one does not sign
you in on the other.

Use **Browser options** to find the computer and profile for a workspace tab. Thread previews
identify their separate session. In a remote browser, **Local address on [computer]** appears next
to navigation for a loopback address. That address refers to the named computer.

When Browser workspace is off, **Open in Dovo** uses a standalone preview window. In that window,
links with `target="_blank"` and `window.open` open child previews directly. They do not ask you to
choose where to open the link again. Child previews keep the preview session, form submissions and
normal opener behavior. This also works for nested links and pages opened blank before navigation.
Child previews close with their opener. They remain sandboxed and accept HTTP and HTTPS pages.

Verify this flow with `pnpm exec playwright install chromium`, then
`pnpm test:detached-browser-links:native`. The check uses real Electron windows with temporary
profiles. It covers new-window links, nested and delayed navigation, cookies, an opener callback,
POST forms, unsafe URL rejection and window cleanup. It has passed on Linux; macOS and Windows still
need native verification.

With **Studio Tools → Browsers** enabled on a tab's computer, agents can list and operate live
workspace tabs through `studio_browsers` (remote tabs and desktop-local tabs alike; private tabs are
always excluded). A bot badge marks tabs agents can reach, and lights up on desktop tabs while an
agent is connected to one. Right-click a tab and choose **Copy Studio ID (for agents)** to copy its
unified reference (`studio:<computer>:browser:<id>`); paste it into any thread to point an agent at
that exact tab. Threads have the matching **Copy → Studio ID (for agents)**. Desktop tabs are
reachable only while open in the desktop Browser workspace, over the same page-scoped CDP host used
for thread previews; CSS and `text=` selectors are supported there, and no console logs are
captured.

The address bar searches Google for words, uses HTTPS for bare public domains and HTTP for local
addresses such as `localhost:3000`. Explicit HTTP addresses stay HTTP. Local tabs reach services on
the desktop computer; paired-runtime tabs resolve localhost against that runtime's host. HTTP over
LAN and VPN remains supported. Pairing codes and device tokens remain required; no account or
external login is required.

Use the star or Ctrl/Cmd+D to bookmark a page. **Bookmarks and history** searches bookmarks, recent
visits and recently closed tabs by page, computer or profile. Opening a saved page retains its
source computer and profile. The library also removes bookmarks, clears history and reopens the last
closed tab.

**History → Clear history** clears visits saved on this device. On desktop it also clears the visit
records that extensions can read in every local Browser profile, including inactive profiles.
Bookmarks, recently closed tabs and browser data on paired computers stay available.

In the Browser workspace, Ctrl/Cmd+L focuses the address bar, Ctrl/Cmd+T opens a tab with the
current tab's computer and profile, Ctrl/Cmd+W closes it, Ctrl/Cmd+Shift+T reopens the last closed
tab and Ctrl/Cmd+R reloads. **Open link in new tab**, **Open image in new tab** and **Search
selection in new tab** open regular tabs even when other links open as previews. Ctrl/Cmd-click
opens a regular tab in the background. Links use their configured profile or the source profile.

Desktop pages become visible when their DOM is ready, while images and other resources can continue
loading. Tooltips appear above the page and return keyboard focus after dismissal, unless you click
or type in Studio in the meantime. Menus and dialogs take focus normally.

Desktop Browser formats JSON responses after they load. You can close the tab while formatting is in
progress.

Select page text and open **Browser options → Copy selection** to copy the literal selection, or
**Add selection to thread…** to append a quotation, page title and URL to an existing thread draft.
**Add page to thread…** appends the title and URL without requiring a selection. The destination can
be on another connected computer. Existing draft text is retained, conflicts are reported, and the
thread opens for you to review and send the draft. Empty selections produce feedback.

On desktop, use the tab-list **+** menu → **New browser window** for another window with its own
tabs, or **Detach browser** to move the current workspace, including pinned and sleeping tabs, to a
separate window. Native pages keep their document, navigation history, sign-in and live media.
Closing an extra Browser workspace window returns its remaining tabs to the main window, preserving
pinning, profiles, order and selection. If the main window has reached its 100-tab limit, the extra
window stays open and reports the problem. These actions require the desktop window bridge. Browser
opened from a pop-out thread uses a separate session identity and does not overwrite the main
window's tabs.

Detach a pinned tab with **Detach to new window** in its context menu. Its icon stays in the
original slot. Click the icon to focus the detached window. You can still reorder the pinned icons.
Closing the detached window returns the live page to that slot. Reloading a window keeps the link to
the detached page. Moving a tab to an existing window still removes it from the source list. The
Browser section icon shows a dot for unread page badges or pending sharing requests. This includes
badges from detached pinned pages. The dot clears when the website clears its badge or the sharing
request is resolved.

Tabs, active tab, recent order, computer, profile and recently closed tabs are isolated per window.
Main-window tabs persist in localStorage. Extra windows use sessionStorage for reloads. On window
close, app quit or update installation, their remaining tabs return to the main window and wait for
its save acknowledgment before shutdown. They reopen in the main window on the next launch, rather
than recreating detached windows. Private tabs remain session-only. Bookmarks and visit history use
a shared localStorage library across windows. Inactive restored remote tabs are not launched until
selected. Remote sessions depend on the owning computer being available and paired. Each remote
runtime currently allows eight concurrent browser sessions; saved inactive tabs do not reserve those
sessions.

Failed remote navigation retains the session and attempted address so **Reload page** can retry it.
When the connection drops, the viewer retries on its own and shows **Reconnect** if it needs help.
While Studio runs, it remembers the last host session for each open Browser tab, including when the
viewer closes during a tab switch or network outage. It shows a notice if reconnecting opens a fresh
session. Unsaved changes inside the previous page may be missing. Mobile previews wait for the
paired computer to reconnect before requesting a new ticket. A stalled frame stream can reconnect
automatically. After a policy close, switching back to the preview keeps it disconnected until you
select **Reconnect**. When the host confirms the session ended, choose **Open URL in a new session**
to open the saved address, or **Open a new session** for a blank tab. These notices leave the
streamed page at the same size. Reconnecting viewers receive any outstanding JavaScript dialog;
disconnecting clears the viewer's old dialog. Agent inspection does not expire a session while a
human viewer is attached. Private desktop preview profiles use memory-only storage, and self-closing
pages release their native tab entries.

## Picture-in-Picture and background pages

Websites can use Chromium's native video Picture-in-Picture controls, including videos in embedded
frames. Studio does not add its own PiP toolbar, whole-page floating window or persistent Teams
banner. Focusing the original tab leaves native video PiP under the website's control. The native
video context menu also offers Picture-in-Picture for main-page videos when Chromium reports
support. That action invokes the video PiP API: Chromium owns the floating window and its playback
controls. On YouTube, right-click the video twice to reach this menu, then select
Picture-in-Picture. Electron's
[video PiP implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/api/electron_api_web_contents.cc#L5385)
delegates to Chrome's `PictureInPictureWindowManager`.

Native video PiP does not normally request a site permission prompt. Chromium requires a user
activation and enforces the page/iframe Permissions Policy; Studio does not bypass either. A missing
prompt is not evidence that PiP permission was denied. Website fullscreen requests are allowed for
owned browser tabs, expand the page to the native window bounds, and restore Studio's browser layout
when fullscreen ends or the tab is hidden.

Electron's native Document Picture-in-Picture window immediately closes
([electron#39633](https://github.com/electron/electron/issues/39633)), so Studio keeps that native
feature disabled and supplies a compatibility API in shared-browser website tabs. Websites can move
their live call interface into a real same-origin, always-on-top window. Automatic entry requires
the site's **Automatic call PiP** permission and a Media Session handler. See
[Shared-browser APIs](browser-apis.md) for behavior, permissions and compatibility limits.

Call pages and PiP windows keep background rendering enabled. Opening another page preserves active
call previews as regular tabs. Mobile also keeps a link preview as a regular tab when it detects
active media and you switch to its opener. A paired computer keeps its Browser page while it detects
active media, even if the viewer is detached. Moving a call to another Studio window reparents its
existing native view, preserving media tracks and sharing controls. On Linux, document PiP requests
a floating window on every workspace and reasserts its floating state after show/restore. X11
window-manager flags are checked by the native fixture. On Wayland desktops with an available X
display, Studio uses XWayland by default so the window manager can apply always-on-top controls.
Restart Studio after updating. Explicit `--ozone-platform`, `--ozone-platform-hint` and
`ELECTRON_OZONE_PLATFORM_HINT` settings take precedence. Pure Wayland systems without XWayland keep
their native backend; their compositor controls stacking. The backend selection has unit coverage.
The current local verification host uses X11; a real Wayland desktop still needs a check.

Live pages can send desktop notifications after the website's per-profile permission approval.
Studio suppresses new alerts while the source page is selected in the visible, focused window. The
address bar can hold keyboard focus without enabling alerts. Background tabs and unfocused, hidden
or minimized windows can notify. Suppression does not change website permission. Notification clicks
select the original tab in its owning Studio window and profile. This supports page-created
notifications while Studio runs; it does not add service-worker Web Push or notifications after
Studio exits. See [Shared-browser APIs](browser-apis.md#website-notifications) for verification.

Right-click a local HTTP/HTTPS tab and enable **Keep awake** to keep its page running in the
background and exclude it from inactive-page eviction and automatic settle/close rules. The setting
persists with the tab. Studio loads these pages in the background at app startup, even when it opens
in Threads. Opening Browser reuses those pages and their saved profiles. Private, remote, snoozed
and settled tabs do not load through this startup path. Closing the tab still closes the page. PiP
and active call media are protected independently of this setting. Keep awake does not keep the
computer powered on after Studio exits or the operating system sleeps.

Teams, Outlook (Microsoft 365 and personal), Gmail, Slack, Discord, WhatsApp Web and Google Chat
stay awake by default in the desktop browser. This includes Teams and Outlook's `cloud.microsoft`
hosts, Slack's `app.slack.com` and workspace subdomains, and Discord's stable, PTB and Canary web
clients. External sign-in pages and other sites keep normal background throttling. Turning **Keep
awake** off is a persisted per-tab override. Other ordinary inactive pages retain the existing cache
limit of four pages per window and expire after five minutes. Settling or snoozing a local tab
releases its page promptly, while active media and PiP defer release until activity ends. Private
tabs are throttled but retain their in-memory page and sign-in data until explicitly closed.

When you edit a standard form field or editable text in a desktop workspace tab, Studio keeps that
page alive during automatic tab cleanup. This includes edits inside frames. Studio records only that
an edit occurred. A new top-level document clears this protection. You can still close, snooze or
settle the tab yourself. Closing Studio also ends the live page.

If a desktop page stops unexpectedly, its tab keeps its address and profile. Use **Reload** to open
the page again. If a paired computer loses or expires a Browser session, use **Open URL in a new
session** to reopen that same address on the tab's computer and profile. Websites can still close
their own sign-in popups.

Links opened as temporary previews retain the original opener beneath them. **Expand preview** and
**Contract preview** change the same live preview's size. Clicking the visible opener dismisses the
preview chain and returns to that retained page; **Close preview** returns to the immediate opener.
If your first click after switching back to the window lands on the opener, the preview stays open.
Click the opener again to return. Clicks inside the preview and its **Close preview** control work
on the first press. **Keep as tab** retains the preview as a normal tab without creating another
session. On desktop and web, the normal address bar keeps the opener's address while a preview is
open. The floating preview has its own address bar. Select the normal toolbar to return to the
opener before using its controls. Each toolbar controls its own page. Closing a preview also
restores the opener's address draft.

On desktop, the opener stays in its original native browser view beneath the link preview. Opening
the preview does not capture a screenshot or start a frame-image stream. The opener keeps its
animation and draft. Clicking its background returns to the opener after the click finishes. The
preview keeps normal browser input. In a link preview dialog, the page starts directly below the
navigation controls. Remote sessions retain their image fallback.

## Link routing

In **Settings → Browser → Local browser profiles**, set **Open links in this profile** to a
comma-separated list such as `teams.microsoft.com, example.com/work, *.work.example.com`. Exact
domains match that host; `*.example.com` matches its subdomains. An optional case-sensitive path
matches that page and its subpaths: `/work` matches `/work/call`, but not `/workshop`. Queries and
fragments do not affect matching. The longest matching path takes priority, followed by an exact
host and then the most specific wildcard. Each rule can belong to only one profile. Rules select a
profile on this desktop, never a different computer. Private tabs ignore routing rules.

Matching Studio links open directly in the configured profile. Ordinary page links that need a
different profile open a new preview in that session, retaining the source page. Routing only
intercepts page-initiated main-frame GET requests; form POSTs preserve their body and credentials.
Existing tabs, redirects, form POSTs and feature-bearing sign-in popups keep their own session.
Bookmarks and history retain their saved profile when opened explicitly.

Installed desktop builds advertise web-link support to macOS, Windows and Linux. Choose Dovo Studio
through **Settings → Browser → Set as default browser**, or send an explicit
`dovo-studio://open?url=<percent-encoded HTTP or HTTPS URL>` link from another app. Dovo does not
change your default browser automatically. Cold-start and second-instance links wait for the main
Studio window to become ready. Matching routing rules open automatically in the configured profile.
Unmatched links ask for a local profile or a profile on a connected remote computer. Each link gets
its own tab, and incoming links queue while the chooser is open. A failed open retains the link for
retry; Cancel skips that link. Choosing a destination enables Browser and opens its workspace.
Remote destinations retain their selected computer and profile.

## Website certificates

On a local desktop tab, select the site icon beside the address and choose **View certificate**. The
panel shows the TLS version, cipher and certificate chain reported by Chromium for the loaded page.
Expand a certificate to see its subject, issuer, validity dates, serial number and SHA-256
fingerprint. The panel also lists alternative names when available. If Electron supplies only the
main page's TLS details, the panel shows those details and tells you the chain is unavailable. HTTP
pages show that they have no TLS certificate.

In a narrow desktop window, the site icon is in **Browser options**. You can also run **View website
information** from the command palette while Browser is open.

On a paired tab, select the site icon beside the address to inspect the page on its host computer.
If the host needs an update, the viewer tells you when you open site information. On an iPhone with
the updated native browser, choose **Browser options → Site information**. WebKit supplies the chain
and the fields available on that OS version. The Android and older mobile browser bridges show when
certificate details are unavailable. In the web app's device-local embedded preview, open the
website in its own tab to inspect it with the web browser.

Agents with Browser access can run `studio_browsers` with `action: "certificate"` and the tab ID or
reference returned by `list`. Supported tabs report `certificateSupported: true`. If the field is
missing, update the desktop app or runtime that owns the tab. Private tabs are excluded. A read-only
agent can inspect the certificate.

The viewer reads the loaded connection. Opening it sends no new request to the website and makes no
change to certificate trust. Run `pnpm test:browser-certificates:native` with Electron and OpenSSL
installed. On headless Linux, use `xvfb-run -a pnpm test:browser-certificates:native`. Run
`pnpm test:paired-certificate:browser` to check the paired host and viewer.

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
Turning Browser off or unloading the extension closes its toolbar popup and helper connections.
Store packages are downloaded over official Google HTTPS endpoints; the CRX3 developer signature and
requested extension ID are verified before bounded ZIP extraction and permission review.

Studio checks enabled Store extensions for updates about every six hours in local profiles opened
during the current desktop session. Checks run while Browser workspace or Unified workspace is on.
Each request sends the extension ID, installed or pending version, and Chromium version to Google.
When an update changes the requested access, the installed version stays active. Open **Extensions →
Manage extensions → Review update** to see the change and decide whether to install it. Studio also
asks for review if reloading would change permissions granted or revoked during the current session.

An automatic check waits while the extension has an open popup, extension page, native helper
connection or sign-in flow. Studio checks again on a later 15-minute sweep. **Check for update**
also works while the extension is in use. Applying an update then can close its popup or connection.

In **Manage extensions**, clear **Automatic updates** to pause checks for one extension in this
profile. Select it again to resume, or choose **Check for update** to check now. The manager shows
the last check and any error. A failed check keeps the installed copy. Folder installs and older
installs with no saved source use manual updates. Install a verified Store link once to enable
automatic checks for that copy. Reinstalling the link preserves the pin and enabled setting.

Reinstall older copies that had `nativeMessaging` removed to review and grant that permission. On
macOS, 1Password also requires the signed Dovo Studio app in **1Password Settings → Browser → Add
Browser** ([1Password instructions](https://support.1password.com/additional-browsers/)). Dovo never
impersonates Chrome or bypasses that approval. Native transport is tested, but a real 1Password
desktop pairing has not been verified; general Chrome extension parity is not claimed. Unsupported
APIs/permissions and load errors are reported by the extension manager. Extension-created tabs
retain their native identity and profile. The browser selects a new tab unless the extension
requests a background tab. The extension can also select an existing tab in the same profile. Native
close events remove tabs from the list. If the browser releases an inactive extension page to save
memory, select its tab to reload the page in the same profile while the extension is loaded.
Extension URL pages are available only in the current app session.

Run `pnpm exec playwright install chromium` and `node scripts/check-browser-extensions-browser.mjs`
after building the desktop app to check the extension manager. Run
`node apps/desktop/scripts/check-browser-extensions-native.mjs --store` to install signed Dark
Reader in a temporary Electron profile, check for an update, and verify its settings after restart.
The Store check requires network access.

Host permission checks recognize narrower origins covered by existing wildcard web grants, including
Proton Pass sign-in hosts under `https://*/*`. Optional narrower web grants still require review;
file access and undeclared scopes remain denied.
`node apps/desktop/scripts/check-browser-extensions-native.mjs --proton` optionally downloads the
signed Proton Pass store package into an isolated profile and checks its signed-out screen and
same-profile sign-in tab before/after restart. It requires network access and does not verify an
authenticated vault, autofill, passkeys or desktop-app pairing.

When signed out of 1Password, click its toolbar button to open the setup tab. A click immediately
after installation can show the extension's **Loading…** popup while its background worker starts.
Close that popup and click the toolbar button again to open setup.

`node apps/desktop/scripts/check-browser-extensions-native.mjs --1password` checks the signed
1Password package in a clean profile with the Chromium sandbox enabled. It opens the signed-out
setup tab from the toolbar once the extension initializes. It checks foreground selection and
reopening the same tab after switching away. It also checks that selecting the setup tab reloads it
after the browser releases its inactive page. The test runs after installation and after a restart.
It does not cover a signed-in vault or desktop-app pairing.

## Website and call tab capture

Website screen sharing (for example, a call's `getDisplayMedia` request) is separate from audio in
Dovo's remote browser stream. On desktop, the consent picker offers local HTTP/HTTPS tabs, available
remote tabs and threads, desktop windows, and screens. Linux X11 supports both screen and window
sharing; Wayland uses the desktop's PipeWire/portal chooser and requires working desktop portal
services. Optional local-tab audio starts unchecked; camera and microphone access require separate
approval. A visible global indicator shows active sharing, and Stop waits for native confirmation
before reporting that capture has ended.

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
and tab. It also covers communication-app defaults, a persisted opt-out, explicit sleep and complete
workspace detach/return adoption. `node apps/desktop/scripts/check-browser-page-tools-native.mjs`
verifies that real Electron window close returns the same live page, including an unsent draft,
alongside pinned, sleeping and remote tab metadata; explicit sleep destroys the idle page. Direct
BrowserPane checks bypass the experimental gate. A separate case in this same script renders the
real BrowserView: default-off mounts no pane or host calls, enabling mounts the pane, and disabling
unmounts it and hides its native session. Native window creation has separate tests. Additional
cases flood background opened links to the 100-tab cap and verify pop-out thread
native/session-storage isolation from main-window tabs. Native `createdTabs`/`closedTabs` cases
verify adoption without opening a duplicate view, retained profiles and session-only extension URLs.
Thread cases cover stale cross-computer links, owner activation, profile retention and real composer
draft persistence through panel close/reopen. `node scripts/check-remote-browser-sessions.mjs` uses
real managed Chromium for unavailable-server recovery, crash cleanup and dialog reattachment. If
every renderer exits before the test can signal it, the check reports that no crash was injected.
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

Desktop and web keep Back, Reload, the address and Browser options in one row at narrow widths.
Press Enter to submit the address. Browser options holds Forward, bookmarks, downloads, site
permissions, extensions and the tab profile when they are available. The recent-tab list still shows
tabs and their owner.

When a desktop Browser tab or thread preview cannot load a page, select **Retry** to try the same
address. Open **Technical details** to see the browser error. You can dismiss the notice and use
**Reload** later. Redirects and superseded loads do not show an error.

Selecting a tab preserves its position; navigating moves it to the top of the recent list. Desktop
tabs, bookmarks and history show favicons when available, with a globe fallback. Remote localhost
icons are never fetched from the local computer.

Desktop and paired-runtime pages use declared regular icons, Apple touch icons and precomposed Apple
touch icons. Larger declared sizes take priority; SVG and `sizes="any"` icons take first priority.
Apple touch icons without a declared size take priority over ordinary icons with no size. The loader
checks actual decoded sizes and upgrades a small icon when another candidate has more detail. It
keeps a usable icon if later candidates fail. The owner decodes the image to PNG at up to 128 × 128
pixels. Smaller raster images keep their size. ICO files use their largest image. Icon requests use
the page's browser profile. The 1 MiB download limit and the 100,000-character viewer limit still
apply.

To check icon loading and the desktop preview layout, run:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/runtime... -r build
pnpm test:browser-favicons:browser
pnpm test:browser-tabs:browser
node scripts/check-unified-workspace-browser.mjs
node scripts/check-mobile-shared-browser-browser.mjs
```

The native icon check runs with `node apps/desktop/scripts/check-browser-extensions-native.mjs`. It
needs Electron's Chromium sandbox and a display or Xvfb. The managed Chromium check verifies remote
icon discovery. It does not verify Electron's preload or physical mobile devices. Mobile browser
checks use adapters for the native date and time controls. Type checks validate the Expo UI
contracts. Test the SwiftUI picker on iOS and the calendar and clock on Android before claiming
physical-device verification.

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

### Pinned windows without sidebars

Right-click a pinned tab and choose **Detach without sidebars**. The window shows the address bar,
page controls and page. It hides the new-tab button and dropdown. The existing **Detach to new
window** option keeps the tab sidebar. Both options keep the same page and browser profile. Closing
a detached pinned window returns its page to the source window.

In a window without sidebars, new-page links (`target="_blank"` and `window.open`) open a floating
link preview. This also applies when the normal browser link preference is **Open in new tab**.
Choose **Open in another window** in the preview to select **Main window**, **New window**, or
another open browser window. A new window has no sidebars. Cancel returns to the preview and keeps
its page state. A failed move keeps the picker open for retry. A successful move returns to the page
that opened the preview and shows a notice. Local pages retain their native page and opener session;
paired-runtime pages retain their runtime and profile.

Verify with:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/desktop build
node scripts/check-shared-browser-browser.mjs
node scripts/check-browser-link-preview-native.mjs
pnpm exec vp test apps/desktop/electron/browser-window.test.ts apps/desktop/electron/browser.test.ts
```

The shared browser renderer check covers local and remote preview adoption, nested links, window
choices, cancellation, retries and remounts. Its native and remote boundaries use fixtures; it does
not verify physical macOS or Windows windows.

The native link-preview check uses real Electron views. It checks `_blank` opener identity,
animation, drafts, menus, resize, hide, close and promotion. On Linux with X11, it also checks mouse
presses, typing and background return with `xdotool`. Install `xdotool` before running this check
locally; CI installs it with the window manager. It does not verify physical iPhone navigation or
native macOS and Windows input.

Browser sharing requests and source results send native change events to the requesting Studio
window. The picker refreshes at once, while the one-second status poll remains as a recovery path.
Tabs can appear before desktop source discovery completes. Source selection and approval remain
manual. Verify with `node scripts/check-browser-media-browser.mjs` and
`pnpm exec vp test apps/desktop/electron/browser-media.test.ts --maxWorkers=4`. The browser fixture
measures event-to-dialog time; it does not measure OS source discovery.

Browser tooltip detection includes text-only tooltips that ignore pointer events. On Linux Wayland
desktops, tooltips render in the Studio document. If a tooltip overlaps a native page, Studio raises
its UI above the live page and keeps page focus. Verify overlap detection with
`node scripts/check-shared-browser-browser.mjs`.

## Copy a browser snapshot

In the desktop or web Browser, open **Browser options** and choose **Copy snapshot**. Paste in a
thread composer to attach the PNG and its source text file. The source file contains the page title
and URL. The receiving draft owns the two files. On an HTTP LAN connection, Studio copies the
snapshot as text and restores both files when you paste in a composer.

## Open a localhost preview on a phone

On iOS or Android, open an HTTP localhost page in a remote browser tab. Open **Browser options** and
choose **Open preview on this phone**. The phone renders the page in Dovo and forwards traffic to
the browser tab's current localhost port through the paired computer connection. Close the preview
to stop forwarding. Dovo also stops forwarding when the app goes to the background.

Relative page resources and connections to the preview origin share the same port. Apps that use
absolute localhost URLs for other ports still require the remote browser. The option appears when
the computer supports it and the remote tab is connected.
