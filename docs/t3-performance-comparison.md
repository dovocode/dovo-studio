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
