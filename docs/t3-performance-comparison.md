# T3 comparison: performance, interface and tool discovery

Latest adoption review: T3 Code `616c426f5f199865e34974777740dff678ffb7f5` on 2026-10-30. Earlier
comparisons used `7bafc40c17ab`; theme source links remain pinned to `d0b9e9d3c72b`. T3 measurements
are not Dovo measurements.

## Changes in Dovo

- Start loading an actually selected thread before navigation; transfer its three-second lease to
  the mounted screen. Abandoned selections expire, and paired credentials remain isolated.
- Thread lists request 25 eligible settled summaries initially, increasing by 25 on demand. Running,
  pinned, snoozed, feedback, selected, approval/question and subagent-family rows remain available.
  Paging follows Latest prompt / Latest input order rather than settlement dates. Other sorts,
  global search, filtered lists, bulk selection and explicit full-list consumers request complete
  summaries. Search retains unresolved history hits until their summaries arrive. Older runtimes
  remain compatible. Archive summaries are unchanged.
- Unchanged snapshots update a small freshness record instead of rewriting the payload. The record
  is tied to a committed cache ID; interrupted/new payload writes cannot inherit another payload's
  freshness.
- Desktop/web code and diffs use Pierre Highlights. Built-in palettes and imported VS Code themes
  map to Zed token categories, keeping editor colors and bold/italic styles. Contextual TextMate
  selectors and semantic-only rules are not applied; imports disclose this limitation.
- Mobile code viewers reuse up to 20 token results within an estimated 1 MiB budget for the current
  palette. Theme changes retain independent callbacks without permanently retaining every palette's
  cache. Web prepares only the selected palette, resolving other registered themes when selected.
- Agent guidance retains permissions, watch lifecycle, device setup/signing and HTTP connectivity
  rules with less repeated prose.
- PR details expose linked Studio threads across computers, including cached offline threads, and
  open the existing thread picker to link another thread. Source and additional PR associations
  count; coincidental PR numbers/branches do not. Desktop exposes Merge alongside Review, using the
  existing commit-bound confirmation. Existing lists, review comments, checks refresh, stacks and
  merge-provider controls remain the full PR flow.

