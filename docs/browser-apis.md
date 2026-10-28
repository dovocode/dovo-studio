# Shared-browser APIs

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

## Tab order

**Order tabs by activity** in Browser settings or Browser options is on by default. Selecting or
navigating a normal tab updates its activity. Turn it off to keep a manual order and drag rows
within their Active, Snoozed or Settled group. Pinned tabs always keep manual order and can be
dragged independently of this preference. Alt+arrow keys reorder a focused draggable tab. Manual
order is saved across restarts and retained while activity sorting is enabled.

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
