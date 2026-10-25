# T3 comparison: thread performance, PR navigation and themes

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
