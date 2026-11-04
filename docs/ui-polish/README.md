# UI polish overhaul

The desktop workspace keeps its black `#080808` canvas and thin, icon-only activity bar. Bundled
Inter, calmer surfaces, shared gutters and more readable metadata bring the conversation, Browser,
PRs, terminal, panels and settings into one visual system.

Thread info now floats over the chat without resizing the conversation, bounded to the chat pane and
clear of its composer. Flat project, checkout and action sections retain their customization order
and visibility, portal state and close/Escape controls. Sidebars retain softly outlined rounded
corners; the main chat and Browser surfaces stay flat and borderless. Neutral selections and
restrained separators keep the composition calm.

## Review the result

| Unified workspace · dark                                           | Unified workspace · light                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| ![Dark unified workspace](screenshots/unified-workspace-dark.webp) | ![Light unified workspace](screenshots/unified-workspace-light.webp) |

| Open model and access picker                                 | PR changes                                        |
| ------------------------------------------------------------ | ------------------------------------------------- |
| ![Model picker](screenshots/conversation-controls-dark.webp) | ![PR changes](screenshots/pull-changes-dark.webp) |

| Thread info · dark                                     | Thread info · light                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| ![Thread info dark](screenshots/thread-info-dark.webp) | ![Thread info light](screenshots/thread-info-light.webp) |

- Thread rows retain project and status above a single-line ellipsized title, with visible machine,
  harness, PR and terminal indicators.
- Artifact export chrome and image editing follow the active theme with bundled offline typography;
  exported document styling stays intact. Image zoom, fit, actual size and pan preserve source
  pixels; drawing uses image coordinates at every zoom. Import dialogs share the same fields and
  action footer.
- The queue and composer align with conversation content; long previews keep attachment counts
  visible. Narrow desktop panes put the input above its controls.
- Merge and auto-merge confirmations load current check reports and offer refresh/retry without
  changing tabs. Undo failures offer an explicit scoped refresh before retry, preserving drafts,
  queued messages and the captured turn.
- Selected and disabled actions have distinct treatment. Stop remains visible without an animated
  halo. Toggle boundaries and keyboard focus remain legible.
- Settings share one title, description and content-column pattern. PR diffs start sooner, retain
  multi-file review navigation and keep retry actions.
- Settings dropdowns share their field treatment. Save/Discard appears after edits, with saved
  feedback and additional actions still available afterward. Empty panels give a clear next action.
- The bottom terminal now remains open alongside thread tools. Its frame, toolbar and pane dividers
  use theme tokens in both modes.

## Evidence and limits

The refreshed gallery includes 300 captures: production desktop routes/compositions in both themes,
compact views, tooltips, open controls, follow-up dialogs and image-editing substates. Six earlier
comparison images are retained. A fresh capture pass includes the chat overlay, image zoom/pan,
consistent thread terminology, dialog fields and expanded file tree. Review status below records
which frozen gallery each council round inspected. The checked-in WebP files are lossless
conversions of the reviewed PNGs. All captures use production components with schema-checked
synthetic workspace data; account/runtime mutations are blocked. Empty collections are intentional
empty states.

Browser uses the production BrowserPane with a synthetic native bridge. Terminal uses the production
worker, renderer and WASM with a local WebSocket replay. Captures wait for rendered terminal output;
its `git status` text is sample data. These previews do not verify live Electron browser
integrations or real provider/account connections.

Earlier gallery45 included the automation spacing correction, consistent collection rows and stable
PR check summaries across tabs. Merge receives primary emphasis only when readiness is positive.
Undo recovery emphasizes Refresh, access values remain readable, and conversation navigation has a
grouped gutter and a latest-message action beside the reading column. Artifact empty states offer a
useful next action. Long-history navigation also settles deferred message layouts and respects
interrupted jumps.

The latest pass restores the desktop thread-grouping selector, protects explicit snoozing drafts,
aligns Settings fields and agent save actions, and explains known project-deletion blockers before
submission. Git Push uses current branch tracking and ahead/behind state; selection actions follow
the files they act on. Disabled primary actions retain their filled silhouette without hover/glow,
merge consent reads as consent, and Stop confirmations match the composer. Collection typography
follows Appearance text sizing, and image preview Fit/Actual size modes have visible selection.

