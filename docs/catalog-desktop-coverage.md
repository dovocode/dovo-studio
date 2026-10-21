# Desktop screen coverage

The `Dovo/Screens/Desktop` catalog imports every desktop extension view from the same six manifests
as the desktop application. Each named story loads its actual production page module. Page-owned
sidebars, activity rail, settings search/navigation, title bar, and sidebar collapse use production
components. The catalog shell composes those components following Workbench layout; it does **not**
start Workbench's real networking, notification, or account providers.

## Route inventory

| Registered view                    | Story ID                                                 | Registration                                 |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `tasks`                            | `dovo-screens-desktop--tasks`                            | `packages/extension-tasks/src/index.ts`      |
| `artifacts`                        | `dovo-screens-desktop--artifacts`                        | `packages/extension-tasks/src/index.ts`      |
| `archived-tasks`                   | `dovo-screens-desktop--archived-tasks`                   | `packages/extension-tasks/src/index.ts`      |
| `issues`                           | `dovo-screens-desktop--issues`                           | `packages/extension-scm/src/index.ts`        |
| `jira`                             | `dovo-screens-desktop--jira`                             | `packages/extension-scm/src/index.ts`        |
| `pipelines`                        | `dovo-screens-desktop--pipelines`                        | `packages/extension-scm/src/index.ts`        |
| `source-control`                   | `dovo-screens-desktop--source-control`                   | `packages/extension-scm/src/index.ts`        |
| `pulls`                            | `dovo-screens-desktop--pulls`                            | `packages/extension-scm/src/index.ts`        |
| `resources`                        | `dovo-screens-desktop--resources`                        | `packages/extension-agents/src/index.ts`     |
| `text-generation`                  | `dovo-screens-desktop--text-generation`                  | `packages/extension-agents/src/index.ts`     |
| `agents`                           | `dovo-screens-desktop--agents`                           | `packages/extension-agents/src/index.ts`     |
| `jobs`                             | `dovo-screens-desktop--jobs`                             | `packages/extension-jobs/src/index.ts`       |
| `runtime`                          | `dovo-screens-desktop--runtime`                          | `packages/extension-runtime/src/index.ts`    |
| `task-defaults`                    | `dovo-screens-desktop--task-defaults`                    | `packages/extension-runtime/src/index.ts`    |
| `commands`                         | `dovo-screens-desktop--commands`                         | `packages/extension-runtime/src/index.ts`    |
| `computer-use`                     | `dovo-screens-desktop--computer-use`                     | `packages/extension-runtime/src/index.ts`    |
| `remote-desktop`                   | `dovo-screens-desktop--remote-desktop`                   | `packages/extension-runtime/src/index.ts`    |
| `device-previews`                  | `dovo-screens-desktop--device-previews`                  | `packages/extension-runtime/src/index.ts`    |
| `pull-request-monitoring-settings` | `dovo-screens-desktop--pull-request-monitoring-settings` | `packages/extension-runtime/src/index.ts`    |
| `studio-tools-settings`            | `dovo-screens-desktop--studio-tools-settings`            | `packages/extension-runtime/src/index.ts`    |
| `artifact-settings`                | `dovo-screens-desktop--artifact-settings`                | `packages/extension-runtime/src/index.ts`    |
| `memory`                           | `dovo-screens-desktop--memory`                           | `packages/extension-runtime/src/index.ts`    |
| `worktrees`                        | `dovo-screens-desktop--worktrees`                        | `packages/extension-runtime/src/index.ts`    |
| `running-tasks`                    | `dovo-screens-desktop--running-tasks`                    | `packages/extension-runtime/src/index.ts`    |
| `activity`                         | `dovo-screens-desktop--activity`                         | `packages/extension-runtime/src/index.ts`    |
| `general`                          | `dovo-screens-desktop--general`                          | `packages/studio-shell/src/app-extension.ts` |
| `task-list-settings`               | `dovo-screens-desktop--task-list-settings`               | `packages/studio-shell/src/app-extension.ts` |
| `conversation-settings`            | `dovo-screens-desktop--conversation-settings`            | `packages/studio-shell/src/app-extension.ts` |
| `updates-settings`                 | `dovo-screens-desktop--updates-settings`                 | `packages/studio-shell/src/app-extension.ts` |
| `browser-settings`                 | `dovo-screens-desktop--browser-settings`                 | `packages/studio-shell/src/app-extension.ts` |
| `notifications`                    | `dovo-screens-desktop--notifications`                    | `packages/studio-shell/src/app-extension.ts` |
| `appearance`                       | `dovo-screens-desktop--appearance`                       | `packages/studio-shell/src/app-extension.ts` |
| `diffs`                            | `dovo-screens-desktop--diffs`                            | `packages/studio-shell/src/app-extension.ts` |
| `usage`                            | `dovo-screens-desktop--usage`                            | `packages/studio-shell/src/app-extension.ts` |
| `shortcuts`                        | `dovo-screens-desktop--shortcuts`                        | `packages/studio-shell/src/app-extension.ts` |

