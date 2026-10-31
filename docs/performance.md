# Performance verification

Task summaries and complete conversations have separate types and storage paths. Workspace reads and
metadata edits use summaries. Operations that need messages or checkpoints explicitly request a
complete task; SQLite remains authoritative, and complete histories use a cache capped at 32 tasks
and approximately 64 MiB. The most recently accessed history remains available if it alone exceeds
that budget. Legacy snapshots and exports still include complete conversations.

Version 3 storage writes task metadata independently of the workspace shell. Migration backups,
history counts, provider intents and submission receipts share the existing transaction boundary.
Older runtime binaries cannot write this storage format; downgrade from a full database backup.

History pages use indexed message and assistant ownership lookups. Search uses a transactional FTS5
trigram index to narrow rare substring matches, then confirms exact matches. Common and short
queries scan the normalized text index. Every matching task remains in the result even when the
message-hit limit is reached. Malformed UTF-16, replacement characters and NUL queries use original
JSON text to preserve matching semantics. The derived index adds database space and work when text
changes; it can be rebuilt from authoritative conversation rows.

Snapshot projections preserve unchanged identities, and deltas skip unchanged fields before
serialization. WebSocket projections are built and shared by subscribed task scope; paged clients
read only the selected conversation windows. Projection caches use weak references for complete
histories. Action consumers use narrow subscriptions. Sidebar callbacks resolve current task entries
by key, rows outside the viewport release their expensive content, and label clocks update only rows
whose labels change. Chat turns and diff files use measured placeholders and retain focused
controls, selected text and active drafts. Desktop history pages have approximate budgets of 12 MiB
per conversation and 48 MiB across remembered conversations; active readers and protected recent
messages can exceed them.

Git previews share one operation-owned `cat-file --batch` process and bounded blob cache. Identity
and icon caches cap at 256 entries. OpenCode clients expire after five idle minutes and cap at 128
idle entries; active clients retain their shared identity until release. Terminal output uses
bounded chunks, preserving the existing 1,048,576 UTF-16 character replay cap.

CLI usage transcripts retain parser state and read appended bytes, including partial UTF-8 lines.
Replacement, truncation and detectable rewrites reset the parser. In-place edits in the middle of a
file followed by growth that preserves both sampled anchors need a fresh parser instance to be
detected. This optimization assumes the normal append-only provider transcript format.

## Reproduce checks

Use the established workspace tools:

```sh
pnpm -r --no-bail typecheck
pnpm test
pnpm check
pnpm build
pnpm test:sidebar-rendering:browser
pnpm test:mobile-task-list-rendering:browser
pnpm test:thread-streaming:browser
pnpm test:conversation-history:browser
pnpm test:pull-stability:browser
pnpm benchmark:history
pnpm benchmark:workspace-memory
pnpm benchmark:snapshot-deltas -- --baseline-ref HEAD
```

The snapshot comparison accepts a Git reference from before the optimization. After committing,
replace `HEAD` with that reference. Browser fixtures exercise real row, provider and window
components, with transport and unrelated UI adapted for the test environment. Mobile browser checks
use native-control adapters; native device rendering and gestures were not measured.

On the review host with Node 26.8.1, the Vite+ recursive runner failed with `spawn EINVAL` for the
root typecheck and build commands. The same package scripts passed using
`pnpm -r --no-bail typecheck` and `pnpm -r --no-bail build` directly.

## Measurements

These are synthetic measurements on the development host, not application-wide latency or memory
guarantees. Host load and fixture size affect results.

A fresh process opening an already migrated workspace with 400 tasks, 100,000 messages and 50,000
checkpoint turns took 53.6 ms and retained 2.1 MiB of additional JavaScript heap after collection. A
metadata edit took 6.1 ms without loading any complete histories; loading one complete task took 2.1
ms. Reading 40 tasks retained 32 histories and approximately 14 MiB of encoded history data. The
first opening of older storage derives summaries and backfills usage once; these steady-state
measurements exclude migration.

