# Link routing

`resolveLinkTargets` owns URL recognition and source selection for desktop and mobile. Capture
`LinkOrigin` where the link is rendered. Resolution prefers that runtime and source, including
cached offline sources, and uses the configured forge identity. HTTP links remain HTTP.

Each desktop window and the mobile root own one `LinkController`. Markdown, embedded apps and
Electron navigation requests hand URLs to that owner. Renderers disable their own link confirmation
and native preview. `linkActions` supplies the same destinations to choosers and context menus;
explicit menu actions execute directly.

A request freezes its destinations. Repeated opens/selections are ignored until dismissal and action
completion. Destination actions execute after the presenter acknowledges dismissal. Native sheets
must stay mounted during cancellation until `onDismiss`; an aborted owner cannot navigate from a
stale callback. Mutations stay in the chooser while running and show errors there for retry.

Electron forwards requests only to a registered, trusted owning renderer. An isolated browser
forwards popups to its parent. The native fallback is used only when the app renderer is
unavailable; explicit browser/external commands never prompt again.
