# Shared-browser APIs

Studio supplies Document Picture-in-Picture in shared-browser website tabs. Electron's broken native
Document PiP feature remains disabled; a session preload supplies `requestWindow()`, `window`,
`enter`/`onenter`, and the Document PiP event and interface constructors. The returned object is a
real same-origin window, so websites can move their existing DOM, video elements and live streams
into it. The native window is resizable and always on top. Closing it delivers the website's normal
`pagehide` cleanup. Navigation, tab closure and browser shutdown close the window. An open PiP
protects its owning tab from suspension and background throttling.

Use the PiP window's context menu → **Return to tab** to focus its owner and close the popup.
Websites can suppress this item with `disallowReturnToOpener`. Window sizes are clamped to useful
desktop bounds. `preferInitialWindowPlacement` is accepted as an advisory option; Studio currently
uses the initial placement on every request. Secure contexts, main-frame ownership and user
activation are required. Short-lived, single-use native tickets prevent ordinary website popups from
acquiring always-on-top privileges. PiP windows cannot navigate or create nested PiP windows.

For automatic call PiP, open the tab's **Website permissions and site data** controls and set
**Automatic call PiP** to **Allow**. Studio invokes a website's registered Media Session
`enterpictureinpicture` action when its tab becomes hidden. The website supplies the floating call
interface. Tabs receive Studio's visibility changes even while media throttling is disabled.
Automatic entry is blocked by default and does not capture or reconstruct a call interface for
websites without this action handler.

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