| Workload                                       |   Before |    After |
| ---------------------------------------------- | -------: | -------: |
| Desktop sidebar, 422 threads: mounted rows     |      422 |       11 |
| Sidebar row renders across 30 streamed frames  |   12,660 |       30 |
| Sidebar fixture heap after collection          | 60.2 MiB |   15 MiB |
| Chat window fixture: peak mounted messages     |      600 |       24 |
| PR fixture, 120 files: peak mounted diffs      |      118 |       26 |
| Rare substring search over 50,000 messages     | 10.22 ms |  0.23 ms |
| Common substring search over the same messages | 30.46 ms | 15.77 ms |
| Recent page over a 20,000-message conversation |  1.22 ms |  0.43 ms |
| Delta with 4 MiB of unchanged file text        |  7.12 ms | 0.014 ms |

Search and paging compare the previous in-memory helpers with database queries and assert equal
results. Delta measurements compare actual source implementations and assert equal wire output. The
zero-file delta fixture did not improve measurably. Additional unit coverage checks migration,
rollback, cursor ownership, Unicode, cache eviction, chunk boundaries and transcript rotation.

## Deeper performance and recovery pass, 2026-10-30

Legacy compaction events now resolve turn ownership through a single index. The index is built only
when an event lacks explicit message ownership and preserves first-match behavior for duplicate turn
IDs. In a synthetic 2,000-turn history with 200 legacy events, grouping fell from a median 1.233 ms
to 0.223 ms. This measures the grouping function, not complete React commits.

Worktree include discovery visits each selected path once. Overlapping directory/glob patterns
previously traversed descendants repeatedly even though the final file set was deduplicated. A
synthetic 24-level tree with 192 files and three overlapping patterns fell from a median 341.23 ms
to 12.76 ms, with equal selected files. Reproduce with
`node scripts/benchmark-worktree-includes.mjs --baseline-ref HEAD`. This measures discovery only;
Git checkout, copying and setup are separate costs.

Rich Markdown reuses parser extension definitions and the initial syntax tree when there are no
rich-card splits. Nonoverlapping citation edits are assembled once, and links on the same source
line avoid repeated prefix scans. Split fragments still parse independently to preserve their
Markdown context. Reproduce the source comparison with:

```sh
node scripts/benchmark-rich-markdown.mjs --baseline-ref HEAD
```

Use a reference preceding these changes after committing. The script asserts exact output and tests
every streaming prefix of representative links, citations, code and directives before timing.

| Synthetic Markdown workload          |    Before |    After |
| ------------------------------------ | --------: | -------: |
| 90 KB single line of links           | 124.08 ms | 88.01 ms |
| 91.5 KB citations                    |  80.91 ms | 36.45 ms |
| 42.6 KB mixed links and citations    |  73.50 ms | 80.23 ms |
| 25.9 KB incomplete streamed Markdown |  32.54 ms | 32.92 ms |

The mixed and incomplete cases show no improvement. These are isolated CPU measurements on a
development host, and do not establish frame-time or end-to-end streaming gains. The browser
streaming fixture substitutes a Markdown renderer, so it cannot validate this parser's cost.

The history cache estimate now includes diff-comment excerpts/bodies, attached file paths, text
boundaries and checkpoint disk contents. A 100,000-character excerpt previously counted as only
1,088 bytes in a targeted history; it now counts over 200,000 bytes and triggers budget eviction.
Sizing remains approximate, with the same exception for a single oversized most-recent history.
Workspace opening and common-query benchmark runs did not establish a speedup in this pass.

Mobile conversation history distinguishes completion of a cache read from successful cache
hydration. A failed offline-cache read no longer blocks live pagination; unread offline data remains
protected from writes, and cache errors remain visible separately from network errors. The mobile
task-list fixture mounted 102 real rows; across 30 streamed updates only the running row rendered,
30 times. This is a browser fixture result, not a native frame-time measurement.

