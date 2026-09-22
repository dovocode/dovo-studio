# Navigation and interaction follow-through

This pass continues the [redesign implementation](redesign-implementation.md) with native Tasks
navigation, reliable composer state across navigation, and clearer action placement.

## Native Tasks navigation

Tasks now uses an Expo Router native Stack inside the existing native Tasks tab. The task list,
Projects and new-task creation have routes; threads use `/thread/[runtimeId]/[taskId]` so identical
task IDs on different computers cannot resolve against the wrong workspace. The aggregate task list
remains mounted, retaining filters and reading position when a thread opens.

Back buttons and iOS back gestures use the same stack. Native route focus controls conversation
polling and dictation. The task workspace keeps Chat, Changes and Terminal in its existing header,
with the composer retained when switching those surfaces. The tab bar hides for task detail routes.
Incoming task links have the Tasks list beneath them; shortcut-created drafts and cold `/new` links
wait for saved computer state before opening a thread.

The iOS scene bridge delivers launch URLs and user activities to Expo's lifecycle subscribers before
starting React Native. Router can then resolve a cold-launch link on its first render. The scene
config plugin updates its own generated delegate on repeated prebuilds and preserves other native
code. This follows Expo's
[scene lifecycle guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md) for the
installed SDK 57 integration.

The implementation follows the installed Expo Router API for
[stacks within native tabs](https://docs.expo.dev/router/advanced/native-tabs/) and
[route anchors](https://docs.expo.dev/router/advanced/router-settings/). The subsequent
[source navigation pass](source-navigation.md) extends native stacks to Issues, PRs/Pipelines and
Automations. The [native iOS navigation pass](native-mobile-navigation.md) adds system navigation
bars and routes for Settings sections.

## Composer delivery across navigation

Pending message identities and generated titles belong to a computer/thread pair, rather than one
mounted composer. A failed send can be retried after Back and reopening without sending a second
message. Changing the submitted text, attachments or delivery mode starts a new attempt.

Server-confirmed delivery is reconciled before consumed attachments are treated as edits. A lost
HTTP reply does not show a retry error after the event stream confirms delivery. A delayed response
cannot clear a newer draft, and a reopened composer receives draft changes from an earlier send.

Retry identity is retained for the running app session. Draft text remains persisted on disk; a
durable delivery outbox across operating-system termination remains separate work.

## Actions and desktop keyboard behavior

PR detail has one actions menu in the top-right corner. Review remains the primary bottom action,
with Comment as the provider-supported fallback. Secondary mutations, task creation, the provider
link and refresh live together. Capability, state, offline and stale-data guards remain in place;
open confirmation sheets also reject newly stale submissions.

On desktop, Ctrl+` focuses Terminal and restores the composer’s focus and selection on return. Task
shortcuts respect dialogs, menus, IME composition and held keys. Closing command search restores
focus and clears its query; confirming IME text does not execute a command. The labeled navigation
scrolls in short windows so Settings and Walkthrough stay reachable.

## Verification

- 658 tests across 104 files; workspace typecheck and lint pass.
- Desktop and web production builds pass. Browser fixtures pass 14 keyboard/focus checks, 47 primary
  workflow checks and 6 question-workflow checks.
- The iOS Release simulator build passes. The scene plugin passes first application, repeated
  application, old-template replacement, preservation of subsequent custom code and rejection of an
  unmanaged delegate.
- Native navigation passes task lifecycle menus, retained sorting and draft text after swipe-back,
  Projects back navigation, shortcut creation, unknown-computer isolation and cold `/new` links.
- Native composer passes keyboard geometry, pane changes, confirmed delivery with a lost HTTP
  response, retry after native Back/reopen, attachment-picker cancellation, queue controls and Stop.
- Native PR fixtures pass one-menu placement, comment/review submission, linked-task handoff,
  retained review progress and offline mutation guards. Back and menu remain 44-point targets across
  three tested text sizes; Review grows with Dynamic Type without overlapping adjacent controls.
- The two-computer fixture passes host-scoped task routing, isolated drafts, exactly-once send,
  retained search/filter/sort/reading position and cached cold launch.

Artifacts are under `work/design/navigation-pass`, `work/verification/task-keyboard` and
`work/verification/pr-actions-continuation`, with computer-switching captures in
`work/verification/mobile-devices-continuation`. Original screenshots were inspected as well as
automation results. Fixtures use isolated simulators and local test runtimes; they do not exercise
real provider accounts. This pass does not install on a physical phone.