The route control lets you move across all registered pages; the real navigation rail and settings
navigation also work. Four additional stories cover empty tasks, opening workspace, read failure
(Activity), and offline cached tasks. Each route also accepts those states through controls, but
each page owns its presentation; a sync failure does not automatically replace snapshot-driven
content with an error screen.

## Data and safety

All computers, tasks, repositories, models, attachments, and credentials are synthetic. Host
navigation stays inside the story. Workspace edits stay in React state. Runtime/account mutations
fail locally; there is no backing runtime or account. Known settings, preference, memory, and
activity reads are schema-decoded local responses. Unknown reads fail locally and may show the
production integration-not-configured or read-error UI. Local app preferences can change this
catalog origin's preferences, not the installed desktop application.

## Scope limits

This is complete **registered top-level route coverage**, not every possible page state or detail
route. It does not cover every task inspector substate, terminal/browser/artifact integration, every
pipeline detail, pairing/sign-in lifecycle, live remote-desktop/device-preview sessions, or every
native platform shell state. The selected-page and overlay coverage below complements the top-level
route inventory. Existing component stories cover several of those lower-level views; additional
real integration fixtures are still needed. Empty third-party accounts and disabled integration
states are deliberate and are not evidence that populated integration layouts have been verified.

## Selected pages, inspectors, and overlays

`Dovo/Screens/Desktop detail and overlays` adds:

- Selected live/offline thread with actual project panel, thread list, conversation, queued
  follow-ups, composer, and tools rail.
- Right-side files, linked projects, agents, side chats, artifacts, browser and device panels,
  opened by real tool controls. On narrow layouts, desktop-only side-chat/tool stories retain the
  production compact presentation; native screens have their own catalog.
- Full pull request detail controller in overview, changes and checks tabs with synthetic comments,
  file patch and checks.
- Issue detail within the real WorkContent list/detail composition.
- Automation run history and graph canvas; selecting a graph node opens the actual step inspector.
  The graph is disabled and synthetic; edits remain local.
- Production command palette with local synthetic commands, and actual quick-task launcher form with
  isolated bridge. Submitting cannot start a real task.

These cover the common selected-page structures. Remaining uncovered live integrations include
terminal sessions and running browser/device sessions. Utility-window and onboarding coverage
follows below. Empty artifacts and device states are intentional; a non-empty artifact editor/viewer
remains in its dedicated catalog stories.

`Dovo/Screens/Desktop utility windows` adds the actual input-preview permission/question UI,
disconnected state and recoverable answer failure, plus Windows runtime onboarding and discovery
failure. The Windows fixture refuses an existing desktop bridge, installs an isolated synthetic
bridge for the story lifetime, and removes it on unmount. Its native/WSL selection and diagnostics
never invoke operating-system operations. `SelectedPipeline` includes the production pipeline
summary/jobs/steps/graph, and `AutomationStepInspector` opens the real graph node inspector through
its UI.

The outer `SelectedPullPage`, `SelectedIssuePage`, and `SelectedPipelinePage` stories additionally
render the original full extension route modules, using real deep-link navigation and populated
synthetic lists. This preserves each page's source selector/list sidebar alongside its selected
detail. The controller-level detail stories above remain useful for inspecting tabs independently.

Desktop release checks use the same typed synthetic release fixture as the mobile App & updates
screen. A catalog-only transform replaces just the release loader import in the production
`useRuntimeReleaseCheck` module; version comparison and runtime update helpers keep their real
implementation. The transform fails the build if that import changes, so a refactor cannot silently
restore GitHub requests. Production builds retain their normal release lookup. Browser checks cover
both themes and viewport sizes and reject external/API requests.