## Queued-message projection follow-up, 2026-10-30

Pending previews and steering handoffs now share a history lookup index for batches of at least 20
relevant lookups. Smaller batches retain direct scans, and previews from other tasks do not trigger
indexing. The index lives only for the projection call; streamed messages do not create a second
persistent cache. Duplicate IDs, ordering, acknowledgements and steering handoffs retain their
previous behavior.

Reproduce with `node scripts/benchmark-pending-messages.mjs --baseline-ref HEAD`, using a reference
before the optimization after committing. The script checks 2,000 deterministic equivalence cases
and measures 100- and 20,000-message histories across pending, foreign-task, steering and mixed
batches. One local run over 20,000 historical messages measured:

| Projection workload         |    Before |     After |
| --------------------------- | --------: | --------: |
| One pending preview         | 0.0336 ms | 0.0333 ms |
| 20 pending previews         | 0.5980 ms | 0.2585 ms |
| 100 pending previews        | 2.7532 ms | 0.3309 ms |
| 100 steering handoffs       | 7.1174 ms | 0.4946 ms |
| 100 mixed previews/handoffs | 4.1844 ms | 0.3761 ms |

An initial four-lookup crossover regressed warmed-up small batches and was rejected. The final
20-lookup cutoff targets a clearer benefit for larger batches. Small workloads fluctuate: one
steering handoff measured 0.0478 to 0.0718 ms, so there is no claim of universal improvement. These
are isolated CPU benchmarks with JIT and host-load variation, not end-to-end rendering, native
frame-time or network measurements.

## Bounded browsing and diagnostics adoption, 2026-10-30

Files now requests one directory page at a time, up to 200 entries, with a 10,000-entry
per-directory scan ceiling. Content search is limited to approximately two seconds, 2,000 files, 16
MiB total, 1 MiB per file and 200 matching lines. Responses disclose truncation/skipped files.
Superseded content queries and folder navigation cancel their request and propagate cancellation to
runtime scanning. Composer filename suggestions keep their existing path cache.

A local five-read comparison on this checkout returned 3,391 paths / 170,192 JSON bytes for a whole
checkout listing versus 26 entries / 1,026 bytes for its root directory. The initial response is
about 99.4% smaller; median local server times were similar (10.3 ms versus 10.2 ms). This measures
response size and local read time, not phone frame times, network latency or complete-app speed.

Runtime diagnostics retain at most 32 completed expensive operations, 256 open operations and five
heap spike reports. A 128 MiB rise within approximately ten samples reports up to eight suspects,
with a 60-sample cooldown. The one-second sampler is unreferenced and stops with the runtime.
History, snapshot/sync serialization, diff/commit review, directory and content-search requests are
instrumented without recording request bodies or credentials. Linux child RSS is bounded to 512
processes and reports truncation; shared pages can be counted more than once. Other platforms report
child memory as unavailable. Reports aid investigation and do not prove an operation leaked.

Conversation reading positions use a separate 100-thread in-memory navigation cache with stable
anchors. It avoids discarding the user's place when changing threads; it does not persist messages
or credentials to disk. Native list behavior still requires device verification.

## Memory and energy follow-up (2026-10-30)

Usage transcript scans cap individual JSONL records at 4 MiB. Oversized records are discarded
through the next line boundary, including across incremental reads, with an explicit
incomplete-usage notice. The retained scan cache allows at most 128 files and approximately 32 MiB
(including partial buffers and duplicate usage rows). Cached result arrays allow approximately 8
MiB. Larger requests still return complete parsed results but are not retained; evicted files are
rescanned on demand. Scans and results expire after five idle minutes using one unreferenced expiry
timer, without periodic maintenance. These are retention limits, not a bound on the memory required
to produce a large usage response.

