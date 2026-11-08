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
pnpm benchmark:replication
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
measurements exclude migration. This benchmark constructs WorkspaceStore alone; it does not include
the runtime replication journal or measure total runtime memory.

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

## Shared thread replication

The runtime journal reads records after its current sequence. A transaction saves new records and
checkpoints together. A sequence index lets integrity checks count records without reading message
bodies. The library keeps indexes for known versions, current values and the logical clock.

String-store adapters use content identities to skip unchanged snapshots. No-op transactions keep
the stored string. A changed write still serializes the full archive in native and browser JSON
stores. The runtime SQLite adapter writes only new records.

The thread list applies one page limit to local and shared threads. History queries use an indexed
position and message-ID cursor. Each query reads at most 41 records for a 40-message page. After an
offline gap, the client replaces a cached window that does not overlap the new window. This keeps
older pages in order.

Desktop shared threads use the existing conversation scroll and deferred rendering controls. Distant
messages keep their measured height and release their content. Mobile shared threads use FlatList.
Both views reject older pages when their cursor or history revision no longer matches.

Build the runtime and its dependencies. Then run `pnpm benchmark:replication`. The script checks the
SQLite and transactional JSON adapters. It uses 1,000 and 5,000 messages of 2 KiB each. It reports
median times for idle refresh, metadata edits, history pages and thread summaries. These checks use
CPU and in-memory storage. They do not measure native devices, network delay, startup or total
runtime memory. The journal still keeps recovery history. This change does not compact archives or
limit total journal memory.

Unreadable replication data disables that channel. The runtime reports the error and keeps the
records for recovery. It does not rebuild the journal or reuse old peer cursors automatically.

Shared settings now use the same incremental storage approach. The outbox query reads versions after
a SQLite row cursor. It does not parse all prior settings on an idle exchange. The benchmark also
measures refresh and capture with 1,000 and 3,000 historical settings versions of 8 KiB each. On
this review host, the 3,000-version median fell from 269.5 ms to 0.15–0.42 ms across isolated and
concurrent check runs. These are CPU and in-memory SQLite measurements. They do not measure network
or native disk latency.

Automatic saved-action recovery shares one in-flight attempt per connection credential. Retry
backoff starts at one second and grows to 30 seconds. Explicit retry bypasses the wait. A healthy
live stream can replace its list baseline without a parallel HTTP snapshot read. This suppresses
fallback for at most ten seconds; a failed replacement resumes fallback immediately.

The Chromium durable-state fixture also mounts the mobile draft hook. It checks that renaming
another computer preserves the draft, and changing the draft computer's token starts a new scope.
This checks browser React behavior. It does not establish native keyboard or device behavior.
