# Native iOS navigation

The mobile tabs now share an Expo Router native navigation bar. UIKit lays out the title, back
button and toolbar items, including grouping and overflow on narrow screens. App content begins
below that bar; connection notices no longer resize the navigation controller.

`ScreenHeader` describes a title and actions. Use its `buttons` array for ordinary navigation
commands so they become native `Stack.Toolbar.Button` items on iOS. Existing provider-specific menus
can use `actions`. Android and sheet content retain the existing accessible controls. Only the
focused PR or pipeline collection configures its shared navigation bar.

Threads keep Chat, Changes, Terminal and Browser in the top-right toolbar. Their project, execution
device and status share a compact row that opens task settings. The composer and conversation stay
mounted during pane changes. UIKit handles the back gesture and the return to the retained list.

Settings uses `/settings` and `/settings/[section]` routes for Computers, Agents, MCP & skills and
Source control. Back and edge-swipe return to the settings list; selecting Settings again returns to
its root. Computer-specific edits still use the owning runtime scope. Tabs remain available while
navigating Settings.

The implementation uses the installed Expo SDK's
[stack toolbar API](https://docs.expo.dev/router/advanced/stack-toolbar/) and follows Apple's
[toolbar guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars).

## Verification

The iOS Release build, mobile typecheck, workspace formatting/lint/types and 721 tests pass. Native
simulator flows cover task and Settings swipe-back, retained drafts/sorting, shortcut and cold-link
routing, PR list position and filters, invalid/unknown-host links, keyboard geometry, pane changes,
lost-response retry, attachments, queueing and Stop. The checks use isolated fixture runtimes and
simulators; no phone installation was performed.

UIKit owns navigation-item sizing and hit testing. Geometry checks enforce separation from other
controls, while app-owned composer controls keep explicit 44-point touch targets.