Mobile conversation history now uses the same whole-message retention logic as desktop with a 6 MiB
approximate budget. Recent 500 messages and the current reading range plus a small scroll buffer
remain protected and can exceed the budget. Moving toward newer content releases older pages; their
cursor remains available for reloading. History restoration and pending loads are protected from
trimming. List virtualization by itself does not release message data.

Widgets and Live Activities select semantic task changes through the existing runtime selectors.
Text, token counters and streaming timestamps no longer repeat task-wide projections. Status,
activity, title, queue length, turn identity, input requests and preparation still update these
surfaces. Widget ordering within input/pin priority uses creation time, so streamed update times do
not reshuffle its items. The selector keeps only weak references to task signatures.

Fallback polling parks without a recurring timer while live sync is healthy, and desktop fallbacks
also park while hidden. Status, disconnect, network and visibility events wake the same owned
worker, preserving coalescing and backoff. Native desktop browser visibility retains its 250 ms
occlusion watchdog while pages are tracked; with no tracked pages it schedules no watchdog. Direct
WebContents lookup avoids repeated allocation and scans through all tabs.

Visible remote browser capture uses 30 fps during interaction and 15 fps after two seconds without
input. Motion frames are capped to the viewport and 1920 pixels per dimension during interaction,
1280 while viewing. Device-resolution detail stills remain available after input settles; hidden
viewers stop capture. These limits reduce requested capture work; they are not measured energy
savings and do not identify whether page content itself is consuming CPU.

Runtime diagnostics include external memory, ArrayBuffers (a subset of external memory), GC count
and duration, and event-loop utilization since monitoring began. Buffer growth can trigger bounded
spike reports independently of JavaScript heap growth. Sampling slows from one second during
instrumented expensive work to ten seconds while idle; disposal releases timers and the GC observer.
Existing heap-attribution caveats still apply, and child RSS totals can double-count shared pages.

Verification:

```sh
pnpm exec vp test packages/runtime/src/storage/usage-transcripts.test.ts packages/runtime/src/diagnostics/memory-attribution.test.ts packages/client-runtime/src/effects/polling.test.ts packages/extension-tasks/src/chat/thread/history-retention.test.ts apps/mobile/src/runtime/connection/task-surfaces.test.ts
pnpm exec playwright install chromium
pnpm test:mobile-history-memory:browser
pnpm test:mobile-energy:browser
pnpm test:remote-browser-sessions:browser
pnpm benchmark:workspace-memory
```

A synthetic unfinished-record probe retained approximately 8 MiB and then 16 MiB of ArrayBuffers
before these limits. With the capped reader, after stream cleanup and explicit GC, ArrayBuffers
returned to the same 0.09 MiB baseline after both writes while the reader remained alive. Temporary
allocation peaks still occur during file I/O. The 400-task / 100,000-message workspace fixture added
approximately 2.01 MiB of idle JavaScript heap; it does not represent the installed runtime's total
memory or a physical-device energy measurement.

Browser lifecycle fixtures use mocked native surfaces; they establish cancellation and update
behavior, not phone battery consumption. Physical-device energy recordings and comparable idle and
active profiles of the updated installed app remain necessary to quantify savings. An earlier sample
of installed nightly.594 during agent work is not a baseline for this checkout's results.

## Completed Markdown reuse (2026-10-30)

Desktop chat rich parts and native Markdown parts now reuse completed preprocessing across
navigation and remounts. Each renderer retains at most 256 entries within a 2 MiB estimated budget,
including source text and part strings. Entries above a quarter of that budget are not retained.
Streaming prefixes bypass the cache. Shared parts are recursively read-only and frozen; React
elements, runtime parsing, task callbacks and resolved repository URLs are not cached here.

Run `node scripts/benchmark-markdown-parts-cache.mjs` with the repository's Node version. The script
asserts output equality, includes initial splitting/freezing in cached timings and measures retained
heap after explicit GC. A 120-message, 177,242-character workload remounted 20 times performs 120
splits with reuse versus 2,400 without it. Example local runs measured desktop preprocessing at
2,085–7,905 ms without reuse versus 91–454 ms with reuse, and native splitting at 3,219–12,525 ms
versus 179–613 ms. Concurrent build/test load inflated absolute timings; these are synthetic
preprocessing measurements, not native frame times or whole-app speedups.