Sources: [early selection loading](https://github.com/pingdotgg/t3code/pull/24750),
[settled summary paging](https://github.com/pingdotgg/t3code/pull/24723),
[snapshot writes](https://github.com/pingdotgg/t3code/pull/24266),
[agent guidance](https://github.com/pingdotgg/t3code/pull/24850),
[web highlighting](https://github.com/pingdotgg/t3code/pull/23178),
[native highlighting](https://github.com/pingdotgg/t3code/pull/24544),
[PR mobile improvements](https://github.com/pingdotgg/t3code/pull/24602),
[shell PR linking](https://github.com/pingdotgg/t3code/pull/24813).

## Reproducible syntax benchmark

Run `pnpm benchmark:syntax` from the checkout. It uses actual TypeScript, TSX, CSS and JSON files,
fresh Node processes per backend, a cold pass and six warm passes. It checks source reconstruction;
it does not assess syntax classification fidelity. Results vary with machine, corpus and JIT state.

One Linux run with Node 26.8.1 and roughly 97,000 source characters:

| Pierre diff backend         | Initialization | First corpus pass | Warm median |
| --------------------------- | -------------: | ----------------: | ----------: |
| Shiki JavaScript (baseline) |        25.8 ms |          915.0 ms |    114.6 ms |
| Shiki WASM                  |        53.9 ms |          688.5 ms |    135.4 ms |
| Pierre Highlights           |         8.3 ms |            5.7 ms |      2.6 ms |

The mobile caching algorithm, exercised in Node with Oniguruma rather than the device's native
engine, took 244.9 ms for its first thread-sync file tokenization and 0.003 ms median for a retained
result. This demonstrates skipped tokenization, not native iPhone latency or end-to-end screen
speed. No native-device speed, battery or memory reduction has been measured.

Desktop/web now use Highlights with a VS Code-to-Zed mapper. Native mobile retains its Shiki bridge
and bounded token cache; it has not migrated to Pierre. WASM did not improve Shiki warm throughput
in this run.

## What T3 does with themes

T3 separates application palettes from syntax highlighting:

- The app palette has semantic roles, independent light/dark choices, system following, visual
  previews, editable/custom palettes and a persisted theme library. VS Code imports derive
  application colors from the file's UI `colors`.
- Shared palette definitions feed web CSS and generated mobile theme variables. Native colors cross
  the boundary as sRGB. Contrast correction adjusts colors, including accent lightness/chroma, for
  readable controls.
- Web code/diffs resolve to `pierre-light` / `pierre-dark`; mobile native token styles are generated
  from those same fixed syntax palettes. These do not reproduce arbitrary imported TextMate syntax
  rules.

Pinned sources:
[web theme state](https://github.com/pingdotgg/t3code/blob/d0b9e9d3c72b/apps/web/src/hooks/useTheme.ts),
[palette/import support](https://github.com/pingdotgg/t3code/blob/d0b9e9d3c72b/apps/web/src/themePalette.ts),
[VS Code UI palette conversion](https://github.com/pingdotgg/t3code/blob/d0b9e9d3c72b/apps/web/src/vscodeThemeImport.ts),
[diff themes](https://github.com/pingdotgg/t3code/blob/d0b9e9d3c72b/apps/web/src/lib/diffRendering.ts),
[mobile themes](https://github.com/pingdotgg/t3code/blob/d0b9e9d3c72b/apps/mobile/src/lib/mobileTheme.ts).

Pierre Highlights itself supports custom Zed-format themes, including token colors, italic and bold,
so fixed Pierre palettes are not mandatory. Dovo can register its own Zed themes. A TextMate import
is a different problem: contextual selectors, grammar scopes and some styles cannot be reproduced
exactly with Highlights' token taxonomy. Translation must disclose those differences or retain Shiki
for exact imports. `@pierre/diffs` 1.6.1 allows only one active backend, so such a fallback requires
coordinated disposal/reinitialization while preserving editor state. Dovo now uses the mapper
consistently on desktop/web, rather than switching backends for imports. Stored imported definitions
remain intact; no preferences migration is required.

## Deeper CPU measurements

`pnpm benchmark:thread-hotpaths --baseline-ref 97e0b90dc4413594c91cb546d9a943b6a75cd7f6` compares
the production functions against the pre-review commit. The benchmark asserts equal page membership
and sort order, uses isolated module caches for each version, and measures medians. It excludes
transport, SQLite, projection construction and rendering. Streaming measurements warm unchanged task
digests, but use a distinct workspace/task update for each measured sample.

One run on Linux, Node 26.8.1:

| Workload                                                 |    Before |    After |
| -------------------------------------------------------- | --------: | -------: |
| Select 25 of 10,000 settled summaries                    |   6.19 ms |  0.74 ms |
| Sort 10,000 summaries by latest prompt                   |   8.96 ms |  6.12 ms |
| Sort 10,000 summaries by title                           |  27.95 ms |  1.82 ms |
| Sort 10,000 summaries by project                         | 245.79 ms |  9.11 ms |
| Hash a streaming update with 250 retained thread windows |   4.08 ms | 0.033 ms |

Sorting reuses an ICU collator and evaluates prompt ties only when needed. Paging keeps a bounded
heap instead of sorting the entire eligible list, retaining protected rows and original workspace
ordering. Snapshot hashing reuses SHA-256 task digests by immutable identity; task contents, task
order, workspace metadata and per-device state still invalidate the tag. The first snapshot must
still hash all content. A separate cold-cache pass measured 3.14 ms before and 2.82 ms after for the
same 250-window fixture. Tags are opaque; an older cached tag causes a normal fresh snapshot.

Review also confirmed that disk writes are already coalesced by the desktop/mobile providers; this
pass does not add a second write scheduler. Selected-thread loading still depends on the runtime
connection and network round trip. No comparable T3/Dovo end-to-end device measurement, NetBird
latency improvement, battery saving or native Pierre speedup has been established.

## Further PR integration review

T3's recent PR work emphasizes verified shell-created PR links
([#24813](https://github.com/pingdotgg/t3code/pull/24813)), fresh merge/close handling
([#24830](https://github.com/pingdotgg/t3code/pull/24830)), and avoiding repeated date parsing when
choosing linked PRs ([#22891](https://github.com/pingdotgg/t3code/pull/22891)). Dovo already
compares ISO timestamps when sorting PR summaries and verifies mentioned URLs against the configured
repository/forge. Branch matches reject ambiguous and foreign-fork heads; automatic settlement
requires fresh closure confirmation and respects queued work and drafts.

This pass improves two adjacent hot paths:

- Desktop and mobile stop polling a successfully loaded, warning-free Changes section once both head
  and base hashes match the requested revision. Overview/status/checks continue polling; pushes
  select a new revision. Explicit refresh, reconnection, and scope/tab changes revalidate. Cached
  hydration alone never suppresses a network read; stale, failed, incomplete or unpinned responses
  continue polling. This avoids repeating the same diff transfer every ten seconds.
- Reverse links inspect associations directly, without enriching status metadata or parsing each URL
  again during streaming. Weak caches follow immutable association objects/arrays, release deleted
  threads, and invalidate naturally when associations are replaced. The benchmark checks equal
  results. A 10,000-thread fixture with five links per thread measured **20.425 ms before versus
  0.630 ms after** (warm median, Linux Node 26.8.1). Cold first reads still parse the links.

Browser checks exercise real desktop/mobile hooks: advancing the clock leaves diff-read counts
unchanged while overview reads continue; explicit refresh and a new head reload changes. Mobile
presentation/transport are mocked; these are not native-device measurements.

Dovo now also adopts T3's command-driven PR handling. Successful, deduplicated shell-tool
completions from the existing provider normalizer trigger refreshes. `gh pr create` and
`glab mr create` output can link a PR before it is mentioned in chat; candidate URLs must appear
alone on a line, match the create CLI, and pass the configured project's forge lookup. Quoted
examples, heredoc bodies, list/API output and ambiguous extra URLs are rejected. Explicit unlinks
and disabled smart linking are preserved.

`gh pr merge/close`, `gh stack merge` and `glab mr merge/close` trigger fresh scoped lookups;
merge/close commands are checked again after the run releases its lock, covering `--auto`.
Previously unlinked PRs are verified before attachment. Numeric targets must already be linked or
match the checkout branch. An explicit URL can establish a branchless association, which continues
through ordinary polling and watcher restarts. Commands cannot settle an auxiliary PR instead of a
known source/branch PR, bypass settlement preferences or discard protected work. The two-minute poll
remains the fallback for later external changes and unsupported shell forms. No new automatic PR
watch or merge policy is introduced.

## Follow-up: idle PR tabs and repeated code blocks

- Closed PR sections on desktop and mobile retain their loaded state but defer cache hydration and
  polling-worker creation until enabled. Opening a tab still reads its saved section and revalidates
  online; overview, status and other enabled sections keep refreshing. Browser checks assert that
  unused Changes/Checks sections perform no cache reads, then load when selected.
- Review fingerprints depend on file contents and head/base hashes, rather than the whole merged PR
  object. Status/check updates no longer recompute SHA-256 for every unchanged patch. Browser checks
  count the actual production fingerprint calls; metadata-only updates skip hashing while a new
  commit still invalidates the mobile fingerprints. Existing review/draft/120-file checks remain.
- Chat shares a Pierre plugin per light/dark theme-object pair, with a least-recently-used token
  cache limited to 20 blocks and an estimated 1 MiB per pair. Growing streaming prefixes obey both
  limits; oversized blocks render without retention. Weak theme keys allow removed imports to be
  collected, and edited imports with the same name cannot reuse the old colors. This cache applies
  to desktop/web chat; it does not migrate the native highlighter.

Run `pnpm benchmark:chat-highlighting --baseline-ref d4cac399` to compare the production adapters.
One warm Node 26.8.1 run on a 3,076-character TypeScript file measured median repeated highlighting
at **0.110 ms before / 0.002 ms after**, and remounted-message highlighting at **0.110 / 0.002 ms**.
Unique blocks measured **0.115 / 0.124 ms**: cache misses incur bookkeeping overhead. The benchmark
checks exact source reconstruction and uses 60 samples per workload. These are adapter CPU times,
excluding React, network, cold initialization and native-device performance; they are not measured
thread-opening gains. The memory budget is an estimate of retained source/tokens, not a heap cap.

## Usage hubs and pooled availability

Reference: T3 main `aa247c52a01de58c69e6944268125ffdfe76318f`, particularly
`apps/server/src/usage/cliproxyApi.ts`, `packages/shared/src/usageLimits.ts` and the web usage
views. Dovo now follows the same useful shape: server-side CLIProxyAPI queries, bounded concurrency,
automatic cooldown, pooled account segments and per-account details. Management is available in
Studio on desktop/web and native mobile. Local runtime access remains account-free and paired.

Dovo preserves account identity across computers and verified hub Codex accounts; unknown
organisation identities remain separate. Overall weekly exhaustion gates session availability, while
model-scoped windows stay independent. The UI explicitly avoids claiming that equally sized account
segments measure combined capacity across differing plans. Offline/stale/expired/failed-source
observations remain unavailable until verified again. External reset-credit redemption and routing
through hubs are not part of this implementation. Native highlighting remains a separate gap from
T3's native Pierre backend; this usage work does not change it.

Usage performance changes:

- Costs/Tokens no longer launch provider processes or hub requests. Limits no longer scans CLI
  transcripts, downloads history or refreshes prices. Browser checks count endpoint calls on both
  desktop and native-adapted screens.
- A session-only SQL projection replaces a redundant full history decode for CLI exclusion. Both
  scans yield every 256 rows, keeping streaming work schedulable.
- Local provider configuration deduplication uses keyed maps rather than repeated array searches.
- Hub reads run at most two hubs/four accounts per hub concurrently per runtime, coalesce pending
  requests and cache automatic failures too. Credentials never enter workspace or client caches.

Run `node scripts/benchmark-usage-history.mjs` after building runtime dependencies. One warm Node
26.8.1 in-memory run over 20,000 synthetic records measured median full decoding at **122.60 ms**
versus **46.64 ms** for identity projection (**62.0% lower scan time**), returning the same 2,500
owned session IDs. It uses a warm-up plus nine samples per path and asserts identical identity sets.
This measures the ownership scan, not complete dashboard/network latency or physical-device speed.

## Independent usage refresh and indexed PR review

Local provider and external hub reads now publish independently on desktop and mobile. Partial hub
failures retain the affected account's last verified windows and timestamps without hiding healthy
siblings. Known accounts that have never reported a window appear as unknown segments; unsupported
accounts do not inflate the pool. Failed observations never count as available.

PR and thread review viewers build a memoized path/fingerprint lookup instead of searching the full
review progress array for each file. Inline PR comments are indexed by current and previous paths
once, preserving timeline order and rename handling. Revision evidence and fingerprint serialization
are memoized so draft edits and unrelated renders do not repeat them.

Run `node scripts/benchmark-review-lookups.mjs` (default baseline `4cd3f3b5`). A warm Node run with
2,000 files and 10,000 comments measured median review-state bookkeeping at **13.464 ms before /
1.083 ms after**, and renamed-comment grouping at **58.728 / 1.126 ms**. Index construction is
included in each sample. The script checks identical results and comment order, warms both
implementations, and takes 11 samples. These are isolated CPU measurements, not total PR-opening or
device speed. The 120-file browser stability check additionally verifies drafts, viewed marks, focus
and selection.

## Redesign and native tool discovery (2026-10-27)

Five GPT-6.1 Terra reviewers compared the current sources, pinned to T3
[`dc84b0962efa4f4e05ef392c08986a9cd7c994d1`](https://github.com/pingdotgg/t3code/tree/dc84b0962efa4f4e05ef392c08986a9cd7c994d1).
The redesign was also inspected in its published screenshots. This is a source and interface
comparison, not a performance measurement or an endorsement of the redesign PR's model scores.

Applied in Studio:

- Selected and unread thread titles lead the sidebar on desktop and mobile. Desktop read titles
  brighten on hover or keyboard focus. Metadata stays secondary even for unread threads; PR numbers
  are neutral while their state icons keep their semantic colors. Done and yellow Needs input
  indicators remain visible, including compact rows.
- Task/message search has visible scope buttons that preserve the query. Tab and Shift+Tab move
  keyboard focus normally instead of switching search modes. Existing task and conversation commands
  and shortcuts remain available.
- Claude's native `ToolSearch` is available in read-only coding sessions and classified as a read
  operation. Every discovered tool still passes its own permission and ownership checks; similarly
  named MCP tools receive no special permission. Text-only utilities still disable tools.
- Tool-search activity shows the query and discovered `tool_reference` names on desktop/mobile and
  in native child transcripts. Standard, server-side and MCP call/result blocks retain their
  identity through activity grouping, result errors and lifecycle hooks. Image payloads are not
  converted to text. Detailed output continues to respect the existing display preference.
- An unfinished tool on a failed turn is Interrupted, matching mobile, rather than incorrectly
  claiming the tool itself failed. Explicit failures remain Failed; interrupted work remains visible
  even when routine activity is hidden.

T3's [redesign](https://github.com/pingdotgg/t3code/pull/24865),
[tool activity](https://github.com/pingdotgg/t3code/pull/15506),
[Pi discovery](https://github.com/pingdotgg/t3code/pull/17220) and
[Claude tool-search settings](https://github.com/pingdotgg/t3code/pull/24654) informed this pass.
Dovo already has cross-computer indexed conversation search and command-palette entries for both
search modes; those were preserved rather than reimplemented.

Tool discovery stays provider-native. The installed Claude SDK supports it already; its configured
`ENABLE_TOOL_SEARCH` values and user/project/local settings remain intact. Providers without native
discovery keep their existing MCP catalogs. No dynamic tools/list gateway, eager-loading metadata,
Pi integration or forced search override was added. T3's schema-size/cache measurements do not
establish savings for Dovo.

A second round with five Terra 6.1 reviewers addressed surrounding correctness gaps:

- MCP connection tests follow every tools/list cursor within the original timeout and reject
  repeated cursors. HTTP headers resolve inline, environment and bearer precedence
  case-insensitively before a transport can combine differently cased credentials.
- Claude's server-side `tool_search_tool_search_result` object exposes its tool references in the
  shared details and saved native transcripts. The pre-execution hook enforces read-only decisions
  even when inherited settings preallow a tool and skip `canUseTool`.
- Global results from different computers are merged by thread activity before truncation, with an
  explicit 50-match limit. In-thread search offers older 50-match pages without loading entire
  histories, and external message reveals take precedence over an existing in-thread match.
- Native Codex delegation is explicitly enabled on verified 0.164.0+ coding sessions and disabled in
  text-only utilities. Copilot child invocations now normalize into the shared subagent rows.
- Same-window form POSTs retain their body/profile. Only page-initiated GET requests route to
  another profile, retaining the original opener without an error document. External-link routing
  failures fall back to the chooser and do not block later links.

The read-only hook is exercised through SDK option fixtures, not a live authenticated Claude run.
Copilot lifecycle tests use the installed SDK with a local JSON-RPC provider fixture; they do not
claim live provider delegation. Native Electron checks exercise real form POST and GET navigation.

Verification covers the shared presentation, read-only permission decisions, server-side lifecycle
and transcript extraction, plus actual desktop controls and native-adapted mobile rows. The browser
adapter does not verify native mobile rendering, and this pass does not establish live Claude API
billing/cache savings or end-to-end tool discovery against a signed-in provider.

## Prompt-first thread start (2026-10-27)

Reviewed T3's mobile app at `5808469018fb95676af148e7a7662c23665c67a3`, especially
[NewTaskDraftScreen](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/threads/NewTaskDraftScreen.tsx)
and
[ThreadScreenHost](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/threads/ThreadScreenHost.tsx).
Its useful patterns are a project-aware welcome, nearby project/environment controls and a mounted
composer that survives the first send.

Dovo adapts these to its existing desktop and native mobile shells: desktop centers the welcome and
composer; mobile keeps the composer at the bottom, places context controls beside it and scrolls the
welcome above it. Four shared starter prompts fill and focus a draft without sending. Typing, saving
and choosing a starter preserve the existing draft and computer ownership. Saved empty drafts keep
the welcome; messages, history and activity errors still use the conversation. No new dependencies
or alternative draft store were introduced.

Browser coverage exercises the production desktop shell, first-send and remote-draft lifecycle, and
native-adapted mobile starter actions, input identity and narrow/short viewport geometry. The mobile
adapter does not establish native iOS/Android rendering or software-keyboard behavior.

## Additional feature review (five Terra 6.1 reviewers, 2026-10-27)

The review covered desktop, the actual native mobile app, agent interactions, Git/review workflows
and continuity. These are recommendations, not additional shipped features. The best next slice is
mobile swipe Undo, followed by mobile terminal modifiers: both solve clear problems without
introducing another workflow or state store.

| Opportunity                                  | Dovo today and smallest useful next step                                                                                                                                                                                                                                                                                    | Scope                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Undo mobile settle/snooze                    | [Swipe actions](../apps/mobile/src/tasks/list/task-list-row.tsx) move threads immediately. Offer a temporary, accessible Undo after success; retain the original computer/thread and prior state, and invalidate after conflicting changes. Exclude deletion.                                                               | Small; state races and native testing matter.                                      |
| Mobile terminal Ctrl/Alt                     | [Terminal keys](../apps/mobile/terminal/client.ts) provide Ctrl-C and fixed keys. Add visible, one-shot Ctrl/Alt modifiers, consumed by the next supported input and cleared on disconnect. Preserve IME handling and never replay input after reconnect.                                                                   | Small; verify on native keyboards.                                                 |
| Add another thread as context                | Existing copy/fork actions require a different workflow. Add an explicit same-computer thread picker that attaches a labeled transcript snapshot to the draft, with removal, complete-history loading, limits and errors. Preserve drafts on failure.                                                                       | Medium; history size and attachment lifetime.                                      |
| Add terminal selection to a draft            | [Desktop terminal sessions](../packages/extension-tasks/src/terminal/terminal-session.tsx) expose input/socket handling, but no composer handoff. Add an explicit selection action that inserts editable text into the correct draft without sending.                                                                       | Small desktop slice; bound selection size.                                         |
| Stash an unsent prompt                       | [Draft persistence](../packages/extension-tasks/src/chat/composer/use-composer-draft.ts) retains one draft per thread. Add stash/list/restore/delete only with explicit nonempty-draft handling and attachment retention; keep ownership scoped to the computer. Saved project prompts already serve reusable instructions. | Medium; avoid replacing drafts or losing attachments.                              |
| Recover notification taps through cold start | [Notification handling](../apps/mobile/src/notifications/provider.tsx) stores a not-yet-ready destination in memory and clears the OS response immediately. Defer clearing until navigation handoff; test termination, delayed readiness, duplicate responses and answer actions.                                           | Small correctness improvement; source-level risk, not a reproduced device failure. |
| Quiet notifications for the visible thread   | The same provider shows foreground input banners and sounds regardless of the visible conversation. Suppress only when both computer and thread match and the question is actually accessible; retain test and background notifications.                                                                                    | Small product decision; avoid hiding unseen questions.                             |
| Mobile hardware-keyboard shortcuts           | Reuse [native navigation](../apps/mobile/src/ui/layout/navigation-stack.tsx) for discoverable Search, New thread and Back shortcuts. Respect text editing, modals and platform shortcuts before adding numbered thread jumps.                                                                                               | Medium; mainly benefits tablets/external keyboards.                                |

T3 evidence at `5808469018fb95676af148e7a7662c23665c67a3`:

- [Mobile Undo](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/home/useThreadListActions.ts)
  and
  [Undo notice](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/home/ThreadUndoNotice.tsx).
- [Mobile terminal modifiers](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx).
- [Composer stash and thread/terminal context](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/web/src/components/chat/ChatComposer.tsx).
- [Notification response consumption](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/agent-awareness/notificationResponseConsumer.ts)
  and
  [foreground behavior](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/agent-awareness/foregroundNotificationBehavior.ts).
- [Mobile hardware-keyboard commands](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/mobile/src/features/keyboard/HardwareKeyboardCommandProvider.tsx).

Reading-position restoration is a probable further gap: T3 remembers a message/offset in
[useTimelinePositionRestore](https://github.com/pingdotgg/t3code/blob/5808469018fb95676af148e7a7662c23665c67a3/apps/web/src/components/chat/useTimelinePositionRestore.ts),
while Dovo retains history pages but normally follows the live end. Reproduce navigation and mount
behavior before changing it; explicit search/reveal and live following must take precedence. A
narrative PR tour is another presentation option, but Dovo already has AI review organization,
revision-aware diffs and review comments; it is not a missing review capability.

Dovo already covers indexed cross-computer search, paged history/search, bookmarks, queue/steer,
forks, native tool discovery/delegation, cached offline conversations, reconnect backoff, worktree
preparation/retry and PR linking/review/merge. No additional speed benefit was measured here.

Raw GitHub retrieval was unavailable during the review. The cited cached T3 files were checked
against Git blob hashes in the downloaded tree for the pinned SHA, including files read from the
older local checkout. This confirms source identity, not runtime behavior. Native iOS/Android
rendering, keyboard handling and notification delivery were not tested in this review.

## Feature implementation follow-through (2026-10-27)

The next implementation pass keeps the existing prompt-first start and adds:

- Device-local text draft stashes on desktop and mobile, scoped to the owning computer and thread.
  Restoring appends to current text and retains the saved copy. Stashing/restoring is unavailable
  while attachments are present; attachment retention is deliberately outside this text-only flow.
  Storage failure and newer typing never clear the current draft.
- Explicit same-computer thread context attachments. The picker fetches complete,
  revision-consistent history rather than copying the sidebar projection, enforces the existing 5 MB
  attachment limit, and leaves the snapshot removable through normal attachment controls. It never
  sends a message.
- Desktop terminal selection handoff into the existing draft insertion path, with a bounded
  selection and editable text. Mobile terminals add one-shot Ctrl/Alt controls, preserving paste and
  IME input and clearing modifiers when transport disconnects.
- Mobile notification taps retained until runtime/navigation readiness. Foreground input alerts are
  quiet only for the exact accessible input, with conservative behavior when visibility is
  uncertain.
- Native iOS hardware keyboard commands for New thread, Back and focused Tasks search, yielding to
  text editors, web views and presented modals. Android does not advertise these commands.
- Temporary mobile Undo after Settle or Snooze. Restoration belongs to the original computer and
  validates the whole thread family's expected lifecycle state before applying any change.

These are workflow improvements, not measured speed improvements. Native iOS compilation,
external-keyboard behavior and real notification delivery require a native build/device check; DOM
adapters do not verify those platform behaviors. Reading-position restoration and additional PR-tour
presentation remain follow-ups rather than implied shipped features.

## Further feature review (five Terra 6.1 reviewers, 2026-10-27)

A separate read-only round excluded the shipped features and implementation pass above. These are
source-confirmed differences or risks, not device/browser reproductions:

| Priority           | Finding                               | Smallest useful follow-up and verification                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First              | Worktree handoff recovery             | `packages/runtime/src/scm/tasks/task-handoff.ts` removes the old worktree before checkout in the project folder. Force the later checkout to fail, then verify rollback restores the checkout or gives explicit recovery instructions while preserving branch, stash and all changes. Metadata must not point at a missing checkout.                                                |
| First to reproduce | Claude background session ownership   | `packages/runtime/src/agents/execution/subagents.ts` scopes insertion by session but roster reconciliation/previous-record lookup can consider another session. Add two-session reducer cases and a real session-replacement/late-event case before claiming a live provider failure.                                                                                               |
| Next               | Reuse a sent prompt                   | Add a text-only **Use in composer** action on desktop and mobile using existing insertion paths. Append without overwriting the current draft or attachments and never send or mutate history. This is separate from destructive timeline rewind, which needs provider/file rollback guarantees.                                                                                    |
| Next               | Restore conversation reading position | Desktop remounts start at the live end, while mobile visibility explicitly follows latest. Start with bounded desktop message anchors per existing computer/credential/thread scope. Explicit search/bookmark reveals and user scrolling must win; missing anchors should fall back to latest without repeated fetching. Mobile requires its own inverted-list/native verification. |
| Later              | Offline attachment drafting on mobile | Persist selected files locally per computer/thread, then upload to the original owner after reconnect. Preserve failed uploads and provide retry/remove/cleanup. Removing the current online guard alone would lose files across restart. Native picker/relaunch tests are required.                                                                                                |

T3 evidence is pinned to `5808469018fb95676af148e7a7662c23665c67a3`: `BranchToolbar.logic.ts`,
`useThreadLifecycle.tsx`, `useTimelineRewind.ts`, `chatViewSend.ts`, `composerImages.ts`,
`use-composer-drafts.ts`, `composerAttachmentUploadQueue.ts`, `MessagesTimeline.tsx`,
`useTimelinePositionRestore.ts`, `timelineScrollAnchoring.ts`, and the Claude background
interruption fixture were checked against downloaded tree blob IDs. Cached files whose blobs
differed were not used as evidence. The pin is not a claim about the latest upstream commit.

A shared-project branch-drift warning is a further candidate, but older main-mode threads do not
necessarily record a branch baseline. Detecting a mismatch must not silently switch a shared dirty
checkout or interfere with other threads; investigate baseline semantics before implementing it.

## Current-source follow-up review (five Terra 6.1 reviewers, 2026-10-27)

This round uses a fresh source archive pinned to T3
[`5e9d56416f6b395095c772c597e79cd5f94e3052`](https://github.com/pingdotgg/t3code/commit/5e9d56416f6b395095c772c597e79cd5f94e3052),
including its newer machine mentions and linked-environment controls. These are recommendations, not
additional implemented features. The review excludes the implementation above and the earlier
follow-ups, and checks Dovo's existing capabilities before calling something missing.

The recommended first shared workflow improvement is PR-template-aware description generation: it
can improve both apps through the existing runtime endpoint without adding another UI flow.

| Priority               | Opportunity                                 | Dovo behavior and smallest useful adaptation                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Small desktop change   | Command-palette aliases                     | [Commands](../packages/studio-shell/src/command-palette.tsx) match only a contiguous title substring. Add deliberate optional search aliases, with title matches ranked ahead of aliases; keep existing commands, focus and keyboard execution. This helps queries such as “new task” find New thread.                                                                                                               |
| First mobile follow-up | Open PDF attachments                        | [Attachment previews](../apps/mobile/src/tasks/conversation/components/message-attachments.tsx) treat non-images as UTF-8 text. Add an explicit PDF viewer action using the existing authenticated read, with Share/error fallback and temporary-file cleanup. Verify real iOS and Android behavior before shipping.                                                                                                 |
| Next                   | Keyboard access to queued messages          | Dovo already has edit and steer buttons in [message queues](../packages/extension-tasks/src/chat/thread/message-queue.tsx). Reuse those guarded actions for discoverable desktop shortcuts, preserving drafts and attachments and yielding to terminals, composition, repeats and disconnected or pending states.                                                                                                    |
| Next                   | Mention a computer in the composer          | Extend the existing [mention menu](../packages/extension-tasks/src/chat/composer/file-mentions.tsx) with paired computer references. Include a stable validated identity as request context, without changing thread ownership or granting access. Account for duplicate names, offline computers and disabled Studio Tools.                                                                                         |
| Later                  | Implement a selected plan in a fresh thread | The existing [plan action](../packages/extension-tasks/src/chat/thread/plan-approval.tsx) continues in the same thread with a generic prompt. A fresh-thread action should transfer inspectable, selected plan text and preserve the original computer/project. The current heuristic for detecting plans is insufficient for automatic handoff; creation failures and checkout ownership require explicit handling. |

The Git/review reviewer also identified three useful shared workflow additions:

- **PR-template-aware descriptions:**
  [Generation](../packages/runtime/src/agents/tasks/title-generation.ts) receives thread context,
  commits and diff, but no repository template. Read one unambiguous, bounded regular Git blob from
  the selected base revision and include it as generation context. Preserve editable results and
  newer user edits. Test missing, multiple, oversized and symlink templates, unresolved bases, and
  the original computer/account.
- **Workflows awaiting approval:** Dovo handles `ACTION_REQUIRED` checks when GitHub returns them,
  but does not separately read approval-required workflow runs. Add a read-only, head-bound PR
  detail section first, with GitHub links and explicit unavailable/error state. Verify real fork-PR
  behavior before treating the feed gap as a reproduced failure. Approving execution is a separate
  action.
- **Auto-merge and branch updates:** Retain reviewed-SHA protection for immediate merge. Add
  explicit enable/disable auto-merge controls and a separate expected-head branch-update action,
  with fresh permissions and queue capability checks. Distinguish armed/queued from merged; preserve
  the selected computer, repository and account on desktop and mobile.

T3 evidence for these differences:

- [PR template discovery](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/packages/source-control-github/src/server/gitHubChangeRequestTemplate.ts#L128)
  and
  [generation context](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/server/src/git/GitManager.ts#L2275).
- [Workflow approval reads](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/packages/source-control-github/src/server/GitHubPullRequestApi.ts#L1517)
  and
  [guarded PR mutations](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/packages/source-control-github/src/server/GitHubPullRequestApi.ts#L2531).
- [Command title and search-term scoring](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/components/CommandPalette.logic.ts#L508).
- Native
  [PDF preview](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/mobile/src/components/FilePreview.tsx#L15)
  and
  [Android renderer](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/mobile/src/components/PdfPreview.android.tsx#L7).
- [Queued-message shortcuts](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/components/chat/QueuedRunsControl.tsx#L166).
- [Machine mention suggestions](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/components/chat/useComposerMenuItems.ts#L106)
  and
  [persistent context identities](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/lib/composerContextRecords.ts#L178).
- [Fresh-thread plan handoff](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/components/chat/useProposedPlanSend.ts#L294).

Dovo already supports same-computer linked checkouts, adding projects to another computer, remote
Studio tools, queue controls and attachment sharing. Recreating those systems would add complexity
without filling these UX gaps. This round is source research; its recommendations have not been
runtime- or device-verified, and it establishes no performance improvement.

### Direct reviewer-thread follow-ups

Dominic continued the Git/review and mobile conversations after their initial reports. The parent
read those additional messages rather than relying only on the original completion notifications.
The additional source-based candidates are:

- **Batched GitHub reviews:** retain Dovo's immediate commenting, but optionally collect comments
  into one review submission. Preserve revision-bound positions, drafts on failure and edits made
  during submission. T3's `PullRequestCodeTab.tsx` and `GitHubPullRequestApi.ts` show this flow;
  Dovo's current posting boundary is `packages/extension-scm/src/pulls/detail/changes.tsx`.
- **GitHub viewed-file synchronization:** Dovo already records viewed progress locally with file
  fingerprints. Provider-backed state could carry that progress between GitHub and Studio, but needs
  an explicit source-of-truth decision, connection/account isolation and visible sync errors. Do not
  silently merge local marks into GitHub. Compare T3's `pullRequestReads.graphql` and
  `pullRequestMutations.graphql` with Dovo's `packages/runtime/src/scm/reviews/progress.ts`.
- **Accessible mobile setup recovery:** inspect whether the accessible progress-card container hides
  its nested failure text and Retry button from VoiceOver/TalkBack. Separate summary and action
  accessibility if reproduced. DOM checks cannot establish native accessibility behavior.
- **Useful setup failure output:** worktree setup currently constructs command failures from stderr.
  A bounded stdout tail could explain scripts that report failures only on stdout. Verify
  cancellation, truncation, sensitive-output boundaries and successful retry before changing it.

The deeper environment discussion calls for consistent scoped ownership across apps, runtime and
tools, rather than copying another environment system. Distinguish a client's saved profile ID, its
current paired connection, the server's persisted `runtimeId`, and the process-only
`runtimeInstanceId`. `packages/runtime/src/services.ts` already persists the server identity in the
database; an earlier reviewer reply incorrectly suggested the server ID itself was process-only. No
identity migration follows from that claim. Shared repository URLs are presentation identities, not
authorization to move a mutation to another computer or account. Reads and actions must retain their
computer, resource, verified forge account/destination and freshness constraints.

### Environment implementation direction

The follow-through adopts T3's explicit scope boundaries while keeping Dovo's existing paired
computer registry and persistent server identities. Shared client targets bind a saved computer to
the address and credential captured by an operation; scoped resource keys keep identical local IDs
on different computers distinct. Connection replacement verifies the authenticated server identity
before transferring saved edits. See [Runtime client](runtime-client.md#computer-and-resource-scope)
for the contract and identity distinctions.

Desktop and mobile consumers must resolve the saved owner rather than borrowing whichever computer
is currently selected. Cached data stays associated with the connection that read it; live workspace
state is overlaid only when the open connection matches. Runtime Studio tools additionally resolve
profile aliases and persistent server IDs to one computer, with explicit ambiguity handling.

This is ownership and recovery consolidation, not a new account requirement or a server mesh.
Repository grouping does not authorize cross-computer writes. The GitHub workflow additions above
remain separate recommendations; this work does not imply that auto-merge, batched reviews or
viewed-file sync have been implemented.

### PR and pipeline viewing: deeper implementation review

The next review focuses on viewing rather than recreating T3's environment model. The pinned
`5e9d56416f6b395095c772c597e79cd5f94e3052` source separates query identity, previous data, pending
state and failures:

- [Shared PR query families](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/packages/client-runtime/src/state/pullRequests.ts)
  key reads by environment and explicit PR reference, retaining prior data during refresh.
- [PR detail composition](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/components/pullRequest/usePullRequestDetail.ts)
  loads detail, activity and checks independently. Checks merge according to snapshot timestamps;
  their refresh runs separately from the detail request.
- [Checks refresh](https://github.com/pingdotgg/t3code/blob/5e9d56416f6b395095c772c597e79cd5f94e3052/apps/web/src/hooks/usePullRequestChecksRefresh.ts)
  uses an interval derived from check state and avoids starting another refresh while pending.

This source contains PR checks and workflow approvals; it does not establish a standalone pipeline
dashboard equivalent to Dovo's run, jobs and workflow graph views. The useful comparison is request
continuity, scoped identity and recovery behavior, not a claim that both products expose identical
pipeline interfaces.

Six reproduced failures are fixed in Dovo:

1. **Pending PR reads restarted on unrelated project updates.** Full source objects were rebuilt
   when any project's branch or metadata changed. The detail hook treated their new object identity
   as a new request target, abandoning an in-flight reply. Detail targets now remain stable when
   their computer, pairing, project binding, account, destination, availability and cache are
   unchanged. A real-hook browser regression delays the overview response and changes another
   project's branch four times: the old code issues five reads; the fix keeps the original read.
   Account and destination guard regressions also pass.
2. **Offline-storage failures blocked live pipeline sections.** Desktop and mobile jobs/graph hooks
   caught cache hydration or invalidation errors as if the live request had failed, preventing the
   initial network read. They now report cache failures independently and continue loading live
   data. Failed offline writes also leave successfully loaded jobs fresh. Browser regressions run
   both actual hooks with failing cache reads, removals and writes; existing attempt isolation,
   pagination and background-polling checks remain in place.
3. **Automatic refresh discarded older PR pipeline runs.** After loading another page, the next
   ten-second poll replaced the collection with page one. Refresh now reloads the opened page depth
   and publishes the combined result, retaining the previous collection if a request fails. The
   opened depth is stored with the offline collection. A managed-Chromium regression advances the
   clock, refreshes explicitly and remounts the viewer while checking that the older run remains.
4. **Hidden Checks kept polling an opened pipeline.** Its live repository reader overrode the
   visibility passed through the connection flag. The pipeline viewer now has an explicit active
   flag that pauses its overview, options, jobs, graph and identity-discovery requests without
   replacing its retained source assignment. The browser fixture now uses the actual repository
   source hook: previously it returned no sources, concealing this failure. The reproduced case made
   nine additional requests during 31 seconds hidden; the fix makes none and preserves the expanded
   job when returning.
5. **PR Load more was cancelled by unrelated project edits.** Collection workers now retain their
   targets across presentation-only updates while the rendered pages use current project metadata.
   Computer, pairing, repository binding, reader account, availability, destination and cache
   changes still replace the workers. A delayed second-page regression fails on the original hook
   and passes after the fix.
6. **A temporary identity lookup failure disabled PR Retry.** An online owning computer can now
   retry immediately instead of waiting for the separate 30-second discovery poll. Every attempt
   still verifies its pinned account before reading PR data; this does not authorize handoff to
   another account. The regression injects one verification outage and retries with the clock
   frozen, proving recovery without waiting for discovery's next tick.

These checks verify request counts and functional recovery, not live GitHub/GitLab latency or native
mobile rendering. Further source-review findings remain separate opportunities:

- Filter PR pipeline runs by commit on providers that support it, rather than scanning repository
  pages. Retaining a page depth does not retain a run that new repository traffic pushes beyond
  those pages. T3's GitHub PR workflow reads use `head_sha`.
- Coordinate the 30-second runtime fresh-cache window with the client polling schedule. A poll just
  outside the window receives a stale snapshot while its background refresh runs. Do not fix that by
  relabeling stale data as fresh or relaxing action safeguards across unverified providers.
- Evaluate credential-resolution overhead separately. The implicit GitHub CLI source currently
  refreshes its token on identity reads. Reusing its token cache could reduce process launches, but
  changes how quickly Studio detects an external CLI account switch. Account correctness must remain
  explicit; this review does not weaken verification to claim a latency improvement.

Adaptive polling and additional review workflows are not implied by these fixes.

## Thread servers, message origins and another source review

This round compares T3 at
[`3b22620a5cbbf1b6f6336d70e68696a14c36f382`](https://github.com/pingdotgg/t3code/commit/3b22620a5cbbf1b6f6336d70e68696a14c36f382)
with Dovo baseline `88267280`. Five additional Terra 6.1 reviewers inspected PR review, pipeline
reads, mobile workflows, agent lifecycle and thread UX. Their source findings below are separate
from the four implementations in this batch.

### Implemented from the preceding review

- **Thread servers:** the project information panel lists thread-owned agent/terminal TCP listeners.
  Confirmed loopback HTTP endpoints open in a browser on the owning computer; other TCP services
  have Stop without an HTTP Open action. Reads are on demand, coalesced, and paused with
  hidden/background UI. Stop revalidates thread, PID/start identity and listener, checks current
  authorization, sends SIGTERM to the listener process, and reports a server that remains running.
  It never kills the agent's or terminal's shared process group. Discovery uses Linux `/proc` or
  macOS `lsof`/`ps`; a snapshot capability hides it on older runtimes and unsupported systems,
  including Windows. Only processes launched with Studio's new provenance markers are attributable;
  existing unmarked processes are not adopted. HTTPS-only services retain their existing manual
  browser navigation.
- **Message origins:** runtime-authored metadata identifies automation, watched PR/pipeline,
  monitored thread and Studio-agent messages in queues and sent history. Known source links retain
  computer identity. User edits become user-authored; client workspace patches cannot inject
  trusted-looking non-user origins. Child results remain in their dedicated inbox. Desktop queue
  changes have a polite count/pause announcement and unsent row descriptions.
- **Mobile ZIPs:** authenticated thread-scoped endpoints list and read bounded archive entries. The
  mobile viewer supports folders, text/image previews, sharing and attaching an entry to the current
  draft. It reuses the runtime's existing parser, with no new dependency. Archive and expanded
  sizes, entry count, compression ratio, paths, entry types and checksums are checked; no entry path
  is extracted to disk. Native mobile device verification remains separate.
- **Shared Git configuration:** Studio-owned configuration writers serialize by canonical common Git
  directory, including linked worktrees and multiple service instances. Real concurrent writes
  failed 19 of 32 attempts before the fix; tracked worktree preparation failed 5 of 8 attempts.
  Independent repositories and readers stay concurrent. Submodule initialization is coordinated;
  cloning/updating is outside the configuration lock. External Git processes still use Git's own
  locking. No external lock deletion or blanket retries were added.

T3 references:
[server panel](https://github.com/pingdotgg/t3code/blob/3b22620a5cbbf1b6f6336d70e68696a14c36f382/apps/web/src/components/chat/ThreadServersPanel.tsx),
[queued origins](https://github.com/pingdotgg/t3code/blob/3b22620a5cbbf1b6f6336d70e68696a14c36f382/apps/web/src/components/chat/QueuedRunsControl.tsx),
[mobile archives](https://github.com/pingdotgg/t3code/blob/3b22620a5cbbf1b6f6336d70e68696a14c36f382/apps/mobile/src/features/files/ZipArchiveView.tsx),
[Git coordination](https://github.com/pingdotgg/t3code/blob/3b22620a5cbbf1b6f6336d70e68696a14c36f382/apps/server/src/vcs/GitVcsDriverCore.ts).

### New findings, not implementations

These were source-derived findings at this review's completion, without live reproduction or
measured performance improvements. The subsequent all-aspects section records the verified
mixed-revision, explicit file-refresh, clipboard and terminal changes; the remaining proposals stay
separate from those fixes.

| Priority                | Finding                                                           | Evidence and smallest useful follow-up                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness             | GitHub checks can combine different PR heads during a push        | `packages/runtime/src/scm/pulls/pulls.ts` reads the initial head, a live PR rollup and head-pinned check runs without final head verification. Bind all sections to the same head or reject a changed head. T3 checks head consistency in `packages/source-control-github/src/server/GitHubPullRequestApi.ts`. Reproduce a push between reads and verify account/head isolation. |
| Correctness             | Explicit mobile file refresh can reuse a 30-second cached listing | `apps/mobile/src/tasks/files/task-files.tsx` changes a client revision, but `packages/runtime/src/scm/repositories/project-files.ts` can return the same cached directory listing. Add an explicit fresh read with protection against older in-flight results. T3 refreshes reachable queries in `apps/mobile/src/features/files/useFileTreeEntries.ts`.                         |
| Correctness             | Mixed clipboard contents can suppress useful text                 | `packages/extension-tasks/src/chat/composer/composer.tsx` claims pastes containing files, including text accompanied by a synthetic RTF file. Compare T3's `apps/web/src/components/chat/composerAttachmentFiles.ts`; reproduce rich-text and image pastes, including disconnected upload, before changing clipboard behavior.                                                   |
| Review workflow         | Put conversations at their actual diff lines                      | Dovo's `packages/extension-scm/src/pulls/detail/changes.tsx` groups feedback after the file patch. T3's `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` anchors placeable conversations by side/line and keeps unplaced conversations separate. Preserve outdated status; do not present original lines as current lines.                                           |
| Review workflow         | Edit posted comments where the provider permits it                | Dovo exposes replies/resolution but not editing in `packages/extension-scm/src/pulls/list/actions.tsx`. T3 checks permissions and PR membership before edits. Add provider-specific actions with preserved drafts and pinned computer/account/PR identity.                                                                                                                       |
| Measured optimization   | Conditional GitHub checks revalidation                            | Dovo's checks refresh fetches rollup/check-run/annotation pages. T3's `packages/source-control-github/src/server/gitHubConditionalChecks.ts` supports credential-scoped conditional responses. Measure calls/latency and verify validators, pages, head/account switches and fallback before adopting.                                                                           |
| Larger mobile slice     | Directory-scoped browsing and bounded server-side search          | Dovo's mobile browser downloads a whole-checkout file list capped at 200,000 paths. T3's `useFileTreeEntries.ts` loads expanded directories and separately searches with visible truncation. Benchmark representative checkouts and native devices before replacing the existing flow.                                                                                           |
| Small terminal addition | Selection-aware terminal context menu                             | T3's `apps/web/src/components/ThreadTerminalDrawer.tsx` offers Copy, Paste, Select all and Jump to latest. Reuse Dovo's xterm instance and existing Add selection action; preserve clipboard errors, writable-connection checks and session-switch safety.                                                                                                                       |

## All-aspects follow-through and final audit

Two further rounds of five Terra 6.1 reviewers compared desktop/mobile product flows, native browser
integration, agents/tools, Git/PR/pipeline workflows, and delivery/runtime reliability. The
reference remains the source archive pinned above at `3b22620a`; this is not a claim about
subsequent upstream changes, an exhaustive security audit, or measured end-to-end performance.

### Correctness and workflow changes

- **PR revision consistency:** checks, complete detail, feedback and monitor reads verify the head
  again after live GitHub rollup/pinned checks reads. File results also verify the base. Changed or
  unverifiable revisions cannot publish a successful mixed-head result. Deterministic
  push-during-read tests cover all four paths. This adds a verification read; it is a correctness
  trade-off, not a claimed latency improvement.
- **Fresh mobile file refresh:** explicit Refresh bypasses the runtime's 30-second listing cache.
  Successful refreshes restore normal caching; failed attempts retain fresh-read intent. Newer reads
  cannot be replaced or invalidated by older replies. Runtime and browser regressions cover
  additions, deletions, reconnects and checkout changes.
- **Clipboard intent:** plain text accompanied by a synthetic RTF/non-image file remains a text
  paste. Image and file-only pastes still attach when permitted. A disconnected composer does not
  cancel the browser's text fallback. Browser regression coverage fails with the previous
  implementation.
- **Terminal actions:** the desktop/web xterm context menu offers Copy, Paste, Select all and Jump
  to latest, retaining Add selection. Clipboard failures are visible; Paste requires a writable
  session, and delayed reads cannot reach another session/computer. Native mobile's separate
  terminal is not changed by this menu.
- **Draft ownership:** runtime-origin queue submissions preserve recipient draft text, model
  settings and attachments even when their contents match. A user submission cannot consume settings
  from a different nonempty draft. Child follow-ups and stable retries have regression coverage.
- **Server endpoint ownership:** discovery retains socket bindings/family and probes only an owned
  loopback endpoint. LAN-only sockets remain visible/stoppable without an invented URL. Competing
  same-port bindings, including wildcard/reuse-port listeners, suppress ambiguous Open actions.
  Linux tests use real processes on different addresses and wildcard/specific bindings; macOS tests
  simulate lsof/ps output, including binding changes at a stable PID/port.
- **Bounded mobile preview recovery:** rich-file and remote browser WebViews recover once after
  renderer loss, then offer explicit Retry. Stale callbacks cannot revive another computer/file/tab;
  hidden/background viewers do not spin up ticket or grant loops. Browser adapters exercise native
  callback behavior; actual OS process termination remains a separate device check.
- **CI fixture repair:** supervised-web approval checks provide the conversation state that the
  mobile approval component now requires, avoiding an unintended import of native-only conversation
  code into its browser bundle. Real permission UI and approval handlers remain under test.
- **Concurrent file saves:** Studio-owned save operations serialize by canonical file path across
  service instances and symlink aliases. The pre-fix fixture accepted 22 of 24 competing saves
  against the same original contents. The updated comparison occurs inside the critical section;
  only one succeeds and later saves receive a conflict. External editors do not participate in this
  lock.

- **Attachment cancellation:** the existing Remove operation records task-scoped cancellation of an
  immutable upload ID before removing its draft reference. Upload checks that receipt before and at
  commit, so a late or lost response cannot resurrect a cancelled context attachment. Cleanup uses
  the original computer and reports failures; cancellation records expire with the existing pending
  attachment lifetime. Runtime and real-hook browser tests cover each side of the commit boundary.
- **Mobile history search:** an open query refreshes on committed input/history/turn changes, while
  retaining previous matches. Stream chunks alone do not restart search. Hidden/background screens
  pause reads, and late replies from another computer/credential scope are discarded. Arbitrary
  edits to an older message during a running turn have no distinct wire commit signal; that case is
  not claimed as an immediate-refresh guarantee.
- **Mobile release reruns:** allocation, pre-signing build admission and publication reject an older
  workflow run once a newer dispatch exists, including failed/cancelled runs that may have partially
  uploaded. The latest run can still resume. This prevents decreasing store build numbers without
  coupling mobile to desktop releases or introducing an allocation service. No store upload ran.
- **Bitbucket partial reviews:** if a confirmed comment succeeds but its separate review decision is
  unconfirmed, the structured result identifies the pending decision. Both clients retain the
  form/decision and clear only the posted body, so retry does not duplicate it. Comment failures and
  bodyless decision errors retain ordinary failure handling. Provider requests and client
  interactions are mocked; no live review was posted.
- **Bitbucket merge semantics:** the documented Cloud merge API has no expected-head precondition.
  Both confirmations now describe merging the current source branch and retain the preflight check;
  they do not promise atomic binding to the viewed SHA. Evidence:
  [Atlassian merge API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-pull-request-id-merge-post).
- **Checked draft moves:** destination admission compares transferable configuration as well as
  text, and source archival compares the captured source configuration again. Conflicts preserve
  both drafts. Persisted transfers require the checked-move capability on both runtimes; temporary
  thread computer selection keeps its existing path. Provider-bound next-message overrides must be
  cleared before moving, rather than silently dropped or translated to unrelated provider IDs.

### Review evidence and remaining scope

T3 cancellation handling in `packages/client-runtime/src/state/attachments.ts`, mobile WebView
recovery in `apps/mobile/src/features/threads/HtmlRenderWebView.tsx` and
`apps/mobile/src/features/browser/PreviewStreamWebView.tsx`, and explicit composer consumption in
`apps/web/src/components/chat/useComposerSend.ts` provided useful comparisons. The server binding
and concurrent file-save findings also came from tracing Dovo's own implementation; they are not
claims that T3 has equivalent functionality or eliminates every related race.

The native mobile gate currently builds/launches iOS only. An unsigned Android native build gate is
still a coverage improvement, separate from desktop Check and manual mobile publication. Device Hub
lists remote Android emulators, but this round has not built or installed the changed app there.
Line-anchored PR conversations, provider-permitted comment editing, conditional GitHub revalidation
and a directory-scoped mobile file browser remain feature/measurement work, not fixes shipped by
this batch. Broad source review is not evidence of live Bitbucket/store behavior or native device
recovery.

## Fresh-source all-aspects review

Five further Terra 6.1 reviewers compared product flows, browser/native integration, agents/tools,
SCM and runtime/delivery against T3
[`4fc9e5f2fc68b0cb691a088060cf849398db5b01`](https://github.com/pingdotgg/t3code/commit/4fc9e5f2fc68b0cb691a088060cf849398db5b01),
fetched on 2026-10-27. Reviewers checked Dovo's current implementation, including the preceding
fixes, rather than treating every T3 feature as missing. T3's standalone pipeline and local iOS
browser surfaces differ from Dovo's; comparisons below distinguish shared techniques from Dovo-only
correctness findings.

- **Command search aliases:** T3's `apps/web/src/components/CommandPalette.logic.ts` combines item
  titles with deliberate search terms. Dovo now accepts optional command aliases and reuses existing
  settings keywords before and after the settings view loads. Title matches precede alias-only
  matches, with declaration order retained inside each group. Familiar terms such as “new task” can
  find New thread without changing the command's title or action. The real-palette browser check
  covers ranking, duplicate hits, keyboard/mouse execution, composition, empty results and focus.
- **Commit-scoped PR pipelines:** T3's GitHub workflow lookup scopes reads to the PR head. Dovo's
  repository-wide scan could miss the PR build on a busy repository, even after retaining opened
  page depth. The optional full commit filter now reaches GitHub (`head_sha`) and GitLab (`sha`),
  with commit-specific runtime and mobile offline cache keys. Other forges retain their existing
  scan and exact client-side commit check. Desktop/mobile regressions cover unrelated traffic,
  commit changes, pagination and cache separation; this does not claim live-provider latency gains.
- **Expired child questions:** T3's newer
  `apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts` recovers eligible questions
  as message-answerable requests. Dovo deliberately cancels process-local question callbacks after a
  restart. Its parent inbox could nevertheless retain their answer instructions. Startup now removes
  expired local-child question notifications from inboxes, legacy queues and unaccepted attempts.
  Real completion results, remote-child questions and already accepted inputs remain.
  Database-reopen regressions fail before the fix and cover both acceptance states.

- **Coherent PR pagination:** Dovo's first-page refresh could discard a PR that moved into an
  already opened later page. Desktop and mobile now stage the entire opened page depth before
  publishing a replacement. Changed boundaries force fresh later pages; later-page errors retain the
  complete previous snapshot with an error. Hook-level browser regressions cover insertions,
  closures, moving boundaries, offline results and retry.
- **Bounded native iOS browser recovery:** Local WKWebView renderer recovery now permits one
  automatic reload per user-navigation budget. Hidden or background pages defer recovery; a second
  loss becomes an explicit failure, and manual navigation/reload resets the budget. Closed or
  replaced tabs ignore stale callbacks. The Mac Studio simulator passed 91 native harness checks,
  including 31 recovery checks; the original implementation fails the second-loss regression. These
  use actual WKWebViews with deterministic delegate invocation, not actual OS process termination or
  the full Expo app. This is a Dovo-native lifecycle fix informed by the review, not a claim that T3
  has the same local browser architecture.
- **Durable mobile queue restoration:** Restoring a queued message now stages a local recovery
  record before contacting its computer. The runtime atomically commits the queue change and an
  idempotency receipt; reconnecting or reopening the thread retries that same request. Local
  confirmation appends once while preserving newer typing, and binds recovery to the original
  computer connection. Pending restores offer retry and confirmed discard; older runtimes require an
  update before this operation. Storage, runtime-route and real-hook browser checks cover lost
  responses, restart, changed queue contents, credential changes and disk-write failure. This
  extends Dovo's existing durable-send approach rather than introducing T3's different draft model.

## Full-app follow-up review

Another five Terra 6.1 reviewers inspected desktop product flows, mobile, agents/tools, SCM and
browser/runtime reliability against the same pinned T3 `4fc9e5f2` source. They checked the preceding
implementation before reporting gaps. The SCM review found no additional bounded correctness issue;
it confirmed existing pagination, truncation warnings, revision guards and worktree ownership
checks. This is source inspection, not a live-provider certification.

The resulting implementation addresses these reproduced gaps:

- **Explicit command approval classification:** MCP App tool titles and arguments could collide with
  saved shell-command rules. Only trusted provider adapters can now classify command execution;
  unknown fields, additional grants, environment overrides and ambiguous command payloads remain
  interactive. Exact supported Claude/Codex/ACP commands retain saved rules. A real MCP bridge
  regression demonstrates the old bypass and checks explicit approval and denial.
- **Desktop draft reconciliation:** Sending text no longer blacklists that text for the composer's
  lifetime. Once a replacement is observed, an independent browser handoff can add the same text
  again. Local edit revisions also prevent side-question saves, sends and forks from clearing a
  newer edit, even when the user edited away and back to identical words. Tests retain failed-clear,
  pending typing and ordered-snapshot protections. T3's guarded draft consumption in
  `apps/web/src/components/chat/useComposerSend.ts` informed this comparison.
- **Mobile fork recovery:** A fork intent is saved before contacting the original computer. Lost
  responses, remounts and restarts reuse the same fork ID and payload; source attachments remain
  available until confirmation. Confirmation conditionally clears only the submitted text and files,
  preserving later insertions. Retry and confirmed discard are visible. Fork uses the source
  thread's configuration, so desktop/mobile explicitly block it while next-message overrides are
  selected. Storage and real-hook browser regressions cover delivery and cleanup failures.
- **Cross-window cache invalidation:** Forgetting a computer now invalidates delayed cache writes in
  other browser windows, including snapshots, indexes and decoded history. IndexedDB checks the
  captured host generation and credential digest inside the same transaction as each operation. A
  forgotten namespace stays closed until a committed connection addition authorizes it; stale
  registry acknowledgements cannot reactivate it. Two real pages exercise late writes, stale new
  handles, unaffected computers and legitimate re-pairing. This is a Dovo-specific race, not a claim
  that T3's different mobile cache architecture solves it.

The reported CI failures also had stale fixtures for MCP message origins, serialized Git writes,
revision-checked PR monitoring and mobile foreground hooks. Their updated assertions verify the new
behavior instead of removing those checks. Native Expo execution, live agent approvals and live
forge API behavior were not exercised by this follow-up; browser adapters do not establish native
mobile behavior. The larger feature proposals above remain separate from these fixes.

## Current-source review: file browsing, editing and larger diffs

Five Terra 6.1 reviewers compared navigation/product flows, mobile, agents/tools, PRs/pipelines, and
browser/runtime reliability with T3
[`c570c2cd5cdf433ea0e38914ba6d92f6df13715c`](https://github.com/pingdotgg/t3code/commit/c570c2cd5cdf433ea0e38914ba6d92f6df13715c),
fetched on 2026-10-28. They read the preceding changes first. This round deliberately distinguishes
T3 techniques from Dovo-specific correctness fixes; similar feature names alone are not evidence of
missing functionality.

- **Discover skills by purpose:** T3's `apps/web/src/providerSkillSearch.ts` includes descriptions.
  Dovo's shared desktop/mobile skill suggestions now match descriptions after name matches,
  retaining prefix, enabled-state and name ordering. Disabled skills still apply only to the
  selected message; MCP matching is unchanged. Mobile suggestions also display the description.
- **Fence mobile file suggestions:** Pending lookups and displayed results now belong to the current
  mention query, thread and computer connection. Dismissal, disconnect, replacement credentials and
  out-of-order replies cannot insert a stale file into a different draft. This is a Dovo race found
  during the comparison, not a claim about T3's transport model.
- **Report listing completeness:** T3's directory loading and truncated search reporting in
  `apps/mobile/src/features/files/useFileTreeEntries.ts` informed a smaller improvement to Dovo's
  existing hierarchical tree. Listings now distinguish complete, omitted and unknown results through
  runtime caches, protocol and desktop/mobile views. Exact file-count boundaries and empty deep
  folders do not automatically mean files were omitted. Probes for skipped subtrees remain bounded;
  unprovable completeness and older runtimes remain unknown. Git read failures remain errors.
- **Retain mobile share exports safely:** T3's `apps/mobile/src/lib/attachmentDownload.ts` retains
  successful exports because Android recipients may read after the chooser returns. Dovo now gives
  attachment/archive exports isolated unique directories, removes failed exports, and prunes old
  successful exports on later shares while excluding active ones. Chooser return does not establish
  whether the user shared or cancelled, so both retain the file conservatively. Native receiving-app
  timing remains unverified.
- **Keep PR discussion snapshots coherent:** A partial Forgejo/Gitea inline-comment fetch could
  append cached copies of comments already returned fresh. A failed comment section now uses its
  entire cached snapshot, including an empty snapshot, with the existing stale-data warning. Without
  a cache, partial fresh results remain visible with their warning. A subsequent complete read
  replaces the stale snapshot. Full-detail and section-cache tests exercise two provider reviews
  with one failing request; this is a Dovo cache fix, not a direct port of T3's activity fetch.
- **Make desktop file saves explicit:** The real Pierre editor invokes its completion callback when
  it unmounts, which previously made navigation save a dirty file implicitly. Navigation now retains
  an in-memory draft and its pending/error state; only explicit Save writes the file. Returning
  offers resume, retry or discard, with expected-content conflict checks and isolated
  computer/thread/checkout ownership. Editor cache identities reset after Cancel/Discard and across
  remounts. These drafts survive navigation in the current app window, not an app restart. This is a
  Dovo editor integration fix found during the comparison, not a port of T3's editing model.
- **Load larger thread diffs:** Deferred files previously showed two 64 KB prefixes even when the
  changed lines were beyond that prefix. Desktop and mobile now offer a full text diff on request,
  up to 8 MB per side, using the original checkpoint or working-checkout authorization. Expanded
  contents never enter workspace snapshots. Truncated responses from older runtimes never become a
  purported full diff. Failed loads can retry or return to compact previews; complex comparisons
  stop within a computation budget and retain readable contents. Binary/image/submodule previews
  retain their existing behavior. This implements Dominic's additional request for larger diffs.
- **Recover omitted PR patches:** On-demand GitHub and GitLab changes reads now try their
  authenticated raw-diff APIs when the file API omits a large patch. Recovery matches file/rename
  identity, checks complete hunk structure, and revalidates the PR head/base after the raw fetch,
  including failures. GitHub additionally checks recovered line counts against its file metadata.
  GitLab supplies no equivalent counts, so recovered patches retain an explicit
  potentially-incomplete warning. Existing response limits, binary handling and checkout/account
  routing remain in force. Provider regressions cover omissions, malformed/truncated patches, errors
  and moving revisions; desktop/mobile viewers exercise patches beyond 64 KB. Live forge responses
  were not tested.

Literal project-content search and a directory-scoped replacement for the file-list API remain
separate features. T3's command-palette content search is useful, but a complete Dovo implementation
needs explicit Git-ignore/plain-folder semantics, bounded work and the existing linked-checkout
permissions. This round retains the current path search rather than claiming content search exists.

## Quality follow-up: 2026-10-30

Reviewed Dovo at `3f60ea83` with the requested two Claude Opus 5.5 and three Terra 6.1 read-only
reviewers, followed by parent validation and implementation. Review scopes were runtime lifecycle,
forge/tools, desktop rendering, mobile, and connectivity/storage. T3's latest revision at inspection
was [`32ecd71726fe`](https://github.com/pingdotgg/t3code/commit/32ecd71726fe). Child GitHub access
was restricted; the parent retrieved the upstream patches and supplied local copies for comparison.
This was a bounded review across those areas, not an exhaustive audit of every module.

Implemented changes:

- **Keep undo and history consistent.** History persistence now shares the restoration rollback
  boundary for primary and linked checkouts. A failed write attempts to restore the preceding
  contents; a delayed duplicate undo cannot overwrite the successful operation's redo backup.
  Checkpoint changes or removal are rejected before admission and again before committing history.
  Recovery refs use distinct attempt IDs so a failed rollback's backup is not overwritten by a
  retry. These recovery refs remain retained in Git. The later recovery follow-up below adds durable
  intent and resumable recovery when rollback also fails; automatic ref pruning remains outside this
  change.
- **Admit SCM writes through checkout locks.** Explicit save, stage and commit defer their IO until
  checkout admission succeeds. The later recovery follow-up separates shared edits from exclusive
  checkout operations and also protects task-file and instruction saves. Editing during an active
  agent run remains available.
- **Unlink checkpoint symlinks safely.** Undo can remove a newly created external or dangling
  symlink by validating its parent rather than following its final target. External parents and
  `.git` paths remain forbidden. Redo restores the link without changing its target.
- **Clean staged SQLite files.** Backup and restore operations remove verification-created WAL/SHM
  sidecars after closing their handles. A later backup also removes abandoned owned partial files
  and sidecars under its operation lock. Unrelated files and live database sidecars are untouched.
- **Preserve newer mobile preferences.** Unknown top-level saved fields survive an older app's edits
  and reloads without entering its typed preference state. Known fields still validate
  independently; edits during hydration and serialized saves retain their existing semantics.
- **Reject ambiguous watch/delegation input.** MCP and runtime request boundaries reject unknown
  fields for pipeline watches, PR watches and child spawning. For example, `runId` cannot silently
  become a stop-all request, and `permissions` cannot silently become inherited access. Correct
  selector-free stop-all and inherited-access calls remain supported. Forged scope fields are
  rejected at MCP; runtime task/run authorization still applies independently.
- **Keep ordinary GitLab diffs coherent.** The final head/base check now runs for every successfully
  loaded diff, including ordinary files that need no raw-patch recovery. A push or changed base
  during loading yields a recoverable conflict instead of mixing file contents and commit hashes.
- **Expose restart admission failures.** Input accepted while a restart lease blocks execution
  remains queued with a paused state and an actionable error. Cancelling the restart and explicitly
  resuming delivers it once, rather than leaving an apparently active queue without a worker.

The undo, SCM, symlink and SQLite changes address G2, G3, G4 and D1 from the previous
[stability audit](stability-audit-2026-10-29.md). Its other findings remain separate.

Upstream comparison and follow-ups:

- T3's [strict organize-tool input](https://github.com/pingdotgg/t3code/commit/a773dc38ac75)
  supports the same boundary principle as the watch/delegation fix. Its
  [unknown settings preservation](https://github.com/pingdotgg/t3code/commit/08a463e29976) concerns
  project overrides; Dovo applies the analogous fix to phone preferences, a different schema.
- T3's [shared GitLab reads](https://github.com/pingdotgg/t3code/commit/2c119bd975de) coalesce reads
  and invalidate provider caches around writes. Dovo already has shared PR retrieval/cache owners.
  The revision check implemented here is a Dovo-specific correctness finding, not a port of that
  cache change. Adding a second provider cache without measurements would add invalidation work.
- T3's [Markdown block isolation](https://github.com/pingdotgg/t3code/commit/d8c926c39515) and
  [row subscriptions](https://github.com/pingdotgg/t3code/commit/3cbc98241d33) are useful comparison
  points. Dovo's Streamdown 2.7.1 already splits and memoizes streamed Markdown blocks. Dovo's
  `richMarkdown` preprocessing and timeline structure still deserve profiling with long responses
  containing links/directives. No measured render-speed improvement is claimed in this round.
- T3 [removed its worktree-add deadline](https://github.com/pingdotgg/t3code/commit/fa4e4677c0ec).
  Dovo still routes creation through the generic 30-second Git timeout. A complete improvement
  should carry shared cancellation through primary, linked and PR checkout preparation, drain hook
  descendants, and identify operation-owned partial registrations before cleanup. Removing the
  timeout alone would weaken bounded recovery. Pre-existing or externally replaced targets must
  never be deleted as failed-attempt cleanup.
- T3's [route pacing](https://github.com/pingdotgg/t3code/commit/65b0ab8c91c1) and
  [idle work reductions](https://github.com/pingdotgg/t3code/commit/dd148481531a) do not establish
  the same bottlenecks in Dovo. Its coalesced route probes, reconnect backoff and existing polling
  owners need measurements before adding another timing/cache layer.
- Runtime review also identified a source-level native-child shutdown failure path through
  `drainChildren` that can prevent parent finalization. This was not fault-injected in this pass.
  The next regression should reject provider stop and delay shutdown confirmation, then verify both
  recoverable parent state and continued checkout exclusion. Simply ignoring shutdown failures or
  releasing ownership when the native session is missing is not a safe fix. T3's new
  [force-stop path](https://github.com/pingdotgg/t3code/commit/6b1245cceda1) is useful direction: it
  distinguishes unresponsive providers, fences superseded runs, and checks shared-session users
  before process teardown. Dovo needs those ownership and recovery guarantees before adding an
  equivalent action.

Verification: the full monorepo run passed **5,976 tests in 707 suites**, with 12 tests and four
suites skipped. All **32 builds** and **28 typecheck tasks** passed. Workspace checks passed with
zero errors and the ten existing warnings; explicit checks of all touched source/test files had zero
warnings, lint errors or type errors. The actual Pierre editor navigation/save-retention browser
check passed using Playwright-managed Chromium. The diff passed whitespace validation.

HTTP LAN/VPN connections, optional HTTPS, pairing codes and device tokens remain supported. No
dependency, account requirement, deployment or publication change is part of this pass. Native
devices and live forge mutations were not exercised.

## Deeper fault-injection follow-up: 2026-10-30

A second round used two Opus and three Terra reviewers across native execution, SCM,
persistence/security, browser/rendering and mobile mutations. The parent reproduced failures,
implemented changes and challenged the resulting diff. The upstream comparison remains pinned to
`32ecd71726fe`; the findings below concern Dovo's own implementation.

Implemented and regression-covered:

- **Recover native shutdown ownership.** Rejected or absent native Stop controls previously left the
  parent owned even after an authoritative session-close event. Native drain failures now use the
  typed error channel, retain checkout exclusion and pause the queue, with a confirmation callback
  releasing ownership only after matching native records become terminal. The timeout includes the
  Stop RPC itself. Checkout ownership survives loss of the control-session handle; unknown native
  directories conservatively exclude checkout mutation. Sibling Stop attempts and native provider
  shutdown still execute when credential-file cleanup or state persistence fails. Regressions
  exercise rejection, missing controls, a hanging RPC, failed persistence and late closure. A
  further executed integration probe showed that a new parent turn could bypass an old child's
  unconfirmed shutdown through the same-family admission exemption. Admission now keeps that child
  exclusive even within its family; a regression rejects parent restart before positive confirmation
  and admits it afterward. Normal active family collaboration remains supported. This does not add a
  force-kill command or prove native Windows process-tree behavior.
- **Keep startup children owned until readiness.** Failure to publish a managed PID record now
  drains the exact spawned child. Readiness must return a running, managed status for that same PID
  before startup resolves. A transient second health-probe failure keeps startup observing.
  Unconfirmed shutdown raises a distinct error, and source update refuses database rollback on that
  direct error path. Real child tests cover record-write failure and readiness recovery. This is not
  a transactionally durable updater rollback implementation.
- **Retain identity-safe handoff recovery.** Handoff applies its stash by immutable commit ID and
  retains the recovery entry. The later recovery follow-up also pins a durable private Git ref. It
  no longer resolves a numeric stash index and deletes it while another Git process can insert
  entries. The success note explicitly says changes are already applied and identifies the retained
  recovery copy. A disposable Git regression inserts an external stash during handoff. Recovery
  stashes require deliberate later cleanup.
- **Protect stored diagnostics and child environments.** Shared credential-text redaction handles
  Bearer/Basic credentials, credential assignments, API-key headers, embedded quoted JSON and URL
  userinfo. Activity migration v4 resanitizes historical rows. Runtime and mobile crashes sanitize
  before persistence and on legacy reads. Runtime crash stack location text remains useful. Ambient
  MCP stdio environment now uses the existing filtered environment; explicit configured mappings are
  applied afterward and remain supported. A real SDK child test checks both cases. Redaction
  recognizes supported credential formats, not arbitrary unlabelled secrets.
- **Bound backup failure cleanup correctly.** Existing live databases must receive a successful
  pre-restore snapshot; only ENOENT skips it. SQLite snapshots reserve a private, exclusive 0600
  destination before writing and refuse existing destinations. Staged main/WAL/SHM cleanup waits for
  all started deletes before releasing the operation lock and retains the primary failure when
  cleanup also fails. Deferred-unlink and SQLITE_CANTOPEN fault tests exercise these paths.
- **Commit PDF pages atomically.** Each requested page/zoom/size has a generation. Rendering uses a
  detached canvas and commits pixels, dimensions and navigation controls together; stale work is
  discarded and acquired pages are cleaned. Failed navigation restores the last committed page/zoom
  so Next retries the intended page. VM tests control delayed lookup and render, failure and retry.
  The real Chromium chat-files check passes PDF page navigation over HTTP, sandboxed HTML, video
  playback and desktop/mobile file flows.
- **Reserve downloads across profiles.** Pending native downloads reserve canonical destinations
  across all profile trackers until native completion, including after profile disposal. In-root
  symlink aliases resolve to the same reservation; Windows/macOS paths conservatively fold case.
  Native explicit overwrite/dialog behavior remains available. Tests cover concurrent profiles,
  disposal, setup failure and directory aliases; native Electron was not launched.
- **Reduce timeline boundary lookup work.** A lower-bound binary search replaces repeated linear
  scans of sorted message boundaries. Five hundred seeded full-output cases matched the previous
  implementation. A local Node benchmark of 100 complete rebuilds measured 5.00→2.80 ms at 100
  boundaries, 64.98→31.42 ms at 1,000 and 1,018.37→189.42 ms at 5,000. These are CPU measurements on
  synthetic text/tool histories, not React render or device frame measurements. Rich Markdown prefix
  parsing remains a separate measured cost; Streamdown already memoizes rendered blocks, so T3's
  splitter was not copied into a second owner.

Remaining high-value work established by the deeper review:

- **Worktree creation:** the generic Git deadline, cancellation propagation, ownership of partial
  registrations and adoption after failed creation need one complete lifecycle change across
  primary, linked and PR preparation. Copy-failure cleanup must not delete an externally replaced
  target. Extending/removing the timeout alone does not solve ownership.
- **Updater recovery:** release selection and database restoration need durable recovery state.
  Metadata-write failure can interrupt rollback; restoration of a previously absent database and
  interruption around WAL/rename also need explicit treatment. Cleanup errors after successful
  activation should not look like activation failure. A free database lock alone does not prove an
  unconfirmed candidate can never start later. The direct shutdown guard above covers its current
  caller; a future wrapping layer must preserve that typed boundary.
- **Mobile uncertain uploads:** an upload can commit before its response is lost, while the mutation
  journal remains empty. Reselecting creates another ID; same-ID storage replay does not establish
  current draft membership. Replacement cancellation cannot safely be implemented by deleting the
  new attachment. Recovery needs capability-gated receipts and ownership in the existing journal,
  including result delivery to the correct draft/queued edit. Blind retries or merely allowlisting
  the route would be incomplete. The proposed general stale-settings race was withdrawn after
  tracing existing generation checks and mutation serialization.
- Popup POST preservation, artifact materialization limits, independent malformed-row isolation,
  expired search cursors and preference-write failure UX retain their audit status. No native device
  or live forge mutation verification is claimed.

Final verification: **5,999 tests passed in 710 suites**, with 12 tests and four suites skipped. All
**32 build tasks** and **28 typecheck tasks** passed; runtime/API builds and typechecks were
repeated after the final ownership change. Explicit formatting, lint and type checks passed for all
**47 touched source/test files** without warnings. Workspace checks passed with zero errors and the
same ten existing warnings. The real chat-files Chromium check passed, and the final diff passed
whitespace validation. An earlier full run overlapped ongoing edits and exercised older module
versions against newer tests; the final full run above used stable code.

## Task-list collapse persistence (2026-10-30)

Task-list groups and project sections retain device-local collapse preferences on desktop and
mobile. Mobile defers storage writes until saved preferences hydrate and merges early toggles per
section, preventing an initial screen state from overwriting other saved collapsed sections.
Targeted preference/list tests and browser reload checks passed. Native-device installation and
app-process restart were not exercised.

## Thread Info panel (2026-10-30)

Compared T3 at
[`6575ce32508b`](https://github.com/pingdotgg/t3code/tree/6575ce32508bd7908444241f3719aa33aaf77f90),
particularly
[section customization](https://github.com/pingdotgg/t3code/blob/6575ce32508bd7908444241f3719aa33aaf77f90/apps/web/src/components/chat/threadDetailsItems.ts),
[panel grouping](https://github.com/pingdotgg/t3code/blob/6575ce32508bd7908444241f3719aa33aaf77f90/apps/web/src/components/chat/ThreadDetailsPanel.tsx)
and
[usage rows](https://github.com/pingdotgg/t3code/blob/6575ce32508bd7908444241f3719aa33aaf77f90/apps/web/src/components/chat/ThreadDetailsUsage.tsx).

Dovo's former project-information panel is now **Thread info** on desktop and mobile. A shared
section catalog drives device-local show/hide choices and reset. Existing project, checkout, script,
Git, PR, server, watch, linked-project and lineage controls remain available. Mobile also exposes
the existing agent/model editor. Car mode opens a sheet rather than an unavailable inline panel. The
desktop environment/access portal stays mounted when hidden to preserve composer state.

Context shows the runtime's reported percentage **used**, a meter and reported token counts. Unknown
window sizes show tokens without inventing a percentage; missing reports are explicit. This reuses
Dovo's existing provider context parsing. T3's account quota rows and automatic card density changes
were not copied; this change does not infer account usage from a thread's context.

Verification for this panel change: **55 targeted tests** passed, along with desktop/compact panel,
mobile panel reload/customization, mobile navigation/car-mode, composer send and composer layout
browser checks. Protocol, core, tasks and mobile typechecks passed, as did desktop and web builds.
Mobile browser checks use native-control and storage adapters; no native-device installation or
restart verification is claimed. These results do not replace the broader review's separate status.

## Recovery challenge follow-up (2026-10-30)

The delayed Opus reviews were source traces, not executed tests. Their strongest additional findings
were reproduced or challenged against the actual implementation before integration.

- A start refused before checkout admission no longer drains, disposes or cancels healthy family
  work. Active family collaboration remains available, while a child with unconfirmed shutdown
  blocks a new turn. Native Stop requests also retain that exclusion after the provider run has
  settled. Tests exercise both held child runs and native ownership without a held run.
- Shared explicit edits exclude branch switches and restores without blocking normal agent starts.
  SCM apply/stage/commit, desktop/mobile task-file saves and project-instruction saves use this
  admission. The three editors share per-file serialization and reread expected contents after
  admission, so simultaneous stale saves produce one success and conflicts for the others.
- Undo records its original redo targets and a durable pending marker before touching any files.
  Failed rollback retains those targets across repeated undo and database reload. Finishing undo
  clears the marker only after filesystem and history success; a running task cannot start on its
  own unresolved undo. Retry uses this same path for primary and linked-only changes, without
  inserting a synthetic request. Linked checkpoint identities have a separate ref namespace.
- Pending recovery is selected before another undo on desktop/mobile, including paged older history.
  Retrying/restoring a different turn is refused. Resumed undo refuses paths that match neither the
  original backup nor the before snapshot, preserving intervening edits and reporting the fresh
  recovery ref. Removing a linked project needed by pending recovery is refused. An externally
  removed or inaccessible checkout still needs to be restored before recovery can finish; the
  application does not silently skip its files.
- Handoff pins each captured stash in a private `refs/dovo/handoff/<task>/<attempt>` ref before
  applying it. Real Git tests cover both directions, failure recovery, competing stash pushes and
  bare pop followed by reflog expiry/garbage collection. A failed apply after preparation keeps the
  task pointed at its prepared worktree. Recovery errors name the private ref and call for
  inspecting partial changes rather than blindly discarding them.

The integrated run also reproduced a signaling replacement race in the existing paired TURN
regression: changing mode opened a new host connection before the broker released the previous
registration. Replacement now waits for the bounded close handshake and keeps readiness tied to the
replacement. All 31 peer-connection tests pass, including relay policy changes, retained pairings,
existing tunnels and LAN access. No identity or transport policy was weakened.

Remaining handoff limits: Git offers positional stash deletion, so shared handoff entries remain. A
bare pop in another checkout can still apply them there; the private ref preserves the recovery
copy. Shared entries and private refs require deliberate cleanup. A pop before capture/pinning can
still prevent identification, so that error directs the user to the stash list and reflog without
claiming the entry must still exist.

Worktree lifecycle remains open: the generic 30-second deadline does not drain checkout/hook
children; a timeout can leave partial creation that retry adopts incompletely. Blanket worktree
pruning can affect unrelated temporarily missing folders. Cancellation, Windows initializing locks,
main-worktree reuse and failed handoff checkout transitions need one coordinated ownership design.
Use feature-gated creation locks with an attempt-specific reason, drain the owned process group,
carry cancellation through primary/linked/PR preparation, and clean only registrations still owned
by that attempt. Do not remove the timeout in isolation or delete/prune unknown worktrees.

Updater transactional recovery, uncertain mobile uploads and the other explicitly open audit items
above remain separate work. HTTP LAN/VPN support, optional HTTPS and required pairing/device tokens
are preserved. No commit, push, publication or native-device deployment was performed.

Verification after the recovery challenge: **6,022 tests passed in 711 suites**, with 12 tests and
four suites skipped. All **32 build tasks** and **28 workspace typechecks** passed; the runtime/API
builds and runtime typecheck were repeated after the signaling correction. Workspace checks passed
with zero errors and the ten existing warnings. The 100 MB file-transfer suite now uses the shared
runtime integration-test budget; its size, authorization and response assertions are unchanged.
Managed Chromium was installed through Playwright before the passing desktop composer-send and
mobile draft-transition checks. Final formatting and whitespace checks passed. Native devices, live
forge mutations, worktree lifecycle recovery and signed releases were not verified by these checks.

## Deeper performance and stability implementation (2026-10-30)

The subsequent implementation supersedes the worktree lifecycle and degraded-record limitations
above where explicitly described in the
[stability audit](stability-audit-2026-10-29.md#deeper-implementation-pass-2026-10-30). Primary,
linked and PR checkout creation now use attempt-owned Git creation locks, cancellable owned process
trees and identity-checked cleanup. Preparation no longer prunes unrelated missing registrations or
adopts the main worktree as a task checkout. Unconfirmed preparation shutdowns retain admission in
the live runtime. Later snapshot, submodule and setup preparation also holds an attempt-specific
durable lock. A real POSIX SIGKILL probe verifies that a fresh runtime refuses the checkout while
its orphaned setup remains alive. Hard-kill recovery requires confirming the setup commands stopped
before explicitly unlocking; no automatic process adoption is claimed.

Unreadable task metadata and authoritative histories survive migration and full workspace rewrites.
Reserved task identities prevent accidental replacement, and recovery bookkeeping clears only after
the outer transaction commits. History-cache accounting includes large diff excerpts and checkpoint
disk contents. Mobile cache-read failure no longer prevents live conversation pagination.

The [performance report](performance.md#deeper-performance-and-recovery-pass-2026-10-30) records
before/after source comparisons for overlapping worktree includes, legacy compaction grouping and
Markdown preprocessing. Equal-output assertions accompany the measurements. Mixed and incomplete
Markdown workloads did not establish an improvement, and browser rendering fixtures do not establish
native frame-time or complete-app speedups.

## Seven adoption implementations (2026-10-30)

A fresh investigation used T3 Code commit
[`616c426f5f199865e34974777740dff678ffb7f5`](https://github.com/pingdotgg/t3code/tree/616c426f5f199865e34974777740dff678ffb7f5)
(MIT). The following adaptations now exist in Dovo:

| T3 capability                    | Dovo implementation and boundary                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout content search          | Literal, case-sensitive code search with exact-line opening on desktop/web and mobile. Ignores Git-ignored untracked entries, skips binary/non-UTF-8/oversized files and reports truncation.                         |
| Incremental file browsing        | Paged immediate-directory reads with folder navigation; opening Files no longer requires downloading the entire checkout path list. Composer path suggestions retain their existing cache.                           |
| Reading-position continuity      | A bounded 100-thread navigation cache restores stable message/turn anchors and measured offsets. User scrolling, search, bookmarks and Latest take precedence. This cache survives navigation, not process restarts. |
| Local commit review              | First-parent history, immutable previews and separate viewed marks on primary/linked checkouts. Root, merge and shallow-history handling; no checkout preparation or Git writes.                                     |
| Heap attribution                 | Bounded recent expensive operations and rate-limited heap-growth suspect reports, runtime RSS/heap and Linux descendant RSS. Concurrent work and garbage collection prevent causal attribution.                      |
| Linux memory-pressure protection | Explicit preview/status/enable/disable for one owned user-service drop-in. Optional MemoryLow, safe child-score handling and atomic replacement. No sudo, system-unit changes or SSH/VPN protection.                 |
| External credentials             | Runtime-resolved 1Password, Bitwarden, Infisical and host-environment references, desktop/mobile editing and explicit refresh. Scope is saved; resolved values stay out of workspace documents and client responses. |

The original T3 references include
[project content search](https://github.com/pingdotgg/t3code/blob/616c426f5f199865e34974777740dff678ffb7f5/apps/web/src/components/search/ProjectContentSearchDialog.tsx),
[heap attribution](https://github.com/pingdotgg/t3code/blob/616c426f5f199865e34974777740dff678ffb7f5/apps/server/src/observability/HeapAttribution.ts),
[service protection](https://github.com/pingdotgg/t3code/blob/616c426f5f199865e34974777740dff678ffb7f5/apps/server/src/cloud/serviceProtection.ts)
and
[1Password](https://github.com/pingdotgg/t3code/blob/616c426f5f199865e34974777740dff678ffb7f5/packages/secret-provider-onepassword/src/server/driver.ts).
These implementations follow Dovo's existing runtime, protocol and client boundaries rather than
adding T3's server or provider architecture. No dependency was added for this work.

Review challenges found and corrected shallow-history misclassification, usage/reset helpers that
bypassed secret resolution, inherited OOM scores on cgroup v1 and partially written protection
settings. A real subprocess probe also exposed early abort completion in Node’s generic command
helper; secret CLIs now use owned process groups and wait for shutdown. Tests cover these failure
boundaries. Provider CLI help/source was checked for Infisical; no real credential lookup or host
service activation was performed. Browser fixtures do not verify native scrolling or native
performance.

Final validation for this pass: **6,186 tests passed in 727 suites**, with 12 tests/four suites
skipped. All **28 workspace typechecks** and **32 build tasks** passed. Workspace checks passed with
zero errors and ten existing warnings; whitespace checks passed. Managed Chromium checks covered the
new secret editors/commit pickers, conversation history and reading positions, file browsing,
content-search line navigation, previews/edit retention, scoped agent settings and code review. The
real subprocess cancellation regression confirms both the launcher and its descendant exit. Native
device behavior, live secret-provider authentication and real systemd activation were not verified.
Device Hub discovered an iOS simulator, but no current-branch native build was installed or launched
for this pass; the physical iPhone was unavailable. No commit, push or deployment was performed.

## Five follow-up adaptations (2026-10-30)

The next investigation pinned T3 Code at
[`8d012a688e7cb12fb17a91be68a32734a0efa0b7`](https://github.com/pingdotgg/t3code/tree/8d012a688e7cb12fb17a91be68a32734a0efa0b7)
(MIT). Dovo now adapts the following capabilities through its existing runtime and clients:

- **Repository-correct Markdown links.** Streamdown caches processors by plugin name and serialized
  options. Dovo previously supplied per-render closures, so rendering repository A before B could
  retain A's link base. Module-level plugins now receive explicit context options. The real-renderer
  regression alternates two repositories, no base, local files and unsafe links in one process.
- **Actionable GitHub failures.** Typed access errors retain the original credential provenance,
  host/repository and verified account when available. Repair guidance distinguishes saved tokens,
  runtime environment tokens, CLI logins and wrappers. HTTP-200 GraphQL access errors follow the
  same path. Rate-limit handling and captured binding checks remain intact; upstream bodies and
  token values are excluded from the new guidance.
- **Terminal Codex imports.** Desktop/web and mobile offer project-scoped discovery, transcript
  preview and explicit import. The original checkout, native identity, home and recorded model are
  preserved in authoritative storage. Duplicate/restart retries return the existing thread.
  Historical requests are consumed, and continuation requires new input. Missing paths, changed
  previews and uncertain or active native ownership block import. See
  [provider documentation](agent-providers.md#import-a-terminal-codex-session) for limits.
- **Completed Markdown reuse.** Bounded, immutable plain parts survive remounts; streaming prefixes
  and oversized entries bypass retention. The
  [measurement](performance.md#completed-markdown-reuse-2026-10-30) verifies equal output and a
  reduction from 2,400 splits to 120 for its repeated-remount workload.
- **Attachment playback.** Existing desktop and mobile previews offer on-demand audio/video controls
  without adding a player dependency. Runtime-detected MIME types and the existing 5 MiB limit
  apply. Close/navigation/background cleanup prevents retained playback; download/share remains
  available for unsupported formats. Mobile uses Blob URLs after an isolated iOS WKWebView probe
  stalled with data URLs and successfully played H.264 MP4 with a Blob URL. A ten-second loading or
  buffering stall displays the share fallback; successful playback clears that message. Codec
  support depends on the platform player.

Native verification remains partial: WAV audio stalled in the isolated simulator probe, and a
separate local-file MP3 test also failed to advance in native AVPlayer while simulator logs reported
CoreAudio server/proxy errors. This suggests an audio environment problem, but does not verify audio
on a healthy device. No current-branch React Native build was installed for this pass. Native audio,
React Native navigation/background cleanup and Android playback still require device verification.

Managed Chromium checks cover actual desktop WAV/WebM playback, mobile Blob-WAV playback through a
WebView adapter, unsupported-file fallback, buffering timeout/recovery, close/background/navigation
cleanup and late responses. The Codex picker checks cover desktop/mobile preview, activity blocking,
explicit import, existing ownership and leaving before import completes. Runtime tests also cover
restart/idempotency, consumed history, checkout overlap and real open-file ownership. Storage and
admission tests isolate unrelated host process churn; the ownership boundary retains its real
subprocess check and explicit unknown-ownership cases.

All 28 workspace typechecks and 32 build tasks passed during the implementation. Affected runtime,
shared picker and mobile typechecks, plus the runtime build, were repeated after their final code
changes. Workspace checks finished with zero errors and eleven existing warnings; whitespace checks
passed. One full-suite rerun encountered the existing API lifecycle fixture's free-port release/bind
race (`EADDRINUSE`); all eight lifecycle tests subsequently passed in isolation. The final full run
with four workers passed **6,237 tests in 735 suites**, with twelve tests and four suites skipped.
No commit, push or deployment was performed.

## Thread workflow and search adaptations (2026-10-30)

This pass compares against T3 Code
[`6fc9144a60c4a5f45089316ddd5f7371bafd3bf2`](https://github.com/pingdotgg/t3code/tree/6fc9144a60c4a5f45089316ddd5f7371bafd3bf2)
(MIT). Its latest image-only fix prompted another review of existing, unadopted capabilities.

- **Thread comparison bases:** newly created task worktrees remember their resolved starting
  branch/ref/commit. Branch diffs, dirty previews, file previews and branch AI reviews use that base
  while the task branch is checked out. Deleted base refs fall back to the recorded commit. Older
  tasks retain explicit-base/default-branch fallbacks; linked checkouts use their configured base.
  The desktop review header labels the comparison. A stacked-branch regression verifies that parent
  feature files do not appear as the task's changes.
- **Provider status:** explicitly synthetic Claude messages cannot overwrite context occupancy or
  contaminate model accounting. Genuine zero usage and compaction resets remain valid. Claude's
  SDK-owned retries update one durable turn notice on desktop and mobile, with attempt, retry delay,
  recovery and terminal outcomes; Dovo does not add another retry loop. Late events after completion
  or Stop cannot update the notice.
- **History matching:** shared matching supports separated words and accent folding across runtime
  history search and local desktop/mobile results. Double quotes retain literal phrases. Highlights
  use original UTF-16 offsets, including compatibility expansions and combining marks. Typo matching
  is not introduced.
- **Streaming search indexing:** authoritative message history still commits every flush. Only its
  derived search text is deferred during a run, with a live search overlay and reconciliation after
  completion, failure, cancellation or restart. This changes index work rather than weakening crash
  persistence. A synthetic run retained all 100 authoritative saves while reducing search-text
  updates and FTS delete/insert pairs from 100 to 1. The overlay admits at most 256 rows and 1 MiB
  of serialized source data; that bounds overlay input rather than total JavaScript heap usage.
- **Attachment workflows:** automatic and manual title generation accept attachment-only first
  messages and use bounded attachment metadata; utility models do not receive image pixels. Mobile
  offers an explicit Paste Image action through the existing optimization/upload path. Clipboard
  reads expose busy state, payloads are bounded before file writes, and draft ownership guards stay
  active. There is no background clipboard polling.
- **Browser element feedback:** thread browsers on desktop/web offer a captured-page element
  selector. Inspection reads the DOM without activating the live element. URL, title, selector,
  bounded text and the user's comment append to an editable draft as quoted, untrusted page context.
  An optional crop uses the captured viewport's coordinates; text survives optional image failure.
  Scrolling, resizing and document changes invalidate selection. Nested frames are represented by
  their frame element; shared-browser thread routing and native mobile overlays are outside this
  first slice.

Focused checks cover real-Git stacked/deleted-base histories and AI review scope; retry recovery,
failure, cancellation and late events; context preservation; attachment-only HTTP/schema behavior;
search/index consistency; and managed-Chromium element selection, crop, cancel and upload failure.
The real mobile picker hook is also exercised with clipboard/runtime barriers for pending busy
state, empty/rejected reads, task/runtime/edit ownership changes and stale draft guards. Native
iOS/Android clipboard behavior and Electron's native capture/inspection path still require
device/desktop verification. The prior native media verification item remains pending. No app-wide
memory, battery or latency improvement is inferred from the synthetic indexing checks.

Verification passed: **6,275 tests**, all 28 workspace typechecks and all 32 build tasks. After the
final boundary and fork refinements, another 69 targeted tests and the runtime build passed.
Managed-Chromium checks also cover search/history, retry notice replacement on desktop/mobile,
clipboard hook ownership, and browser element feedback. Workspace checks reported zero errors and
eleven existing warnings; `git diff --check` passed. No commit, push or deployment was performed.

## Transport, file and terminal workflows (2026-10-30)

This pass pins T3 Code at
[`ae521d1d796c4e21abb49e44d27c23332d1898b9`](https://github.com/pingdotgg/t3code/tree/ae521d1d796c4e21abb49e44d27c23332d1898b9)
(MIT). The adaptations use Dovo's existing runtime, upload and permission boundaries:

- **Codex transport retirement:** stdout/RPC closure settles the active turn even when the child
  process stays alive. Broken idle transports cannot be reused. Buffered final messages and the
  child's exit reason get a brief opportunity to arrive, while process shutdown confirmation still
  protects checkout ownership.
- **Metadata-only attachment reads:** ownership and metadata validation no longer select BLOBs or
  encode file bodies. In an isolated five-file, 5 MiB-per-file benchmark, forty samples measured
  median lookup time falling from 11.54 ms to 0.042 ms. This measures metadata lookup, not app-wide
  memory or battery use.
- **Bounded project-file reads:** desktop/web and mobile initially request at most 256 KiB, with
  explicit byte size, completeness and line-window metadata. Files up to 1 MiB can be loaded in full
  before editing. Incomplete responses, including those from older runtimes, remain read-only.
  Linked-checkout access and expected-content conflict checks still apply. Failed preview reads
  close file handles, and failed directory/search requests detach their cancellation listeners.
- **Diff computation:** expensive saved-file comparisons leave the UI thread. Desktop/web uses
  cancellable, bounded worker jobs; mobile opts into runtime-computed patches, avoiding redundant
  server-side computation for desktop. Timeout, worker failure and oversized output retain a text
  fallback. Complete saved text remains limited to 8 MiB per side.
- **Attention notices:** separate events enter a bounded fifty-notice queue instead of overwriting
  one another. Newly pending approval, question and delegated-request IDs can notify while another
  request is still pending. Existing active-thread suppression and reconnect behavior remain.
- **Terminal file locations:** compiler-style and quoted `file:line:column` locations open Files at
  the corresponding line. Wrapped output and wide terminal characters retain accurate ranges. The
  runtime validates the original terminal checkout, regular file, traversal and symlink bounds;
  relative paths use the terminal's starting directory. URLs are not treated as file paths.
- **One-message Plan mode:** a supported harness runs the selected message with an actual read-only
  permission policy. The plan flag survives queue operations and restart, while the next normal
  prompt restores the thread's saved policy. Automatic question-answer continuations retain Plan
  access, including file-only answers. Unsupported harnesses and steering into a plan turn are
  rejected. Runtime capability detection prevents older servers silently ignoring the flag.
- **Files in question answers:** each non-secret custom text answer can receive files without
  changing the ordinary message draft. Five files per response and existing upload limits apply.
  Answer admission validates task ownership, cancellation and identical-retry fingerprints. Durable
  receipts retain the accepted files; non-blocking answers also carry them as message attachments.
- **Split-terminal controls:** splits inherit the selected pane's checkout and are inserted beside
  it. Groups support both orientations, focused-pane tracking, cycling, four-pane limits and saved
  layouts per runtime/thread. Terminal-scoped Cmd+D/Cmd+Shift+D and Cmd+N/Cmd+W split, create and
  close panes on macOS. Elsewhere Ctrl+Shift+D/E and Ctrl+Shift+N/W preserve normal shell Ctrl+D/W/N
  input. Closing a pane returns focus to a surviving pane. Shell processes themselves do not survive
  a runtime shutdown.

Managed Chromium checks exercise actual terminal emulation, split restoration and file links, and
both question-form adapters with their real upload hooks. Native picker, installed Electron and
healthy-device media/lifecycle verification remain separate outstanding checks. Browser adapters are
not evidence of native platform behavior. HTTP LAN/VPN connections remain supported; optional HTTPS,
pairing codes and device tokens are unchanged.

Final verification: **6,335 tests passed**, with twelve existing skips across four suites. All 28
workspace typechecks and all 32 build tasks passed. Runtime types and build were repeated after the
final cleanup fix. Workspace checks reported zero errors and eleven existing warnings; targeted lint
and `git diff --check` passed. Regression probes reproduced the failed-search listener leak before
the fix and verified cleanup afterwards. Managed Chromium also verified real diff-worker parsing,
responsive fallback and cancellation, Plan controls, attention notices and mobile diff adapters. No
commit, push or deployment was performed.

## Guided reviews, incoming shares and idle work (30 October 2026)

This implementation compares against T3 Code
[`f56a4775fd9e97b6f8afa47804b4cab27228601e`](https://github.com/pingdotgg/t3code/tree/f56a4775fd9e97b6f8afa47804b4cab27228601e)
(MIT), adapting its workflow ideas to Dovo's existing runtime and mobile architecture.

- Guided reviews extend the existing organizer on desktop/web and mobile. Ordered explanations,
  review questions and exact excerpts link back to full file diffs. Only supplied patch lines can
  become excerpts; invented paths, missing ranges and lines outside a hunk are rejected. Each guide
  belongs to an exact source revision, including PR base/head identity. SQLite saves position and
  reviewed steps across clients and restarts, with optimistic concurrency checks. Walkthrough
  completion remains independent of file-viewed marks and formal review submission.
- Guide progress responses omit immutable steps once the requesting client holds that guide. A
  representative response fell from 22,139 to 527 bytes; the initial full response was 13,972 bytes
  after removing duplicated groups. Unknown guide IDs receive a full response. The newest 500 PR
  guides and 500 revision records are retained; task guides are removed only after durable deletion.
- Native incoming shares copy files into durable owned storage before acknowledging the operating
  system handoff. UUID receipts prevent crash replay from duplicating drafts, while separate shares
  of identical content remain separate. Saved files share the 50 MiB draft budget. Errors remain
  visible and discardable, and no upload starts until a runtime and project are chosen. Destination
  identity and cancellation checks protect task creation and attachment uploads across navigation.
  Acknowledgement receipts and corrupt-storage recovery archives favor preserving recoverable data
  over automatic eviction. A damaged manifest is isolated using its native directory identity
  instead of blocking healthy shares. Android accepts externally supplied content-provider URIs and
  rejects direct file paths before opening them under the app's permissions.
- Composer, mention, project-navigation and command-palette handlers honor both ordinary IME
  composition and the Safari key-code fallback. Existing model/choice guards remain intact.
- Terminal pane, tab, group and shortcut closes require an application confirmation tied to captured
  runtime/thread/session targets. Scope changes invalidate it; cancellation and failures recover
  focus. Hiding the terminal remains immediate.
- GitHub-trigger idle ticks skip SQL and JSON parsing without delaying queued delivery retries or
  changing minute network polling. Orphan upload receipts release bytes only after durable thread
  deletion or device revocation, preserving live draft references and recoverable uploads.

The native-subagent update profile and its limits are recorded in `docs/performance.md`. No change
to authoritative write durability was retained from the performance prototype. HTTP LAN/VPN,
optional HTTPS, pairing codes and device tokens remain supported under the existing policy.

Verification: **6,425 tests passed**, with twelve existing skips, plus 73 targeted tests after the
final sharing review. All 28 workspace typechecks and all 32 build tasks passed; targeted
formatting, lint and whitespace checks passed. Managed Chromium exercised guided review navigation,
reopening, cross-client progress, revision invalidation, file-viewed independence, IME handling and
terminal confirmation scope.

Final Swift bridge/share-extension builds and Android bridge/MainActivity Kotlin compilation passed
on the authorized Macs. An installed iOS simulator harness exercised the production ingestion and
storage helpers with a healthy image/text fixture beside malformed JSON. The copied 15,342-byte
image was byte-identical, its native handoff was acknowledged, malformed bytes remained available
for explicit discard, and relaunch preserved the two drafts and attachment identity without replay.
This checks the native storage boundary, not the full production destination/upload UI. Real share
sheet completion could not be verified after Device Hub controls returned “Simulator preview
expired”; an installed Android intake check and a live real-PR guide check also remain outstanding.
The existing installed-build clipboard/element inspection, native audio/lifecycle/playback and
question-file-picker checks remain pending. No commit, push or deployment was performed.

## Streaming parser, credentials and browser file selection (30 October 2026)

Compared against T3 Code
[`cb9629e6891ef0745772b69f09c9acd0c6a74f7e`](https://github.com/pingdotgg/t3code/tree/cb9629e6891ef0745772b69f09c9acd0c6a74f7e),
52 commits after the previous comparison. The useful adaptations are:

- **Mobile streaming Markdown:** skip the image AST pass when a literal `![` is absent. Empty text,
  unfinished syntax, code fences, escaped markup, linked images and image references retain their
  existing behavior. This follows T3's reduction of repeated stream parsing (#27823), using Dovo's
  existing parser rather than adding a second parser or incremental cache.
- **Bitbucket secret references:** desktop/web and mobile connection editors can select host
  environment, 1Password, Bitwarden or Infisical references. Only the vault kind is public; the
  reference and resolved token stay on the runtime. API and Git use the same selected credential,
  with no ambient fallback on failure. Refresh or rejection invalidates vault reads, including
  lookups already in flight; connection changes reject stale results. This adapts #27746 to the
  existing resolver and forge support. A reference's resolved token is not persisted or returned.
- **Streamed-browser file selection:** the shared viewer supports device-selected files for the
  exact page or iframe picker. Transfer uses 64 KiB chunks, four per acknowledgement batch, up to
  five files per selection. Each tab retains at most 50 MiB and fifty files, including prior
  selections still needed by the page. Runtime admission permits at most eight queued upload
  commands per tab. Paths are generated privately, file bytes never enter workspace snapshots, and
  authorization is checked around asynchronous work. Navigation, replacement, cancellation,
  disconnect, expiry and session close invalidate staging. Successfully selected files remain on
  disk until their document is replaced or the session closes because Chromium reads them lazily.
  This adapts #22062 without allowing clients to supply runtime paths.
- **Claude connection settings:** isolated utilities copy only supported endpoint/auth/backend
  settings while retaining empty setting sources and tool/MCP restrictions. Effective settings also
  determine subscription labels, usage probing and reset eligibility, including endpoint-only
  gateways. Coding continues to use its configured settings sources. This adapts #26937 without
  passing complete settings objects into isolated utilities.
- **Modal shortcut ownership:** shell navigation respects dialogs and alert dialogs. Cmd/Ctrl+/
  cannot leave the terminal-close confirmation; it works again after dismissal. Palette toggling and
  intentional modal actions remain available, following #27157.

The browser upload picker binds device results to the chooser that opened them. Its native bridge
acknowledges keep-alive state before launching file selection, preserves the socket while the
Android picker backgrounds the app, pauses capture while hidden, and reconnects an offline view on
foreground return. No new account requirement, HTTPS requirement or runtime connectivity policy is
introduced. An old client must update to decode connections using the new credential kind.

Managed Chromium exercises the real runtime, authenticated socket and shared viewer on desktop and
touch layouts. Checks cover multi-file/empty/chunked transfers, delayed reads, local size rejection,
iframe navigation, stale answers, conflicting viewers, revocation, malformed/out-of-order chunks,
replacement native results, queued cancellation, bounded admission, disconnect during commit and
session cleanup. The native bridge is simulated in these checks; installed Android/iOS picker
behavior remains unverified. Device Hub discovered an available Android emulator, but this new code
was not built or installed there. The available physical iPhone was disconnected. No real vault,
Bitbucket or custom Claude endpoint was contacted. Enterprise managed settings from cloud/registry
policy and backend login parity are outside these verified checks. An abrupt runtime/process crash
can leave owned upload directories in the OS temporary directory; normal lifecycle cleanup is
covered, and this change does not add cross-process crash recovery or sweep other instances' files.

The existing pending native sharing, clipboard/inspection, audio/lifecycle/playback, question picker
and real-PR guided-review checks remain outstanding. No commit, push or deployment is part of this
implementation.

Final verification: **6,454 tests passed**, with twelve existing skips across four suites. All 28
workspace typechecks and all 32 build tasks passed. Workspace formatting/lint checks reported zero
errors and eleven existing warnings; scoped lint and `git diff --check` passed. The final browser
HTTP/startup checks passed all 27 tests. Managed Chromium also passed the upload integration,
existing real-browser session lifecycle and shared-viewer layout suites; the editor and modal
interaction suites passed in the delegated implementation checks. Earlier unrelated working-tree
changes were preserved and the incremental diff was reviewed against the task-start snapshot.

## Browser downloads, transfer recovery and quota consistency

The next adoption round uses the same T3 revision, `cb9629e6891ef0745772b69f09c9acd0c6a74f7e`; no
newer upstream release was required.

- **Streamed-browser downloads:** web/desktop and mobile viewers show downloads with Save and
  Cancel/Remove. Chromium writes opaque files into private runtime staging. Each tab admits two
  concurrent transfers, ten retained files, 50 MiB per file and 100 MiB retained bytes. Chromium
  progress cancels advertised or received oversize transfers; completed files are checked again.
  Progress events are asynchronous, so these are acceptance/retention limits, not a hard disk quota
  on Chromium's transient writes. Transfers time out after ten minutes and retained files expire
  after fifteen minutes. Downloads are scoped to the originating page, including iframe downloads,
  and survive viewer reconnects while the tab lives. Direct download navigation no longer becomes a
  page-load error. The desktop iframe explicitly permits downloads while retaining its opaque
  origin.
- **File delivery:** Save obtains a thirty-second, single-use file grant through the authenticated
  browser socket. The paired device token stays on the runtime; it is never included in a file URL.
  Redemption rechecks the device, thread, tab and download, uses safe attachment headers and streams
  bytes with backpressure. Expired/removed files, closed tabs and revoked devices cannot redeem old
  links. In-flight responses recheck revocation and file ownership and have bounded idle/lifetime
  limits. HTTP LAN/VPN runtime addresses remain supported.
- **Native handoff:** mobile streams into a private cache file and opens the OS share sheet. Origin,
  path, response status and byte count are checked. Removal, reconnect, navigation and unmount abort
  stale transfers. Native exports reserve at most two active transfers, ten files and 100 MiB;
  successful exports remain available to share recipients for up to a day and expire on later use. A
  full cache reports an actionable error rather than silently deleting a recent shared file.
- **Crash recovery:** uploads and downloads now use a runtime-owned transfer root beside the runtime
  database. A per-run SQLite OS lock protects live runs, including multiple runtimes in one process.
  Startup reclaims only recognized dead-run directories under this root; it does not sweep global
  temporary prefixes or durable drafts. Recovery failures are logged and recorded in activity.
  Abruptly killed worker tests verify recovery without touching another live worker's files. Old
  upload directories from versions using the global OS-temp prefix are deliberately not swept,
  because their ownership cannot be proven. This follows T3's owned download cleanup (#25436).
- **Stop during quota finalization:** cancellation is checked after change capture and reconciled
  again when the final task status is written. The matching turn is cancelled, and only its quota
  continuation and matching automatic snooze are cleared. A separate manual snooze remains intact.
  The scheduler already prevented the cancelled task from restarting; this fixes the false
  “Scheduled to resume” banner and unexpected movement into Snoozed, inspired by #24634.
- **Review classification:** `evals/`, `.eval.*` and `_generated/` follow T3's corrected conventions
  (#26563). Generated files retain precedence, fixtures stay distinct, and Dovo's `.cy.*`
  recognition remains supported. The shared classifier serves desktop/mobile PR and checkpoint
  summaries.

Managed Chromium checks exercise real runtime sockets and streamed HTTP downloads from clicked,
initial/direct, iframe and empty responses, sandboxed desktop Save and a simulated native handoff.
They cover cross-tab isolation in a shared Chromium context, single-use grants, removal, tab close,
revocation, cancellation and advertised oversize rejection. Unit/integration regressions cover
expiry, limits, corrupt/completed files, symlinks, safe headers and error classification. Existing
browser-upload checks cover delayed page reads and lifecycle cleanup under the new staging owner.
Native filesystem/share APIs are covered with boundary doubles; installed Android/iOS Save/share
behavior still requires device verification. No native OS share-sheet success is claimed here. The
six previously pending native/live-PR checks remain outstanding. No commit, push or deployment is
part of this implementation.

Final workspace verification passed **6,513 tests** with twelve existing skips across four suites,
all 28 typecheck tasks and all 32 build tasks. Workspace checks reported zero errors and eleven
existing warnings. Targeted download adversarial tests, the real browser download integration,
viewer interaction checks and the existing streamed-browser upload integration also passed.

## OpenCode retirement, PDF continuity and cheaper composer updates

This implementation follows the next T3 comparison pinned to
[`78f1ba8285898d50af82a49c98364197d330db6a`](https://github.com/pingdotgg/t3code/commit/78f1ba8285898d50af82a49c98364197d330db6a).
It adapts provider retirement (#24777), scoped composer measurements (#27823), PDF reading-state
retention (#25555), compressed usage history (#25453), and contained symlink browsing (#21920).

- **OpenCode:** local server use is leased across turns and utility calls. Task release, replaced
  configurations and the shared idle-provider budget retire unused servers. Per-thread process
  markers remain distinct, and explicit external servers remain externally owned. Active or
  unconfirmed native work must retain ownership until shutdown is confirmed.
- **Composer:** unrelated renders no longer measure the form and every control. Resize and
  structural changes update the animation baseline through coalesced observers, while focus/compact
  transitions preserve interrupted animations and reduced-motion behavior. In the mounted Chromium
  fixture, twenty unrelated parent commits produce zero geometry/style reads, down from 180
  rectangle reads and twenty computed-style reads. This is a scoped regression measurement, not an
  app-wide battery or frame-time claim.
- **PDF previews:** a per-load bridge retains page, zoom and scroll independently of rotating file
  grants. Hosts scope state to the runtime connection, thread and file, reject stale bridge
  messages, and reset on identity changes. Restoration waits for committed rendering and clamps the
  page when a replacement document is shorter. Existing explicit Refresh/retry and mobile process
  recovery remain the triggers; no automatic file watching is introduced.
- **Codex usage:** exact `.jsonl.zst` histories stream through the bounded line parser. Unchanged
  archives reuse cached results; changed archives are fully rescanned rather than seeking to decoded
  offsets. Plain/compressed overlap and Dovo-owned sessions remain deduplicated/excluded. Corrupt,
  truncated and oversized records surface notices. This adds usage ingestion, not compressed
  terminal session import, and does not imply previously stored usage was deleted by compression.
- **Project files:** contained file and directory links are browsable, with canonical ancestor-cycle
  checks, ignore rules, cursor invalidation and target revalidation. External, `.git`, dangling and
  cyclic targets remain inaccessible. Content search continues to skip aliases to avoid duplicate
  hits; composer-wide file suggestions retain their existing scope.

HTTP LAN/VPN connections, optional HTTPS and required pairing/device credentials are preserved. The
existing seven installed-device/live-PR verification items remain pending. Installed native PDF
WebView recovery and Windows junction behavior require platform verification; simulated bridges do
not establish those outcomes. No commit, push or deployment is part of this implementation.

Validation passed all 28 workspace typecheck tasks and 32 build tasks. The full test run passed
**6,545 tests**, with twelve existing skips across four suites. A subsequent first-paint failure
probe reproduced locked PDF navigation; its fix passed the final 27-test PDF/OpenCode regression
run, and the affected runtime was rebuilt. Managed Chromium passed the new composer measurements and
combined PDF viewer/host suites, plus the existing composer layout, typing and chat-file checks.
Final workspace checks reported zero errors and eleven existing warnings.

A real OpenCode v2.1.4 CLI probe, using isolated data/configuration directories and no model calls,
created a session, retired its server, and read that same session from a fresh server. Actual prompt
resumption, the complete archive flow, real v1 idle detection and Windows process cleanup remain
unverified. The PDF bridge checks use production host components with a simulated native WebView;
installed Android/iOS recovery and Windows junction behavior still need platform checks. No app-wide
memory, battery or frame-time reduction is claimed. The ordinary 200-file directory fixture retains
its prior 1–2 ms warm listing time after removing redundant per-file filesystem walks.

Testing incident: at 23:24:59 UTC on 30 October 2026, a delegated probe used an overly broad
`pkill -f "opencode serve --hostname 127.0.0.1 --port 0"` instead of stopping only its owned PID.
Process/log evidence suggests this also stopped one existing Dovo-managed OpenCode server. A
read-only query of the real runtime database found no recorded OpenCode turn overlapping that time
and no current OpenCode task state; this does not rule out external or unrecorded activity. No
service restart was performed. The existing manager should relaunch its local server on the next
OpenCode use. Subsequent real-CLI probes used isolated directories and exact process ownership.

Browser-suite discovery also exposed three pre-existing unregistered checks. The mobile terminal
visibility/close checks now run in the terminal layout suite, and sharing/waiting lifecycle checks
have their own command. All three pass, and discovery includes the new PDF and composer suites.
