# T3 comparison: performance, interface and tool discovery

Reviewed T3 Code through `7bafc40c17ab` on 2026-10-25; theme source links remain pinned to
`d0b9e9d3c72b`. T3 measurements are not Dovo measurements.

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