The 1,500-message churn fixture retained approximately 552 KiB on desktop and 690 KiB for native
parts with the default budget. Streaming-prefix retained heap measured zero after GC. The budget
estimates retained data rather than enforcing an exact V8 heap allocation cap; parsing and temporary
allocation can exceed it. Results do not quantify battery savings.

## Streaming history search indexing (2026-10-30)

Provider runs defer derived search text until the last authoritative message flush, including failed
and cancelled turns. A durable pending list supports live searches and restart reconciliation;
message JSON and paging metadata continue to commit normally.

The SQLite regression in `conversations-streaming.test.ts` writes growing assistant text 100 times,
checks live multiword/accent/short-query results after each save, then settles the run. Database
triggers count actual writes:

| Work                          | Immediate indexing | Deferred indexing |
| ----------------------------- | -----------------: | ----------------: |
| Authoritative message updates |                100 |               100 |
| Derived search-text updates   |                100 |                 1 |

Additional checks exercise edited/reordered messages, pagination, independent run owners, rollback,
failed reconciliation, deletion and an abruptly terminated writer. This establishes less derived
index work for that workload. It does not measure full-app latency, retained heap or battery use.

## Retained streaming pages and background work (2026-10-30)

Paged snapshots check their summary projection cache before reading a history page. When the
existing bounded history cache holds the committed conversation, paging reuses its message and
checkpoint objects. Cold conversations still read one SQLite page and do not enter the full-history
cache. Turn lookup indexes are weakly keyed by immutable turn arrays; sync comparisons recognize
arrays containing the same objects before serializing their contents. SQLite remains authoritative,
including after rollback, eviction and destructive history edits.

Reproduce the isolated page comparison after building the runtime and dependencies:

```sh
node scripts/benchmark-streaming-history-pages.mjs
node scripts/benchmark-agent-tools-memory.mjs
```

The fixture compares SQLite and retained-history pages over 120 growing-message updates, checking
exact output equality after every update. It measures page construction only and excludes writes,
snapshot enrichment, transport and rendering. Lifecycle fixtures and reduced request counts do not
establish physical-device battery savings. Device Hub currently reports the physical iPhone
unavailable; the available iOS simulator cannot provide equivalent energy measurements.

One local run measured median SQLite page construction at 2.374 ms versus 0.018 ms with retained
objects, with zero mismatches. Three fresh-process samples per import mode measured median bridge
RSS at 189.8 MiB with the broad imports versus 133.8 MiB with the narrow entries; collected heap
fell from 45.55 MiB to 33.35 MiB. Median initialization/tools-list time fell from 486 ms to 324 ms.
All 21 tool definitions produced identical JSON hashes. The baseline uses Node import hooks to
restore only the old package imports in the same compiled bridge. These are isolated synthetic
measurements, not whole-runtime memory or startup guarantees.

Per-agent MCP bridges import dedicated protocol and terminal-input entries instead of the full
package barrels. The import-graph regression checks the transitive graph as well as exported schema
identity. Isolation and tool authorization are preserved. Unchanged live shared threads compare
their title and committed history identity before hydrating or hashing content; authorization still
runs on every tick, and artifact feeds retain their own refresh cadence.

Signed-in sharing recovery uses a five-minute settled cadence, a ten-second unsettled cadence and
exponential failure backoff capped at five minutes. Hidden documents park the worker; returning to
the foreground or an explicit refresh wakes it immediately. This trades up to five minutes of
background cross-device recovery latency for fewer network and encrypted-key reads. Accounts remain
optional. Separate renderer windows still own separate clients.

