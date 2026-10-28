# Shared-browser APIs

## Page visibility

Shared-browser tabs and thread previews report tab selection through `document.visibilityState`,
`document.hidden` and `visibilitychange`. Switching tabs or leaving Browser for another Studio
section marks the old page hidden. Window hiding/minimizing also marks its pages hidden; restoring
it makes only the selected page visible. Losing keyboard focus alone does not hide a visible tab.
Menus, tooltips and live preview underlays preserve the selected page's visibility. Media playback,
PiP and Keep awake can keep rendering/timers alive without falsely reporting a background tab as
visible.

A dedicated sandboxed preload supplies this behavior before website scripts in HTTP and HTTPS pages,
same-origin and cross-origin frames, including documents loaded while their tab is hidden. This is
independent of Document PiP support and permissions. Untracked native popups keep their native
lifecycle. Website scripts never receive Node.js or IPC access. Electron's native view visibility
does not reliably update the Page Visibility API, so Studio bridges the getters and emits synthetic,
deduplicated events. This does not change browser-internal lifecycle state or create trusted
Chromium events. Window events update immediately; a 250ms native-state check covers macOS
visibility/occlusion changes that emit no window event.

`pnpm test:browser-apis:native` checks visibility with real Electron, isolated temporary profiles,
plain HTTP, cross-origin frames, initial hidden loads, hidden reloads/frame creation, overlays and
window hiding/restoring while background throttling is disabled. It also runs the PiP checks below.

## Picture-in-picture

Studio supplies Document Picture-in-Picture in shared-browser website tabs. Electron's broken native
Document PiP feature remains disabled; a session preload supplies `requestWindow()`, `window`,
`enter`/`onenter`, and the Document PiP event and interface constructors. The returned object is a
real same-origin window, so websites can move their existing DOM, video elements and live streams
into it. The native window is resizable and always on top. Closing it delivers the website's normal
`pagehide` cleanup. Navigation, tab closure and browser shutdown close the window. An open PiP
protects its owning tab from suspension and background throttling.

The compact PiP header sits above website content in a separate native view and displays the source
hostname, including subdomains. Its Back to tab and Close buttons never cover the site's controls;
requested sizes describe the website viewport, with the header added above it. Back to tab (also
available in the context menu) focuses the owner and closes the popup. Websites can suppress this
item with `disallowReturnToOpener`. Window sizes are clamped to useful desktop bounds.
`preferInitialWindowPlacement` is accepted as an advisory option; Studio currently uses the initial
placement on every request. Secure contexts, main-frame ownership and user activation are required.
Short-lived, single-use native tickets prevent ordinary website popups from acquiring always-on-top
privileges. PiP windows cannot navigate or create nested PiP windows.

For automatic call PiP, open the tab's **Website permissions and site data** controls and set
**Automatic call PiP** to **Allow**. Studio invokes a website's registered Media Session
`enterpictureinpicture` action when switching browser tabs, leaving Browser for another Studio
section, or hiding/minimizing the Studio window. The website supplies the floating call interface;
async action handlers retain automatic-PiP eligibility while they prepare it. Tabs receive Studio's
visibility changes even while media throttling is disabled or another preview watches their frames.
Menus, tooltips and URL/viewport reconfiguration do not count as leaving a page. Repeated hidden
reports do not reopen a dismissed PiP until the page is visited and left again. Automatic entry is
blocked by default and does not capture or reconstruct a call interface for websites without this
action handler.

Clipboard read/write, speaker selection, screen wake locks and persistent storage use Chromium's
native APIs. Their permissions are configurable by website and browser profile. Clipboard writes and
screen wake locks default to Allow, while reads, speaker selection and persistent storage ask.
Prompts offer Allow once, Always allow and Block. Navigating away invalidates an unanswered prompt;
repeated requests share one prompt per tab. Private-profile settings remain in memory. Chromium
still enforces the API's own secure-context, activation, focus and device constraints. Thread-side
agent previews retain their separate denied-permission policy.

The compatibility layer cannot create trusted browser events or reproduce every browser-internal
guarantee. Its `enter` and Studio visibility events are synthetic. Authenticated Teams calls still
need a manual check against the released desktop build.

Verification: `pnpm test:browser-apis:native` runs real Electron with isolated temporary data and a
local media fixture. It checks actual DOM/stream transfer, activation, events, always-on-top,
close/restore, navigation, automatic-entry consent and native common API grants. It opens temporary
desktop windows and requires an installed Electron binary and a desktop session. Browser UI coverage
is in `scripts/check-shared-browser-browser.mjs`.

## Address-bar search

Each browser profile has a **Default search engine** in Settings → Browser. Choose Google (the
default), DuckDuckGo, Kagi, or a custom HTTP/HTTPS URL containing `%s`. Search terms are URL-encoded
before replacing each `%s`, including in path-based search URLs. Templates without a placeholder,
credential-bearing URLs and non-web schemes are rejected. Kagi uses the profile's existing website
login.

