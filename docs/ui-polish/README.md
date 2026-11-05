# UI polish overhaul

The desktop workspace keeps its `#080808` dark canvas, thin activity rail, rounded outlined
sidebars, and flat borderless main chat and Browser. Shared typography, gutters, selection and
control styles make the workspace and its secondary surfaces feel consistent.

## Review the result

Screenshots were reviewed locally and intentionally excluded from the shipping PR at Dominic’s
request. Written assessments, manifests and reproducible capture scripts remain.

- **Workspace:** thread rows retain project/status above one-line ellipsized titles and machine,
  harness, PR and terminal indicators. Thread info overlays chat above the composer. All sections,
  grouping, ordering and visibility controls remain. Queue/composer layouts adapt to narrow panes;
  Stop, Queue and Steer are icon-only with hover titles and accessible names. Wrapped Markdown
  bullets and checklists retain hanging indents.
- **Settings:** page-specific breadcrumbs, aligned fields, consistent section hierarchy and labeled
  project/computer targets pinned during scoped editing. Controls respond to the actual content
  width; Agent profiles switch between flat master/detail and a searchable compact picker. Automatic
  and explicit saves remain clearly distinguished, including an initial save cue on scoped forms.
  The existing Agent profile heading remains visible below the scoped target during long edits;
  measured scroll clearance keeps fields accessible beneath both rows. Agent draft actions stay
  reachable in an opaque footer with readable profile and target identity; pending renames identify
  the saved profile and the name applied on save. Instructions spans the form with six readable
  lines; substantial help uses full-width rows. Appearance retains all palettes and font previews,
  with a bounded terminal size stepper. Search, legacy notices, explicit-save groups and
  unsaved-navigation guards remain. Save cues and Editing/Viewing context follow the selected
  computer’s capabilities; offline targets show one reconnect instruction. Mixed-save pages name
  their explicit-save exceptions, and computer forms explain automatic-save timing beside the
  computer identity, under a real section heading. Device, scoped and computer save cues share one
  visual style; service URLs keep explicit saves and show a truthful clean state with an outlined
  Reset action. Save guidance has a readable text size and emphasis; offline defaults and lifecycle
  offer a direct route to Devices & runtime without changing the selected target. Settings search
  uses the visible thread labels and focuses the matching control; the navigation offers a measured
  continuation action for lower sections. Running-thread save feedback appears before its
  introduction, and lifecycle links retain the computer while opening the relevant restart/archive
  or PR settling defaults. Lifecycle also names the reporting computer above its controls, so the
  source is visible with help collapsed. The navigation continuation uses its visible text as its
  accessible name.
- **Git and PRs:** staged/unstaged groups support partial staging, selection and per-file Unstage.
  Changed-file groups share a bounded scroll area, keeping the commit form discoverable at dense
  desktop sizes; modest three/four-entry change sets fit at the captured normal and compact desktop
  widths, while its continuation cue explains overflow in dense lists. The outer Git workspace names
  additional actions in a separate continuation strip below its viewport. Commit controls show the
  inspected branch/checkout; readable filenames retain full-path tooltips. Per-file comparisons are
  read-only, offer Previous/Next within their comparison group, and preserve Back/draft/selection
  context. Push reflects branch tracking. PR lists reserve a responsive readiness column and keep
  the target branch visible. Issues keep stable Open/Closed filters. Merge readiness separates
  repository status, check reports and linked pipelines; the Checks view explains the repository
  provider’s separate CI summary, with sibling heading and status styling. Failure consent is
  visible, accessible and invalidated by status changes. CI and review signals keep the same order
  down the PR list. Merge dialogs keep action buttons outside the scrolling form body, including
  when status-source details are expanded. Work-list separators remain visible alongside the shared
  collection-row border treatment. Fixed PR/Agent actions and Git continuation reserve the same
  native scrollbar lane as their scroll bodies, aligning content without fixed pixel insets.
- **Dialogs and images:** shared themed confirmations preserve Cancel/return focus, drafts and
  queued decisions, and reject stale runtime/caller/target decisions. MCP details scroll without
  losing consent. Project-deletion blockers provide a safe route to active work. Image
  preview/editing, annotations, crop, fit/actual-size, zoom and pan retain themed controls and
  source-image geometry.

## Evidence and limits