Hidden conversation MCP tool connections park once their pending calls finish. Foreground/route
visibility controls the native bridge even when an HTTP runtime still reports connected. Returning
reconnects and advertises the same tools. Embedded iframes/WebViews stay mounted to preserve state;
arbitrary JavaScript timers inside third-party apps are not suspended. Covered mobile terminal
viewers release their connection without stopping the server PTY and replay retained output on
return. Desktop terminal attachments retain their existing behavior.

Desktop file drafts use an approximately 50 MiB aggregate admission budget, including clean editor
reservations. Existing active edits may grow beyond it; additional editors wait until drafts are
saved, shrunk or explicitly discarded. Failed and in-flight saves retain their contents. A draft
tray exposes unsaved files across task/checkout scope changes with download and discard actions.
Ordinary browser windows use an unsaved-work guard. Drafts remain window-local and are not
automatically persisted across restarts. Electron keeps its existing shutdown behavior; save or
download drafts before closing it. This avoids adding source-text storage or encryption work while
typing; the budget never silently evicts edits.

## Idle processes, conversation grouping and visibility (2026-10-30)

The shared headless Chromium retires after 60 seconds with no open or pending shared contexts and no
queued artifact renders. Context acquisition waits for an in-progress retirement; disconnected
callbacks from an old browser cannot clear a replacement. Persistent signed-in browser profiles keep
their existing ownership. The next thumbnail, export or private browser request relaunches Chromium,
trading a cold startup for releasing its idle child processes.

