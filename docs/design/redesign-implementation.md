# Dovo Studio redesign implementation

Implemented on 20 September 2026 from the [redesign proposal](redesign-proposal.md).

The subsequent [navigation and interaction pass](navigation-follow-through.md) adds native Tasks
navigation, delivery-safe reopening and consolidated PR actions. The
[source navigation pass](source-navigation.md) extends native stacks and retained lists to Issues,
PRs/Pipelines and Automations, with offline source details and safe run retries.

## Delivered

| Area                  | Behavior                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop and web shell | Collapsible labeled navigation with distinct icons; Overview leads with actionable tasks; one computer scope per context; Settings and Walkthrough remain separate from daily work.                                          |
| Tasks                 | Compact project/title/branch-device-agent rows, explicit state and age, priority and alternate sorting, grouped Chat/Changes/Terminal, optional desktop split. Chat and its composer remain mounted when switching surfaces. |
| Conversation          | Quieter activity summaries and access controls; retained drafts, attachment and retry state; Queue/Steer/Stop and agent question forms preserve their existing contracts. Hidden mobile conversations stop active dictation. |
| PRs                   | Collection filters stay with the list. Detail tabs are Overview, Files, Activity and Checks. Review is prominent, secondary mutations live in a menu, and review decisions are distinct from discussion comments.            |
| Issues                | Description precedes secondary metadata. Linked tasks and Start task are compact; source context and draft-before-execution handoffs remain intact.                                                                          |
| Pipelines             | Failed jobs and steps come before secondary run metadata. Investigation, cancellation and rerun actions retain provider capability and offline guards.                                                                       |
| Automations           | The former Jobs destination is named Automations. Runs, Canvas and Triggers separate progress from configuration. Credentials appear only under Triggers; retries, review gates and completed-step history are retained.     |
| Folders               | More list space, live editable paths, hidden-folder options, clear host context and fixed confirmation. Add and Clone reuse the picker; errors/loading/disconnects prevent selection.                                        |
| Settings              | Saved computers are distinguished from clients trusted by the current host. Host commands and activity are disclosures. Reusable agents use a compact list with separate diagnostics.                                        |
| Native mobile         | Five native tabs, consistent separators and spacing, explicit thread device/state, list-only source filters, simpler detail actions and a fixed folder-sheet footer.                                                         |

Offline recovery also distinguishes changes awaiting explicit retry from changes actively saving.

Runtime, provider, permission and persistence contracts are unchanged. This pass did not add a new
navigation or state framework.

## Verification

- Full workspace suite: **640 tests across 102 files passed**.
- Workspace typechecks and lint passed. Desktop and web production builds passed.
- iOS Release simulator build and final bundled launch passed; the mobile-focused suite passed **58
  tests**. The isolated simulator was removed after verification.
- A native iOS simulator walkthrough passed folder paging/search/hidden-folder/error recovery,
  Chat/Changes/Terminal, task settings, issue and PR details, pipelines, automation editing,
  agent/MCP/skill editors, clone folder selection and computer settings.
- Native composer regression passed keyboard geometry and 44-point controls, draft retention across
  Chat/Changes/Terminal, stable retry identity without duplicate messages, attachment cancellation,
  Queue/Steer layout, queued follow-ups, Stop pausing the queue and removal of empty drafts.
- Desktop interaction fixtures exercised narrow/wide layouts, navigation, settings, long names,
  modal bounds, all 14 walkthrough steps, and separation of feed scope from execution host.
- Task fixtures covered **29 daily-workflow checks**, pending questions, queue/steer/stop,
  checkpoint and draft behavior, stable retry IDs, actual terminal sessions in the task worktree,
  and inline diff feedback.
- Automation verification covered **9 contract checks**, including lost start responses,
  single-active-run protection, review/retry history and trigger-only credentials.
- Source fixtures exercised folder navigation and stale responses, PR review/comment/discussion
  resolution and mutations, issue/pipeline task handoffs, partial/offline caches and narrow layouts.
- Multi-device fixtures passed aggregation, host isolation, durable offline reload and explicit
  outbox retry; the footer correctly identifies changes awaiting that retry.
- Settings fixtures exercised signed-in CLI profiles, project-scoped credentials, cloning,
  MCP/skills, model/reasoning persistence and attachment/branch behavior.

The canonical verification scripts were updated alongside the UI. Fixtures used isolated temporary
workspaces and local test runtimes, not the user's project or provider data.

## Rendered examples

- [Desktop task workspace](../../work/verification/primary-tasks.png)
- [Desktop issue details](../../work/verification/work-desktop.png)
- [Desktop failed pipeline](../../work/verification/pipeline-desktop-failed.png)
- [Automation run progress](../../work/design/redesign-task-verification/automations-runs.png)
- [Native task list](../../work/verification/redesign-mobile-tasks.png)
- [Native folder picker](../../work/verification/redesign-mobile-folder.png)
- [Native conversation](../../work/verification/redesign-mobile-native-thread.png)
- [Native composer with keyboard](../../work/verification/redesign-mobile-followup-keyboard.png)
- [Native PR details](../../work/verification/redesign-mobile-pull.png)
- [Native settings](../../work/verification/redesign-mobile-settings.png)

These are captures of the implemented app using fixture content, not design mockups.

## Boundaries

Tasks, Issues, PRs/Pipelines and Automations now have native push navigation; Settings retains its
local pages. Desktop retains its existing dark appearance; the mockup's light variant is not a new
theme shipped by this pass. The complete Dynamic Type, VoiceOver and reduced-transparency matrix and
physical-phone behavior, including real dictation audio, have not been revalidated here. Provider
mutations were verified against fixtures, not live remote services. Packaging verification was
updated but a fresh distributable was not installed.