The gallery contains **350 actual app captures across 175 surfaces**, each in dark and light,
including 1100px compact layouts, dense lists, edited Agent forms, long Git comparisons, open
controls and follow-up/image dialogs. Checked-in WebPs are lossless conversions, verified
pixel-for-pixel against the PNGs. The latest pass captures the integrated source after merging main,
including the new Terminal starter, with refreshed core surfaces and focused Agent/merge captures
replacing affected frames. Compact Agents keeps Name, Model, Reasoning and Access together; keyboard
traversal now clears the actual sticky headers and dirty footer. The frozen manifest records this
provenance and matching source. Six earlier comparisons remain below.

Captures use production components with schema-checked synthetic data and blocked account/runtime
writes. Dense lists contain 14 rows; some other collections intentionally show empty states. The
native Browser bridge is simulated. Terminal uses the production worker/renderer/WASM with a local
WebSocket replay. Long Git fixture patches include full-file context. These are verification limits,
not evidence of live Electron, provider, account or terminal execution behavior.

The final independent council is **unanimous at 9/10**, meeting Dominic’s revised shipping gate:

| Reviewer                          | Score | Exact full-size frames inspected |
| --------------------------------- | ----- | -------------------------------- |
| Sol A · GPT-6.1                   | 9/10  | 96 (48 per theme)                |
| Sol B · GPT-6.1                   | 9/10  | 100 (50 per theme)               |
| Sol C · GPT-6.1                   | 9/10  | 84 (42 per theme)                |
| Opus A · 5.5                      | 9/10  | 46 (23 per theme)                |
| Opus B · 5.5                      | 9/10  | 50 (24 dark, 26 light)           |
| Muse · supplementary consultation | 9/10  | 48 (26 dark, 22 light)           |

All six recommend shipping with **no required changes**. Reviewers independently inspected frozen
screenshots, matching source and [interaction evidence](interaction-evidence.md). The revised rubric
was explicit; previous ratings were omitted. Their judgments cover sampled desktop/web evidence, not
exhaustive live-provider, native-device or accessibility certification. Optional copy, spacing and
secondary save-cue refinements remain. [council.json](council.json) records the reviewed commit,
source digest, individual coverage, historical findings and provider limits. CI must pass separately
from this design judgment. AGY’s exact Gemini retry returned `503 auth_not_found`; no Gemini
assessment is claimed.

The [post-approval CI supplement](ci-followup/README.md) records the later button geometry,
project-initial contrast and keyboard-scroll corrections. Its refreshed captures are separate from
the frozen 350-frame approval baseline.

A [generated Settings reference](../../output/imagegen/README.md) informed hierarchy and field
alignment, responsive composition and quieter navigation. The [Opus direction](design-direction.md)
records the implementation priorities. Generated concepts are separate from the actual application
evidence.

## Verification

Checks run for the overhaul include production web UI/web/desktop builds, affected package types,
scoped lint/format/diff checks, and targeted browser verification:

- Composer actions, drafts, queue, controls, narrow layouts, Stop contrast and icon-only hover
  names.
- Settings scope/inheritance/saving/navigation, Agent forms and reachable save/error actions.
- PR lists/workspaces, stable issue filters, source targeting, merge guards, failure consent and
  drafts.
- Git staging/partial staging/Unstage/commit/Push, read-only comparisons, unknown targets and long
  paths.
- Markdown wrapped bullets, ordered/nested lists and checklists; themed dialog continuation fades.
- Shared controls, keyboard/focus, selected/disabled states, forced colors and constrained pickers.
- Async confirmations, queued/full MCP details, stale runtime/context/unmount and navigation guards.
- Appearance matrix across 34 palette/mode combinations, fonts and persistence; image and terminal
  controls.

These targeted checks do not establish every native integration or every possible control state.
Captures report no errors or preview alerts; chat and Browser dark canvas pixels measure `(8,8,8)`.

To reproduce the PNG set:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/web-ui build
pnpm --filter @dovo/client-runtime build
node scripts/capture-ui-polish.mjs /tmp/dovo-ui-review --all --controls --dialogs
```

Use `--only=conversation,pulls,appearance,browser,thread-info` for a focused pass.

## Screenshot evidence

The final council reviewed 350 baseline captures, followed by a 20-frame CI correction supplement.
Images and generated concept images are kept outside the source tree; the review records describe
actual coverage and verification limits. Use the capture command above to regenerate the gallery.