Desktop local/remote tabs and mobile local/remote tabs use the selected profile's engine. On mobile,
Browser options also lets you save the search engine for that tab's profile. Private tabs use the
default profile's engine. Explicit addresses keep their existing navigation behavior, including HTTP
LAN/VPN addresses; only search terms go to the search provider.

## Tab order

**Order tabs by activity** in Browser settings or Browser options is on by default. Navigating a
normal tab updates its activity; selecting it or changing its title keeps the current order. Turn it
off to keep a manual order and drag rows within their Active, Snoozed or Settled group. Pinned tabs
always keep manual order and can be dragged independently of this preference. Alt+arrow keys reorder
a focused draggable tab. Manual order is saved across restarts and retained while activity sorting
is enabled.

## Website permissions and devices

Shared-browser website tabs also support location (precise and approximate), File System Access,
local fonts, MIDI/SysEx, pointer lock, keyboard lock, display/window management and Idle Detection.
The website controls save Allow/Block by origin and profile. Allow once lasts for the current
document; navigation, tab closure, permission reset and browser shutdown revoke it. Native file
pickers still choose which files a site can access. File permission prompts include the path and
access mode when Electron supplies them. Local font enumeration has an explicit Studio prompt
because Electron otherwise checks synchronously and silently returns an empty list.

Idle Detection reports Ask as `prompt`, instead of Electron's boolean permission check incorrectly
reporting it as `denied`. This lets Teams offer its presence setting before requesting access.
PermissionStatus objects retain their native interface and receive change events when approval or
site controls change. Studio's bridged Idle Detection permission events are synthetic; native
IdleDetector still enforces permission and secure-context/Permissions Policy restrictions.

USB, HID, serial and Bluetooth use native chooser windows, with scan/hotplug updates and explicit
cancellation. Allow permits opening the chooser; it never grants every device. Only the selected
device is authorized. USB/HID/serial devices with stable serial numbers may be remembered for the
origin in that profile. Revocation/forget and website permission changes clear those approvals.
Bluetooth pairing supports confirmation, displayed PIN confirmation and PIN entry. macOS also
requires its own Location/Bluetooth consent; Studio packaging declares the usage descriptions.

Background Sync, Periodic Background Sync and Background Fetch are unavailable: Electron has no
BackgroundSyncController or BackgroundFetchDelegate. Its exposed Background Fetch object can accept
a registration without starting any network request. Studio removes these nonfunctional registration
properties in page and service-worker contexts so feature detection is accurate. There is no
JavaScript replacement for service-worker scheduling or a custom Electron fork.

`pnpm test:browser-permissions:native` checks real Electron font enumeration, MIDI access, display
access, pointer/keyboard locks, location permission with DevTools-supplied coordinates, profile
isolation, and device-chooser rendering/selection. `pnpm test:browser-idle:native` checks
IdleDetector startup and document grants. Hardware communication, real location acquisition, OS
consent prompts, and physical Bluetooth pairing require device checks; automated permission tests do
not prove them.

## Extension browser APIs

Desktop extensions can request `history`, `downloads`, `downloads.open` and `identity`. Calls and
events use the current permission grants and the extension's browser profile. Removing a permission
revokes subsequent calls and event delivery. Private profiles do not run extensions.

History records HTTP/HTTPS visits and titles from native shared-browser tabs, with per-profile
persistent storage. It supports search, visits, adding/removing URLs, time-range/all deletion and
visit events. Extension/OAuth pages and thread previews are excluded. This store is separate from
the renderer's existing recent-page library.

Downloads use Electron's real DownloadItems and per-profile persistent records. Supported methods:
`download`, `search`, `pause`, `resume`, `cancel`, `erase`, `removeFile`, `show`, `open`,
`getFileIcon`, and `showDefaultFolder`, plus created/changed/erased events. Downloads support
headers, relative filenames, conflict handling and native Save As. Filenames cannot escape
Downloads, including via existing symlinks. Opening a file requires `downloads.open` and a native
confirmation. IDs are not reused after erasing records. Interrupted downloads from an earlier app
process cannot resume. POST/body requests, filename-determination callbacks, danger-review APIs and
Chrome shelf UI controls are not implemented or advertised as methods. Unsupported download options
reject rather than silently changing the request. Electron does not provide Chrome's Safe Browsing
download scanner.

Identity supports generic redirect OAuth through `launchWebAuthFlow` and synchronous
`getRedirectURL`. Auth windows use the requesting profile's session, with isolated sandboxed
content; only that extension's HTTPS `chromiumapp.org` redirect completes its flow. Interactive and
hidden flows support cancellation, timeout and extension unload. HTTPS and loopback HTTP
authorization endpoints are accepted. Google account integration, `getAuthToken` and browser
account/profile identity are excluded. This OAuth endpoint policy does not change LAN/VPN runtime
HTTP support.

`pnpm test:browser-extensions:native` verifies the production extension adapter in real MV3 page and
service-worker contexts, including a local OAuth redirect, history, a real file download, events,
permission removal, callback `runtime.lastError` and Promise rejection. It does not prove live
third-party OAuth providers or every Chrome API.
