# T3 comparison: thread performance, PR navigation and themes

Reviewed T3 Code at `d0b9e9d3c72b` on 2026-10-25. T3 measurements are not Dovo measurements.

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
