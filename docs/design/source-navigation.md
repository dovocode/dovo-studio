# Sources and automation navigation

This continues the [Tasks navigation pass](navigation-follow-through.md). Issues, PRs, Pipelines and
Automations now open native detail routes while retaining their collection underneath.

## Lists and details

Back buttons and iOS back gestures return to the same search, filters and reading position. PR and
Pipeline collection controls remain on the collection. A detail's header identifies its project and
computer; secondary operations stay in its actions menu.

Lists retain the user's scroll position through native tab-bar inset changes, including rows near
the bottom. A new drag takes control again. Pipeline lists are opened from PR checks and preserve
the originating PR on Back. Cold run links remain available from investigation tasks and return to
PRs when there is no originating PR.

Automations uses a compact, searchable list with the trigger, current or latest run state and step
progress. Opening one shows run controls, progress, review gates, history and editing. Pending run
request identities survive Back and reopening during the app session, so retrying a lost response
does not create another run. This is not a durable outbox across process termination.

Issue and pipeline task creation reuses its request identity only until the server acknowledges
success. Starting another linked task then creates a new draft. Delayed completion on a hidden
source screen waits for that screen to regain focus before navigating.

## Computer and source identity

Routes include the saved computer and project identity, with native stack anchors for incoming
links. The route checks that the owner is saved, selected and has the project before mounting detail
reads or actions. Opening an item on another computer selects its owner automatically while its
route is focused. Unknown computers, removed projects and invalid PR numbers have recoverable
fallback screens.

Changing a project's checkout or provider binding resets incompatible detail state. Issue and
pipeline links also validate their original source URL before accepting cached, fresh or paginated
results. The shared read cache separates computers and credentials; source keys include checkout and
integration bindings. Cached issue and pipeline lists, options and details can reopen offline.
Mutations require a connected computer, active screen and fresh data.

PR mutations mark the owning computer's project list for a forced refresh on return. Failed or stale
refreshes keep that marker until a fresh result arrives. Background lists pause polling.

## Unified collections

Tasks, PRs, Issues, Automations and Settings combine saved computers by default on desktop, web and
mobile. A global runtime dropdown is no longer required. Each row identifies its host; project
filters narrow the collection without changing the execution destination. Search and filters survive
opening another computer’s detail and returning to the collection.

Creation and connection setup ask for a destination project/computer inside the action. Reads use
that source’s account and cache; writes remain bound to the opened item’s computer. Overlapping IDs
are kept separate across hosts. Two checkouts of the same upstream source remain separate because
they may have different signed-in accounts and task context.

Offline computers retain saved rows. One failed source does not remove other computers’ results.
Forgotten computers, replaced credentials and changed project bindings invalidate incompatible
results. Opening a different desktop computer requires connecting to that host; cached automation
history can be read without connecting. Mobile can reopen available cached details. Commands and
mutations still require a connection. No merge of workspaces or synchronization of files between
computers is implied.

### Unified settings

Agents, source-control accounts, MCP servers and skills are grouped by computer in one view.
Resources show every project and custom-agent scope; there is no choose-first scope dropdown.
Offline agent/resource snapshots and non-secret account metadata remain visible. Account credentials
stay on their runtime; cached account metadata is isolated by the saved connection credentials.

Creating or editing an agent, account or resource targets the computer shown beside it. These
settings use explicit owner-bound requests and do not change the open task's execution host.
Workspace changes keep field-level conflict checks. Device management opens from a computer's row;
its trusted devices, commands and activity all belong to that host. A connection change or forgotten
computer invalidates its open settings. Mobile project creation and Shortcuts choose their target
inside the creation flow, with no persistent runtime picker.

## Scope

Tasks, Issues, PRs/Pipelines and Automations now use native stacks inside Expo's existing native
tabs. Settings retains its local pages and native sheets. No new navigation or state dependency was
added. Runtime and provider mutation contracts are unchanged.

Verification uses isolated simulators and local fixture runtimes, not live provider accounts or the
physical phone. Artifacts for this pass are under `work/design/source-navigation`.

## Earlier navigation verification

- 689 tests across 110 files pass; workspace types, lint and formatting checks pass.
- The iOS Release simulator build passes.
- PR native Back, edge swipe, retained search/filter/sort/scroll, cold links, invalid numbers and
  unknown-computer guards pass. The final list row stays above the native tab bar on return.
- PR workflows pass review/comment actions, Markdown, checks, diffs, retained review progress and
  offline cold launch. Back/menu targets remain usable and Review stays within its bounds at the
  three tested text sizes.
- Automation workflows pass lost-response retry after native Back/reopen, failed-step retry without
  repeating completed steps, review approval, and creation/editing from the new list/detail layout.
- Tasks regressions pass native navigation, lifecycle menus, retained drafts and sorting, Projects,
  shortcut creation and cold draft links.
- Issue/pipeline workflows pass retained collection filters, source/host guards, distinct linked
  drafts, run metadata/steps, dispatch and checkout-scoped CLI profile discovery. Offline forms
  preserve text and disable submission; cached details reopen after Back and cold launch, and a cold
  pipeline link returns to Pipelines. Mismatched original source URLs remain blocked offline.

Rendered examples:
[automation list](../../work/design/source-navigation/jobs/dovo-mobile-automation-list.png),
[restored PR list](../../work/design/source-navigation/prs/dovo-mobile-pr-list-restored.png).

Reproduce the native checks with an isolated simulator UUID:

```sh
node scripts/verify-mobile-pulls.mjs <UUID> --navigation-only
node scripts/verify-mobile-pulls.mjs <UUID>
node scripts/verify-mobile-work.mjs <UUID>
node scripts/verify-mobile.mjs <UUID> --jobs-only
node scripts/verify-mobile.mjs <UUID> --navigation-only
```

## Unified-collection verification

The unified views pass 721 tests across 120 files, formatting/lint/type checks, and desktop/web
production builds. The Chrome walkthrough uses two isolated runtimes with deliberately overlapping
IDs. It covers all five collections, automatic owner selection, retained search, paginated polling,
final-page handling, and offline cache retention. Reproduce it with:

```sh
node scripts/verify-unified-web.mjs
```

Mobile has an additional two-host fixture (`scripts/verify-mobile-collections.mjs <UUID>`); its QA
notes live in `work/verification/unified-mobile/notes.md`. Both walkthroughs use temporary runtimes
and isolated client profiles.

## Settings verification

The browser walkthrough also checks agents, resources, accounts and device commands across two
hosts, including owner-only writes with overlapping IDs, no active-runtime changes, and offline
settings. The native equivalent uses an isolated simulator with the Release app installed:

```sh
node scripts/verify-mobile-settings.mjs <UUID>
```

The native walkthrough also verifies explicit project and Shortcut destinations while another host
is active, including the system confirmation when opening a Shortcut URL.

Artifacts and build/check logs for this pass are under `work/design/unified-everywhere`.