Reproduce the real browser lifecycle check with the managed Playwright browser:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec playwright install chromium
node scripts/check-runtime-browser-idle.mjs
```

An isolated Linux run retained seven Chromium processes at 250.1 MiB total proportional set size
after rendering one HTML thumbnail. The idle deadline released all seven (0 MiB); a subsequent
request relaunched the browser and returned an identical image. This excludes the runtime's own
memory and does not establish whole-app or physical-device battery savings.

Upstream MCP sessions retire after ten idle minutes, checked by the existing one-minute cleanup
worker. Running threads, leased calls/feeds and attached app views protect their sessions. A later
call reconnects and rediscovers tools with the same configuration and permission checks. State held
only in a third-party server's process is lost when that server retires; persisted thread and app
data remain. Shutdown and capacity handling must retain ownership of transports still closing.

Conversation ownership parses each timestamp once and indexes legacy scan boundaries instead of
revisiting overlapping ranges for every turn. Presentation reuses the ownership calculation for
grouping. Equivalence checks cover 2,000 generated histories with unordered/missing timestamps,
duplicate message/turn IDs, retries and explicit ownership. In a 2,000-message/1,000-turn synthetic
history with identical timestamps, presentation date parsing fell from 2,002,000 calls to 3,000. One
local presentation comparison was 308.8 ms before versus 2.2 ms after; ordinary standalone ownership
calls can pay a small extra indexing cost. These are isolated workloads, not native rendering
timings.

Waiting-items, sharing and sharing-people readers park recurring work while their document or owning
view is hidden and refresh on return. Visibility does not reset request ownership or discard queued
explicit unlink actions. Already-running requests may finish. Periodic sharing recovery stays with
the account client's existing adaptive worker; settings opening and explicit recovery remain
immediate. Unchanged authoritative share-index metadata reuses decrypted content, fenced by client,
account session, source, recovery key and destination. Changed versions reopen the share.

```sh
node scripts/check-sharing-waiting-lifecycle-browser.mjs
```

Project icons still check candidate precedence and containment every 30 seconds, but reuse the
thumbnail when the selected real file and its size/inode/timestamps are unchanged. The 256-entry
cache also drops inactive sources after five minutes beyond freshness. Successful Git identities
refresh every five minutes instead of every minute; unavailable identities retain their shorter
15-second retry interval. App-driven config/remote changes and branch switches invalidate cached
identities, and identity-sensitive settings, transfer and worktree creation paths force fresh reads,
including when an older read is pending. External config changes, including conditional includes,
appear after the next five-minute revalidation and subsequent snapshot refresh.

Across 40 polls spaced 15 seconds apart over ten simulated minutes, an unchanged synthetic project
performed one icon encode instead of 20 and four Git identity commands instead of 20. Snapshot
presentation also shares a single final defaults clone across projects. These counts exclude active
Git work, external changes and explicit refreshes.

## Idle triggers and native delegation measurements (30 October 2026)

GitHub triggers keep committed state in memory and only sweep stale documents when enabled flow
identities change or the runtime starts. A controlled ten-minute replay (600 one-second ticks) with
no configured GitHub flows made one SELECT rather than 600. One idle flow retained ten minute-spaced
network polls with thirteen total SQL statements. Queued deliveries still retry every second;
configuration changes, disable/re-enable, restart and failed state writes have regression coverage.
This measures scheduler database work, not device battery consumption.

Upload recovery receipts stop pinning attachment bytes when a device is revoked or a thread has a
durable deletion marker and no stored task row. Missing hydrated tasks are not treated as deleted.
Live references and legitimate lost acknowledgements retain their data; upload IDs remain immutable.

Native child updates were replayed through the real run-turn callback, file-backed SQLite WAL and
public projections, with a controlled provider instead of a live model process. The workload had 100
threads, eight children, 1,001 parent messages and twelve parent files. For 200 updates, medians
across seven warmed rounds measured 1,086.7 ms for the update/projection loop, including 934.8 ms of
native-event handling and 148.6 ms of public projection/bookkeeping. There were 200 metadata writes
and commit notifications, 26,711,120 serialized metadata bytes, and zero history rereads or writes.
Metadata serialization accounted for 40.7 ms; SQLite statement execution accounted for 27.2 ms and
excludes transaction commit/fsync.

A sibling-reuse prototype reduced changed public child-object identities from 1,600 to 200. In an
alternating paired comparison, median wall time was 844.5 ms before and 895.0 ms with the prototype;
CPU was 497.6 versus 488.9 ms. It did not establish a useful throughput improvement and was removed.
Authoritative writes remain synchronous and durable. Object identity counts are projection proxies,
not measured React Native renders; concurrent host work affects timings. These results establish no
app-wide memory, latency or battery improvement. The temporary probe and measurements are retained
under `/tmp/dovo-native-update-profile` for this workspace session.

## Mobile image parsing and bounded browser uploads (30 October 2026)

Mobile Markdown image extraction returns its existing single text part immediately when there is no
literal `![`. Ordinary prose and links no longer pay for an image AST traversal at every streamed
update. An alternating, seven-round Node prototype over 100 updates with a 9,630-character prefix
measured splitter medians of 878.1 ms before and 580.2 ms after this guard (about 34% less elapsed
preprocessing time); 792 streamed-prefix comparisons matched. This is the investigation's controlled
prototype measurement of the same guard, not a native frame-time, memory or battery measurement.
Production regressions cover empty text, references, unfinished images, escaped syntax and fences.
The remaining rich-Markdown parsing work has not been replaced or cached speculatively.

Remote-browser selection reads at most four 64 KiB file slices per acknowledgement batch instead of
allocating a full-file base64 string. Runtime upload admission bounds retained command payloads to
eight commands per tab and stages bytes in private disk files. A tab has a shared 50 MiB file budget
(pending and committed) and fifty retained files, with at most five per selection. Committed handles
close immediately, but their paths remain until document replacement or session close so Chromium
can read files when a form submits later. Staging expires after ten minutes. Cancellation
invalidates queued commits before waiting for disk IO. Socket disconnect and normal session cleanup
release pending transfers; successful selections survive a disconnect in their still-live document.
Normal cleanup does not imply recovery after an abrupt process crash.

Native picker handoff preserves the connection while Android backgrounds the app for document
selection and requests hidden-stream suspension. Screen navigation and unmount still disconnect.
Installed-device behavior and device battery usage have not been measured for this change.