The current pass places Settings scope/storage cues directly below each page description, aligns
fields, labels separately saved groups, compacts Agent profiles and shows inherited archive policies
without truncation. Terminal font size uses a bounded numeric stepper. Section headings use spacing
instead of trailing rules, and active-thread text stays quiet while icons retain semantic color. PR
Checks explicitly marks known failures. A
[generated Settings reference](../../output/imagegen/README.md) from `gpt-image-2.5` informed the
hierarchy; it is separate from the application evidence below.

Git staging now offers read-only per-file comparisons: HEAD → index and index → working file. Back
returns to the same commit draft and selections. Partial staging is explicit, index bytes are
preserved, conflicts and concurrent changes report useful errors, and large/binary previews remain
bounded. The gallery includes both comparison views.

The Git dialog separates staged files from the unstaged selection, supports per-file Unstage without
changing working contents, and labels the commit message. Partial staging appears in both groups;
clean checkouts omit the empty commit form. Commits still include every staged file. Older runtimes
without metadata report that limitation explicitly. Commit-ready and edited-agent captures
distinguish available actions from disabled or clean states. Issue creation and pipeline dialogs
name the captured project/source and computer. Daybreak help expands inline, collapsed sections
identify the current thread, and terminal font previews only show Nerd Font glyphs for that selected
font. Terminal font size uses a bounded numeric stepper; open pickers stay within the viewport.

Desktop follow-up confirmations now use the shared themed dialog, with Cancel focus, return focus,
queued decisions and cancellation when the runtime, caller or edited target changes. MCP consent
shows full scrollable details, and visibility refreshes preserve pending requests. Merge consent
explicitly acknowledges current failures and resets if readiness changes. Nested dialogs use one
scrim, and light mode keeps more workspace context visible. Devices & runtime puts computers first
and hides completed connection steps. Legacy Remote desktop offers an update action; pipeline inputs
include an accessible example and default explanation. Light off-switches have neutral thumbs with
clear boundaries.

Settings now use page-specific breadcrumbs, stronger section hierarchy, labeled project/computer
targets and aligned control columns. Explicit-save pages explain their scope and save mode.
Appearance keeps the selected palette visible, with all 17 choices in Browse palettes; it shows Glow
as Off or a percentage and includes live font previews. Settings search waits for navigation
approval before highlighting a field, and scroll-aware fades soften sidebar edges. Dovo services
have field-level help and unsaved-navigation protection. Supported and legacy Remote desktop states
are captured separately. All Settings sections and preferences remain.

Council review is **in progress**. Fresh reviewers assess the current UI without past ratings,
target scores or historical findings in their briefs. Earlier numeric reviews are historical
evidence, not approval of this redesign. See [council.json](council.json) for the record.

The latest direction reduces competing chrome: one tool rail owns pane controls, thread state is
explicit, and the composer and queue are shorter. Thread info prioritizes project, checkout and next
actions while preserving every section and its ordering/visibility customization. The model picker
uses one compact column with a pinned access footer. Thread-list sections and grouping remain
available. Populated workspace, long-draft and mid-scroll captures supplement sparse catalog pages
so density and overflow can be assessed realistically. Populated Needs input, Waiting and Snoozed
groups show the retained section controls in use. Collection pages share quick views and a secondary
Filters action; Automations uses the same flat list composition. Unavailable pipeline actions
explain the missing capability and link to Sources.

Gemini Argon exists in AGY as `gemini-4-argon-high`; its ACP adapter rejected read-only mode, and a
direct sandboxed review failed with provider `503 auth_not_found`. A fresh gallery41 attempt through
the configured Google/AGY agent accepted ask mode, then rejected the model as unavailable for its
current authentication method. A direct plan+sandbox retry also returned `503 auth_not_found`. It
has not issued an assessment. The previous Muse attempt hit a subscription quota limit. After
Dominic reported restored availability, another exact-model `muse-wonder-full-1.0` retry still
returned the quota error, with a reset at 18:51:35 UTC on November 4. No assessment is claimed for
either failed attempt. Static design reviews do not replace interaction and accessibility checks.

## Verification

- Desktop and web production builds; typechecks for affected design, UI, shell and extension
  packages.
- Preferences, themes and accessibility unit tests.
- Shared control checks: keyboard activation/focus, touch targets, selected/disabled states,
  constrained selects, searchable pickers, toggle contrast and forced colors.
- Composer and rich editor: undo-refresh recovery and stale-runtime guards, drafts, checkout
  locking, queue geometry, attachment counts, placeholder, narrow panes and stop-button contrast.
- Shared confirmations: accept/Cancel/Escape/focus, queued/full request details, nested draft
  preservation, runtime/context/unmount cancellation, async navigation and MCP refresh regression.
- Git: staged/unstaged groups, partial staging, Unstage, literal path handling and checkout guards.
- PR workspace/list: tabs, filters, row menus, comments, review/merge confirmations, retained
  drafts, offline and compact layouts.
- Terminal: typing, resizing, split/orientation/shortcuts, focus, scrollback, file drops, clipboard,
  read-only guards and stale-operation isolation.
- Settings and Browser: scope targeting/inheritance, explicit saves, conflict/offline drafts,
  profiles and domain/path rules.
- Appearance matrix across 34 palette/mode combinations, fonts, system mode, terminal continuity and
  forced colors; shared palette mobile checks.
- Screenshot capture: no preview alerts, page exceptions or loading placeholders; black canvas and
  thin rail assertions; compact overflow and tooltip focus checks.

These are targeted checks, not a claim that every possible native integration or control state was
exercised. See the PR for the checks run for this revision.

To reproduce the full PNG set:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/web-ui build
pnpm --filter @dovo/client-runtime build
node scripts/capture-ui-polish.mjs /tmp/dovo-ui-review --all --controls --dialogs
```

Use `--only=conversation,pulls,appearance,browser,thread-info` for a quick focused pass. Screenshot
previews isolate runtime/account writes and use no live user data.

## Full gallery

148 surfaces in both themes.

| Surface                          | Dark                                                                 | Light                                                                 |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| activity                         | [Screenshot](screenshots/activity-dark.webp)                         | [Screenshot](screenshots/activity-light.webp)                         |
| add-agent                        | [Screenshot](screenshots/add-agent-dark.webp)                        | [Screenshot](screenshots/add-agent-light.webp)                        |
| add-agent-model                  | [Screenshot](screenshots/add-agent-model-dark.webp)                  | [Screenshot](screenshots/add-agent-model-light.webp)                  |
| add-agent-model-scrolled         | [Screenshot](screenshots/add-agent-model-scrolled-dark.webp)         | [Screenshot](screenshots/add-agent-model-scrolled-light.webp)         |
| add-agent-profile                | [Screenshot](screenshots/add-agent-profile-dark.webp)                | [Screenshot](screenshots/add-agent-profile-light.webp)                |
| add-mcp                          | [Screenshot](screenshots/add-mcp-dark.webp)                          | [Screenshot](screenshots/add-mcp-light.webp)                          |
| add-skill                        | [Screenshot](screenshots/add-skill-dark.webp)                        | [Screenshot](screenshots/add-skill-light.webp)                        |
| agents                           | [Screenshot](screenshots/agents-dark.webp)                           | [Screenshot](screenshots/agents-light.webp)                           |
| agents-legacy                    | [Screenshot](screenshots/agents-legacy-dark.webp)                    | [Screenshot](screenshots/agents-legacy-light.webp)                    |
| appearance                       | [Screenshot](screenshots/appearance-dark.webp)                       | [Screenshot](screenshots/appearance-light.webp)                       |
| appearance-controls              | [Screenshot](screenshots/appearance-controls-dark.webp)              | [Screenshot](screenshots/appearance-controls-light.webp)              |
| appearance-palettes              | [Screenshot](screenshots/appearance-palettes-dark.webp)              | [Screenshot](screenshots/appearance-palettes-light.webp)              |
| approval-rules                   | [Screenshot](screenshots/approval-rules-dark.webp)                   | [Screenshot](screenshots/approval-rules-light.webp)                   |
| archived-tasks                   | [Screenshot](screenshots/archived-tasks-dark.webp)                   | [Screenshot](screenshots/archived-tasks-light.webp)                   |
| artifact-actions                 | [Screenshot](screenshots/artifact-actions-dark.webp)                 | [Screenshot](screenshots/artifact-actions-light.webp)                 |
| artifact-export                  | [Screenshot](screenshots/artifact-export-dark.webp)                  | [Screenshot](screenshots/artifact-export-light.webp)                  |
| artifact-settings                | [Screenshot](screenshots/artifact-settings-dark.webp)                | [Screenshot](screenshots/artifact-settings-light.webp)                |
| artifacts                        | [Screenshot](screenshots/artifacts-dark.webp)                        | [Screenshot](screenshots/artifacts-light.webp)                        |
| branch-menu                      | [Screenshot](screenshots/branch-menu-dark.webp)                      | [Screenshot](screenshots/branch-menu-light.webp)                      |
| branch-move                      | [Screenshot](screenshots/branch-move-dark.webp)                      | [Screenshot](screenshots/branch-move-light.webp)                      |
| browser                          | [Screenshot](screenshots/browser-dark.webp)                          | [Screenshot](screenshots/browser-light.webp)                          |
| browser-bookmarks                | [Screenshot](screenshots/browser-bookmarks-dark.webp)                | [Screenshot](screenshots/browser-bookmarks-light.webp)                |
| browser-controls                 | [Screenshot](screenshots/browser-controls-dark.webp)                 | [Screenshot](screenshots/browser-controls-light.webp)                 |
| browser-history                  | [Screenshot](screenshots/browser-history-dark.webp)                  | [Screenshot](screenshots/browser-history-light.webp)                  |
| browser-settings                 | [Screenshot](screenshots/browser-settings-dark.webp)                 | [Screenshot](screenshots/browser-settings-light.webp)                 |
| browsers-panel                   | [Screenshot](screenshots/browsers-panel-dark.webp)                   | [Screenshot](screenshots/browsers-panel-light.webp)                   |
| busy-conversation                | [Screenshot](screenshots/busy-conversation-dark.webp)                | [Screenshot](screenshots/busy-conversation-light.webp)                |
| busy-long-draft                  | [Screenshot](screenshots/busy-long-draft-dark.webp)                  | [Screenshot](screenshots/busy-long-draft-light.webp)                  |
| busy-mid-scroll                  | [Screenshot](screenshots/busy-mid-scroll-dark.webp)                  | [Screenshot](screenshots/busy-mid-scroll-light.webp)                  |
| busy-sections                    | [Screenshot](screenshots/busy-sections-dark.webp)                    | [Screenshot](screenshots/busy-sections-light.webp)                    |
| busy-unified-workspace           | [Screenshot](screenshots/busy-unified-workspace-dark.webp)           | [Screenshot](screenshots/busy-unified-workspace-light.webp)           |
| command-palette                  | [Screenshot](screenshots/command-palette-dark.webp)                  | [Screenshot](screenshots/command-palette-light.webp)                  |
| commands                         | [Screenshot](screenshots/commands-dark.webp)                         | [Screenshot](screenshots/commands-light.webp)                         |
| computer-use                     | [Screenshot](screenshots/computer-use-dark.webp)                     | [Screenshot](screenshots/computer-use-light.webp)                     |
| conversation                     | [Screenshot](screenshots/conversation-dark.webp)                     | [Screenshot](screenshots/conversation-light.webp)                     |
| conversation-compact             | [Screenshot](screenshots/conversation-compact-dark.webp)             | [Screenshot](screenshots/conversation-compact-light.webp)             |
| conversation-controls            | [Screenshot](screenshots/conversation-controls-dark.webp)            | [Screenshot](screenshots/conversation-controls-light.webp)            |
| conversation-daybreak-help       | [Screenshot](screenshots/conversation-daybreak-help-dark.webp)       | [Screenshot](screenshots/conversation-daybreak-help-light.webp)       |
| conversation-settings            | [Screenshot](screenshots/conversation-settings-dark.webp)            | [Screenshot](screenshots/conversation-settings-light.webp)            |
| device-previews                  | [Screenshot](screenshots/device-previews-dark.webp)                  | [Screenshot](screenshots/device-previews-light.webp)                  |
| devices-panel                    | [Screenshot](screenshots/devices-panel-dark.webp)                    | [Screenshot](screenshots/devices-panel-light.webp)                    |
| diffs                            | [Screenshot](screenshots/diffs-dark.webp)                            | [Screenshot](screenshots/diffs-light.webp)                            |
| downloads                        | [Screenshot](screenshots/downloads-dark.webp)                        | [Screenshot](screenshots/downloads-light.webp)                        |
| draft-stash                      | [Screenshot](screenshots/draft-stash-dark.webp)                      | [Screenshot](screenshots/draft-stash-light.webp)                      |
| edit-agent                       | [Screenshot](screenshots/edit-agent-dark.webp)                       | [Screenshot](screenshots/edit-agent-light.webp)                       |
| edit-agent-dirty                 | [Screenshot](screenshots/edit-agent-dirty-dark.webp)                 | [Screenshot](screenshots/edit-agent-dirty-light.webp)                 |
| files-panel                      | [Screenshot](screenshots/files-panel-dark.webp)                      | [Screenshot](screenshots/files-panel-light.webp)                      |
| forge-connections                | [Screenshot](screenshots/forge-connections-dark.webp)                | [Screenshot](screenshots/forge-connections-light.webp)                |
| git-actions                      | [Screenshot](screenshots/git-actions-dark.webp)                      | [Screenshot](screenshots/git-actions-light.webp)                      |
| git-actions-commit-ready         | [Screenshot](screenshots/git-actions-commit-ready-dark.webp)         | [Screenshot](screenshots/git-actions-commit-ready-light.webp)         |
| git-actions-review-staged        | [Screenshot](screenshots/git-actions-review-staged-dark.webp)        | [Screenshot](screenshots/git-actions-review-staged-light.webp)        |
| git-actions-review-unstaged      | [Screenshot](screenshots/git-actions-review-unstaged-dark.webp)      | [Screenshot](screenshots/git-actions-review-unstaged-light.webp)      |
| git-actions-menu                 | [Screenshot](screenshots/git-actions-menu-dark.webp)                 | [Screenshot](screenshots/git-actions-menu-light.webp)                 |
| git-actions-selection            | [Screenshot](screenshots/git-actions-selection-dark.webp)            | [Screenshot](screenshots/git-actions-selection-light.webp)            |
| harness                          | [Screenshot](screenshots/harness-dark.webp)                          | [Screenshot](screenshots/harness-light.webp)                          |
| image-editor                     | [Screenshot](screenshots/image-editor-dark.webp)                     | [Screenshot](screenshots/image-editor-light.webp)                     |
| image-editor-annotated           | [Screenshot](screenshots/image-editor-annotated-dark.webp)           | [Screenshot](screenshots/image-editor-annotated-light.webp)           |
| image-editor-crop                | [Screenshot](screenshots/image-editor-crop-dark.webp)                | [Screenshot](screenshots/image-editor-crop-light.webp)                |
| image-editor-shortcuts           | [Screenshot](screenshots/image-editor-shortcuts-dark.webp)           | [Screenshot](screenshots/image-editor-shortcuts-light.webp)           |
| image-editor-zoom                | [Screenshot](screenshots/image-editor-zoom-dark.webp)                | [Screenshot](screenshots/image-editor-zoom-light.webp)                |
| image-preview                    | [Screenshot](screenshots/image-preview-dark.webp)                    | [Screenshot](screenshots/image-preview-light.webp)                    |
| import-codex                     | [Screenshot](screenshots/import-codex-dark.webp)                     | [Screenshot](screenshots/import-codex-light.webp)                     |
| import-pi                        | [Screenshot](screenshots/import-pi-dark.webp)                        | [Screenshot](screenshots/import-pi-light.webp)                        |
| issue-comment                    | [Screenshot](screenshots/issue-comment-dark.webp)                    | [Screenshot](screenshots/issue-comment-light.webp)                    |
| issue-create                     | [Screenshot](screenshots/issue-create-dark.webp)                     | [Screenshot](screenshots/issue-create-light.webp)                     |
| issue-edit                       | [Screenshot](screenshots/issue-edit-dark.webp)                       | [Screenshot](screenshots/issue-edit-light.webp)                       |
| issues                           | [Screenshot](screenshots/issues-dark.webp)                           | [Screenshot](screenshots/issues-light.webp)                           |
| jira                             | [Screenshot](screenshots/jira-dark.webp)                             | [Screenshot](screenshots/jira-light.webp)                             |
| jira-sources                     | [Screenshot](screenshots/jira-sources-dark.webp)                     | [Screenshot](screenshots/jira-sources-light.webp)                     |
| jobs                             | [Screenshot](screenshots/jobs-dark.webp)                             | [Screenshot](screenshots/jobs-light.webp)                             |
| licenses                         | [Screenshot](screenshots/licenses-dark.webp)                         | [Screenshot](screenshots/licenses-light.webp)                         |
| link-pr                          | [Screenshot](screenshots/link-pr-dark.webp)                          | [Screenshot](screenshots/link-pr-light.webp)                          |
| linked-projects-panel            | [Screenshot](screenshots/linked-projects-panel-dark.webp)            | [Screenshot](screenshots/linked-projects-panel-light.webp)            |
| local-commits                    | [Screenshot](screenshots/local-commits-dark.webp)                    | [Screenshot](screenshots/local-commits-light.webp)                    |
| memory                           | [Screenshot](screenshots/memory-dark.webp)                           | [Screenshot](screenshots/memory-light.webp)                           |
| navigation-tooltip               | [Screenshot](screenshots/navigation-tooltip-dark.webp)               | [Screenshot](screenshots/navigation-tooltip-light.webp)               |
| new-automation                   | [Screenshot](screenshots/new-automation-dark.webp)                   | [Screenshot](screenshots/new-automation-light.webp)                   |
| new-session                      | [Screenshot](screenshots/new-session-dark.webp)                      | [Screenshot](screenshots/new-session-light.webp)                      |
| notifications                    | [Screenshot](screenshots/notifications-dark.webp)                    | [Screenshot](screenshots/notifications-light.webp)                    |
| open-in-menu                     | [Screenshot](screenshots/open-in-menu-dark.webp)                     | [Screenshot](screenshots/open-in-menu-light.webp)                     |
| pair-computer                    | [Screenshot](screenshots/pair-computer-dark.webp)                    | [Screenshot](screenshots/pair-computer-light.webp)                    |
| pipeline-run                     | [Screenshot](screenshots/pipeline-run-dark.webp)                     | [Screenshot](screenshots/pipeline-run-light.webp)                     |
| pipelines                        | [Screenshot](screenshots/pipelines-dark.webp)                        | [Screenshot](screenshots/pipelines-light.webp)                        |
| pr-add-to-thread                 | [Screenshot](screenshots/pr-add-to-thread-dark.webp)                 | [Screenshot](screenshots/pr-add-to-thread-light.webp)                 |
| pr-ask-agent                     | [Screenshot](screenshots/pr-ask-agent-dark.webp)                     | [Screenshot](screenshots/pr-ask-agent-light.webp)                     |
| pr-auto-merge                    | [Screenshot](screenshots/pr-auto-merge-dark.webp)                    | [Screenshot](screenshots/pr-auto-merge-light.webp)                    |
| pr-close                         | [Screenshot](screenshots/pr-close-dark.webp)                         | [Screenshot](screenshots/pr-close-light.webp)                         |
| pr-comment                       | [Screenshot](screenshots/pr-comment-dark.webp)                       | [Screenshot](screenshots/pr-comment-light.webp)                       |
| pr-create                        | [Screenshot](screenshots/pr-create-dark.webp)                        | [Screenshot](screenshots/pr-create-light.webp)                        |
| pr-draft                         | [Screenshot](screenshots/pr-draft-dark.webp)                         | [Screenshot](screenshots/pr-draft-light.webp)                         |
| pr-edit                          | [Screenshot](screenshots/pr-edit-dark.webp)                          | [Screenshot](screenshots/pr-edit-light.webp)                          |
| pr-merge                         | [Screenshot](screenshots/pr-merge-dark.webp)                         | [Screenshot](screenshots/pr-merge-light.webp)                         |
| pr-review                        | [Screenshot](screenshots/pr-review-dark.webp)                        | [Screenshot](screenshots/pr-review-light.webp)                        |
| pr-reviewers                     | [Screenshot](screenshots/pr-reviewers-dark.webp)                     | [Screenshot](screenshots/pr-reviewers-light.webp)                     |
| project-actions                  | [Screenshot](screenshots/project-actions-dark.webp)                  | [Screenshot](screenshots/project-actions-light.webp)                  |
| project-actions-discard          | [Screenshot](screenshots/project-actions-discard-dark.webp)          | [Screenshot](screenshots/project-actions-discard-light.webp)          |
| project-actions-menu             | [Screenshot](screenshots/project-actions-menu-dark.webp)             | [Screenshot](screenshots/project-actions-menu-light.webp)             |
| project-actions-validation       | [Screenshot](screenshots/project-actions-validation-dark.webp)       | [Screenshot](screenshots/project-actions-validation-light.webp)       |
| project-delete                   | [Screenshot](screenshots/project-delete-dark.webp)                   | [Screenshot](screenshots/project-delete-light.webp)                   |
| project-instructions             | [Screenshot](screenshots/project-instructions-dark.webp)             | [Screenshot](screenshots/project-instructions-light.webp)             |
| project-transfer                 | [Screenshot](screenshots/project-transfer-dark.webp)                 | [Screenshot](screenshots/project-transfer-light.webp)                 |
| pull-changes                     | [Screenshot](screenshots/pull-changes-dark.webp)                     | [Screenshot](screenshots/pull-changes-light.webp)                     |
| pull-checks                      | [Screenshot](screenshots/pull-checks-dark.webp)                      | [Screenshot](screenshots/pull-checks-light.webp)                      |
| pull-overview                    | [Screenshot](screenshots/pull-overview-dark.webp)                    | [Screenshot](screenshots/pull-overview-light.webp)                    |
| pull-request-monitoring-settings | [Screenshot](screenshots/pull-request-monitoring-settings-dark.webp) | [Screenshot](screenshots/pull-request-monitoring-settings-light.webp) |
| pulls                            | [Screenshot](screenshots/pulls-dark.webp)                            | [Screenshot](screenshots/pulls-light.webp)                            |
| pulls-controls                   | [Screenshot](screenshots/pulls-controls-dark.webp)                   | [Screenshot](screenshots/pulls-controls-light.webp)                   |
| remote-desktop                   | [Screenshot](screenshots/remote-desktop-dark.webp)                   | [Screenshot](screenshots/remote-desktop-light.webp)                   |
| remote-desktop-legacy            | [Screenshot](screenshots/remote-desktop-legacy-dark.webp)            | [Screenshot](screenshots/remote-desktop-legacy-light.webp)            |
| repository-forge                 | [Screenshot](screenshots/repository-forge-dark.webp)                 | [Screenshot](screenshots/repository-forge-light.webp)                 |
| repository-github                | [Screenshot](screenshots/repository-github-dark.webp)                | [Screenshot](screenshots/repository-github-light.webp)                |
| repository-local                 | [Screenshot](screenshots/repository-local-dark.webp)                 | [Screenshot](screenshots/repository-local-light.webp)                 |
| resources                        | [Screenshot](screenshots/resources-dark.webp)                        | [Screenshot](screenshots/resources-light.webp)                        |
| running-tasks                    | [Screenshot](screenshots/running-tasks-dark.webp)                    | [Screenshot](screenshots/running-tasks-light.webp)                    |
| runtime                          | [Screenshot](screenshots/runtime-dark.webp)                          | [Screenshot](screenshots/runtime-light.webp)                          |
| saved-prompts                    | [Screenshot](screenshots/saved-prompts-dark.webp)                    | [Screenshot](screenshots/saved-prompts-light.webp)                    |
| section-order                    | [Screenshot](screenshots/section-order-dark.webp)                    | [Screenshot](screenshots/section-order-light.webp)                    |
| settings                         | [Screenshot](screenshots/settings-dark.webp)                         | [Screenshot](screenshots/settings-light.webp)                         |
| shortcuts                        | [Screenshot](screenshots/shortcuts-dark.webp)                        | [Screenshot](screenshots/shortcuts-light.webp)                        |
| side-chats-panel                 | [Screenshot](screenshots/side-chats-panel-dark.webp)                 | [Screenshot](screenshots/side-chats-panel-light.webp)                 |
| source-control                   | [Screenshot](screenshots/source-control-dark.webp)                   | [Screenshot](screenshots/source-control-light.webp)                   |
| source-picker                    | [Screenshot](screenshots/source-picker-dark.webp)                    | [Screenshot](screenshots/source-picker-light.webp)                    |
| stop-confirm                     | [Screenshot](screenshots/stop-confirm-dark.webp)                     | [Screenshot](screenshots/stop-confirm-light.webp)                     |
| studio-tools-settings            | [Screenshot](screenshots/studio-tools-settings-dark.webp)            | [Screenshot](screenshots/studio-tools-settings-light.webp)            |
| task-behavior                    | [Screenshot](screenshots/task-behavior-dark.webp)                    | [Screenshot](screenshots/task-behavior-light.webp)                    |
| task-behavior-legacy             | [Screenshot](screenshots/task-behavior-legacy-dark.webp)             | [Screenshot](screenshots/task-behavior-legacy-light.webp)             |
| task-defaults                    | [Screenshot](screenshots/task-defaults-dark.webp)                    | [Screenshot](screenshots/task-defaults-light.webp)                    |
| task-list-settings               | [Screenshot](screenshots/task-list-settings-dark.webp)               | [Screenshot](screenshots/task-list-settings-light.webp)               |
| task-templates                   | [Screenshot](screenshots/task-templates-dark.webp)                   | [Screenshot](screenshots/task-templates-light.webp)                   |
| terminal                         | [Screenshot](screenshots/terminal-dark.webp)                         | [Screenshot](screenshots/terminal-light.webp)                         |
| terminal-close                   | [Screenshot](screenshots/terminal-close-dark.webp)                   | [Screenshot](screenshots/terminal-close-light.webp)                   |
| terminal-close-multiple          | [Screenshot](screenshots/terminal-close-multiple-dark.webp)          | [Screenshot](screenshots/terminal-close-multiple-light.webp)          |
| text-generation                  | [Screenshot](screenshots/text-generation-dark.webp)                  | [Screenshot](screenshots/text-generation-light.webp)                  |
| thread-archive-confirm           | [Screenshot](screenshots/thread-archive-confirm-dark.webp)           | [Screenshot](screenshots/thread-archive-confirm-light.webp)           |
| thread-context                   | [Screenshot](screenshots/thread-context-dark.webp)                   | [Screenshot](screenshots/thread-context-light.webp)                   |
| thread-delete                    | [Screenshot](screenshots/thread-delete-dark.webp)                    | [Screenshot](screenshots/thread-delete-light.webp)                    |
| thread-info                      | [Screenshot](screenshots/thread-info-dark.webp)                      | [Screenshot](screenshots/thread-info-light.webp)                      |
| thread-info-controls             | [Screenshot](screenshots/thread-info-controls-dark.webp)             | [Screenshot](screenshots/thread-info-controls-light.webp)             |
| thread-rename                    | [Screenshot](screenshots/thread-rename-dark.webp)                    | [Screenshot](screenshots/thread-rename-light.webp)                    |
| thread-template                  | [Screenshot](screenshots/thread-template-dark.webp)                  | [Screenshot](screenshots/thread-template-light.webp)                  |
| tools-tooltip                    | [Screenshot](screenshots/tools-tooltip-dark.webp)                    | [Screenshot](screenshots/tools-tooltip-light.webp)                    |
| undo                             | [Screenshot](screenshots/undo-dark.webp)                             | [Screenshot](screenshots/undo-light.webp)                             |
| undo-error                       | [Screenshot](screenshots/undo-error-dark.webp)                       | [Screenshot](screenshots/undo-error-light.webp)                       |
| unified-workspace                | [Screenshot](screenshots/unified-workspace-dark.webp)                | [Screenshot](screenshots/unified-workspace-light.webp)                |
| updates-settings                 | [Screenshot](screenshots/updates-settings-dark.webp)                 | [Screenshot](screenshots/updates-settings-light.webp)                 |
| usage                            | [Screenshot](screenshots/usage-dark.webp)                            | [Screenshot](screenshots/usage-light.webp)                            |
| website-customization            | [Screenshot](screenshots/website-customization-dark.webp)            | [Screenshot](screenshots/website-customization-light.webp)            |
| welcome                          | [Screenshot](screenshots/welcome-dark.webp)                          | [Screenshot](screenshots/welcome-light.webp)                          |
| welcome-compact                  | [Screenshot](screenshots/welcome-compact-dark.webp)                  | [Screenshot](screenshots/welcome-compact-light.webp)                  |
| worktrees                        | [Screenshot](screenshots/worktrees-dark.webp)                        | [Screenshot](screenshots/worktrees-light.webp)                        |

## Before

The starting captures are retained for comparison: [welcome](screenshots/before-welcome-dark.webp),
[conversation](screenshots/before-conversation-dark.webp),
[PR list](screenshots/before-pulls-dark.webp), [settings](screenshots/before-settings-dark.webp).

Thread info immediately before its redesign: [dark](screenshots/before-thread-info-dark.webp),
[light](screenshots/before-thread-info-light.webp).
