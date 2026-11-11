# Performance verification

## Working-tree Changes reads, 2026-11-11

Working-tree previews now share one operation-owned `git cat-file --batch` reader. Git status and
HEAD checks run together. Successful HEAD checks no longer need an extra `ls-files` process. The
reader returns bounded raw bytes, so binary and UTF-8 checks keep their existing input. Failed batch
replies retain the individual-blob fallback. Cleanup closes the pipes as well as the process; a
malformed reply cannot leave an unread stdout pipe blocking cleanup.

On one frozen checkout with 67 changed files and 31 embedded old blobs, 15 warm samples reduced
median Changes time from 180.5 ms to 41.6 ms. The old path read 31 blobs with separate processes;
the new path used one batch process. Both versions returned 1,662,959 JSON bytes with the same
SHA-256 digest, `62c4be154b4db0da56ed89d67fd7ee2a03103837e21735a2aef637117f211b8e`. These figures
measure the production Git service on this Linux host. They exclude HTTP, sync and UI.

```sh
node scripts/benchmark-git-changes.mjs /path/to/unchanged-checkout --baseline-ref b6cb40ccd32d8816821c4144bb43f602411d276f --runs 15
node scripts/benchmark-git-changes.mjs /path/to/unchanged-checkout --runs 15
pnpm exec vp test packages/runtime/src/scm/git/git.test.ts packages/runtime/src/scm/git/cat-file-batch.test.ts
```

Compare both versions against the same checkout without edits during the runs. Checks cover binary
and image classification, UTF-8 bytes, preview limits, file order, symlinks, missing objects, failed
batches, malformed replies and cleanup.

Thread clients now set `includeFiles: false` when they only need to refresh the saved Changes. The
endpoint scans and commits the files before returning `{"ok":true}`. Live sync delivers the changes.
An unchanged scan keeps the file array and review versions. The normal endpoint still returns files.
The refresh decoder accepts both replies, so older runtimes need no extra probe. The option requires
a task ID. Repository previews and mobile reads that use the returned files keep full replies.

In the synthetic 50-file review fixture below, this removes a discarded 4,832,201-byte JSON reply
(60,311 bytes with gzip). The acknowledgement is 11 JSON bytes and does not meet the server's gzip
threshold. This removes the duplicate response; a changed file still reaches clients through sync.
The actual checkout response above has different content and compression. Lazy file-body loading
remains separate work.

## Review hashing and storage writes, 2026-11-11

A viewed edit previously compared SHA-256 fingerprints for every old and new file. Storage now
compares the exact fingerprint inputs: before/after text and preview identity. Unchanged file
objects take an identity check. Content changes still clear the mark and advance its version.
Version checks still reject ABA writes from another client.

Review reads on desktop, mobile and the runtime reuse fingerprints by weak file identity. The cache
also checks path, text and preview identity before reuse. In-place text or nested preview changes
cannot return an old digest. Fingerprint bytes remain compatible with saved marks.

Task-row storage caches serialized file arrays separately from the small metadata. Title, draft and
streaming updates no longer encode unchanged review bodies. Rows retain storage version 3, with
files and history counts committed in the same transaction. This does not reduce SQLite journal
bytes or change save timing.

Controlled results on this Linux host, using 50 files and a 4,832,191-byte file array:

| Measured operation                      |   Before |     After |
| --------------------------------------- | -------: | --------: |
| Viewed-version bookkeeping              | 22.15 ms |  0.010 ms |
| Viewed update, in-memory SQLite         | 28.79 ms |   5.59 ms |
| Repeated review fingerprint list        | 13.02 ms | 0.0046 ms |
| Metadata update, file-backed SQLite WAL |  4.26 ms |   2.03 ms |

These are warm medians. The in-memory baseline was captured before these changes. The file-backed
comparison isolates serialized-file reuse; both versions already have the review bookkeeping fix.
The disk fixture used about 10.16 MB of WAL for 50 title edits before and after. Changed file arrays
still require serialization. Default-settings projection in the 163-byte default fixture took 0.017
ms, so this change adds no cache for defaults. Larger settings remain unmeasured.

```sh
pnpm --filter @dovo/runtime... -r build
pnpm --filter @dovo/runtime exec tsx ../../scripts/benchmark-review-storage.mjs
pnpm --filter @dovo/runtime exec tsx ../../scripts/benchmark-review-storage.mjs --disk
node scripts/benchmark-review-sync.mjs --baseline-ref b6cb40ccd32d8816821c4144bb43f602411d276f
node scripts/benchmark-review-sync.mjs
pnpm exec vp test packages/protocol/src/scm/review.test.ts packages/runtime/src/storage/file-review-versions.test.ts packages/runtime/src/storage/conversations.test.ts packages/runtime/src/storage/workspace.test.ts packages/runtime/src/http/file-reviews.test.ts packages/runtime/src/http/scm-mutations.test.ts
pnpm exec playwright install chromium
node scripts/check-remote-thread-sync-browser.mjs
```

SQLite tests cover reload, escaped file content, streaming, changed bodies, removals and failed
commits. The real HTTP/Git test covers full and acknowledgement replies, stable rescans and changed
files. The Chromium test checks that the acknowledgement still publishes files through the real
HTTP/WebSocket client. Timings exclude native UI, physical-device storage and provider startup.

## File-review sync and snapshot tags, 2026-11-11

Format 7 sends file order and changed file fields. A viewed flag no longer sends every file body.
New clients opt in with `files=1` on the existing scoped sync ticket request. Older clients and
runtimes keep their format. Desktop window updates use the same patches. Unchanged files keep object
identity. Deletion, rename, reorder and optional-field removal remain explicit. Invalid baselines
cause a fresh sync. Duplicate paths retain the full-array fallback.

The controlled fixture has 50 files with 31,779 source characters each and three body fields. The
raw delta for one viewed flag fell from 4,832,304 bytes to 167 bytes. Median delta creation fell
from about 10 ms to 0.024 ms. These figures exclude SQLite, compression, transport and rendering.
The real HTTP/WebSocket runtime check in managed Chromium received a 456-byte decoded review frame,
including review-version metadata, and kept the unchanged file object. These are application JSON
bytes. WebSocket compression and headers change actual wire bytes.

Snapshot tags reuse hashes of unchanged task fields and workspace collections. Runtime state still
gets read on each tag. All caches use weak object keys. The same fixture reduced warm streaming tags
from about 4 ms to 0.008 ms. Cold tags still read all content: the review fixture stayed near 3.2
ms, and a 2,500-message fixture took about 0.60 ms versus 0.51 ms before. The `sync tag` diagnostic
span now records tag work separately from snapshot and delta work.

```sh
node scripts/benchmark-review-sync.mjs --baseline-ref b6cb40ccd32d8816821c4144bb43f602411d276f
node scripts/benchmark-review-sync.mjs
pnpm exec vp test packages/protocol/src/runtime/connection/sync.test.ts packages/protocol/src/runtime/connection/live-sync.test.ts packages/runtime/src/http/support/body.test.ts packages/runtime/src/http/runtime-sync.test.ts packages/runtime/src/http/file-reviews.test.ts apps/desktop/electron/runtime-connections.integration.test.ts
pnpm --filter @dovo/runtime... -r build
pnpm exec playwright install chromium
node scripts/check-remote-thread-sync-browser.mjs
node scripts/check-mobile-metro-modules.mjs
```

The real runtime checks cover negotiation, old-client fallback, separate replay views, reconnect and
selection changes. The desktop integration checks the shared stream through window reconciliation.
The Metro check validates the iOS transform in a Node VM. It does not run Hermes on a phone.
Physical-phone latency and lock/unlock behavior remain unmeasured.

## Independent requests and thread Send barriers, 2026-11-11

Known pure reads no longer wait for unrelated workspace writes. Reads of a changed project or thread
still wait for its saved edits. Unknown endpoints and mutations keep the barrier. Send waits for
captured edits to its own thread. Shared settings also keep all earlier edits in order: moving
threads must finish before deleting their project. The sender continues unrelated thread edits after
the action can proceed. A request already on the wire keeps its place. Failed writes stay in durable
storage.

The durable command journal allows foreground commands for different threads to overlap. Each thread
keeps one ordered sender. Shared commands, recovery, credential changes and discard keep an
exclusive host barrier. Local journal writes remain atomic. A rejected command blocks its own
thread; credential review and unknown shared commands still block the host. Stop retains its
existing direct path. This adds no delay to navigation or Send.

Run the focused checks and controlled comparison:

```sh
pnpm exec vp test packages/protocol/src/runtime/connection/mutations.test.ts packages/protocol/src/runtime/connection/request-ordering.test.ts packages/studio-core/src/runtime/synchronization.test.ts packages/extension-tasks/src/chat/composer/composer-selection.test.ts
node scripts/benchmark-command-barriers.mjs --baseline-ref b6cb40ccd32d8816821c4144bb43f602411d276f
pnpm exec playwright install chromium
node scripts/check-startup-performance-browser.mjs
```

With ten distinct-thread edits and a simulated 150 ms response per edit, the controlled comparison
reduced the action wait from about 1,515 ms to 307 ms. It waits for the in-flight request and its
own edit. Other edits continue in the background. These are JavaScript and mocked transport timings,
not installed-app or phone latency. The Chromium check uses the real workspace provider with held
mock HTTP writes. It confirms that both active and explicitly routed PR reads can finish during a
held workspace write.

The desktop composer subscribes to the agents, projects, connection, questions, defaults and
capabilities its controls use. Streamed messages and unrelated task metadata do not invalidate that
subscription. Its own task props and control changes can still cause a render.

## Combined new-thread commands

Runtimes advertise `threadStartSupported`. A first message can carry `createTask`, so the same
durable command creates the draft and accepts its input. Mobile workspace starts navigate after
durable local admission, before the network reply. Desktop startup commands also use this path when
no draft has been saved. Normal desktop typing keeps its existing immediate draft save and then
sends to that saved thread. This change does not delay draft saving to force a combined request.
Attachments and older runtimes keep their existing creation path.

The runtime validates creation through the workspace rules. It records a message identity and draft
fingerprint in the creation transaction. Retries cannot replace an existing draft or revive a
deleted thread. The client retains its command until a snapshot containing the message is durably
cached. An acknowledged deletion clears the projection only after a matching runtime cursor is
cached, with complete paging evidence. A lost reply and a runtime restart keep the same retry
identity.

```sh
pnpm exec vp test packages/runtime/src/http/endpoints/thread-start.test.ts
node scripts/check-desktop-thread-start-browser.mjs
node scripts/check-mobile-thread-start-browser.mjs
```

These checks cover the local HTTP/SQLite runtime with a mocked agent, and real client components
with mocked transport. They do not measure provider startup or physical-phone navigation.

## Mobile Markdown, PR reads and empty-composer Enter

Native Markdown reuses completed top-level fenced blocks during streaming. References, directives
and other document-wide syntax use a full split. The cache retains at most four anchors and one
million source characters. No stream delay was added. Run:

```sh
pnpm exec vp test apps/mobile/src/ui/content/markdown-parts.test.ts
node scripts/benchmark-mobile-markdown.mjs --baseline-ref b6cb40ccd32d8816821c4144bb43f602411d276f
node scripts/check-pull-intent-prefetch-browser.mjs
node scripts/check-desktop-source-readers-browser.mjs
node scripts/check-composer-send-browser.mjs
node scripts/check-question-attachments-browser.mjs
```

The host benchmark matched both versions over 107,096 streaming prefixes. For a 34 KB mixed message
in 40-character chunks, median preprocessing fell from 25.4 ms to 0.92 ms per update; p95 fell from
73.6 ms to 1.8 ms. Prose remained about 0.03 ms per update. These figures measure JavaScript
preprocessing, not phone frame times. The mobile composer reads current controls from context. A
Chromium model with the real atom store reduced 20 task updates from 40 renders to 20 and removed
stale action renders. The native composer can still render once per streamed update.

PR and Jira reads reuse live session identity verification. Saved identity data alone never counts
as verification. Each data read still sends the account and destination guards. A rejected guard
reports the mismatch. Collection readers also recheck live identity. Forms and PR URLs keep their
pinned account and destination. PR rows prefetch only the overview after 150 ms of sustained pointer
or keyboard focus. Clicks proceed immediately. The detail screen joins the same account-scoped read.
Leaving a row removes its waiter; shared HTTP work can still complete into the bounded cache.

Plain Enter in an empty focused desktop composer answers its single visible permission or question
request. The request must belong to the same thread and pane. Draft text, rich non-text content,
modifiers, composition, repeated keys and ambiguous requests do not use this shortcut. Question
validation still applies. Browser checks cover textarea and rich-editor markers; native mobile
hardware-keyboard behavior was not measured.

See [the next performance work](performance-research-2026-11-11.md) for measured Git and file-sync
costs, the recommended order and the remaining phone measurements.

## Thread Send admission and discovery

Desktop and mobile now use one live runtime discovery cache for model pickers, model mentions and
first-turn model selection. A first send reuses fresh availability and catalog results, including an
in-flight lookup. Account, executable, configuration and secret-reference changes still select
different cache entries. Explicit refresh updates the same cache. Stored presentation data never
counts as live availability.

The message endpoint returns after it saves input and admits its owned worker. Tune/Maestro model
selection and checkout preparation continue in that worker. Stop also cancels the selection model.
Failures keep the accepted message in the queue for recovery. Progress and errors stay in the
thread. Preparation no longer holds the HTTP response or the client's sender for other threads.
Internal callers that need a prepared checkout still wait for it.

Pausing the queue or its first message during model selection leaves the message queued and stops
checkout preparation. A pause during checkout also prevents the provider turn. Pausing does not
invalidate the model choice. Stop still cancels selection, while Send now and steering retain their
explicit delivery behavior.

Scope project selection still finishes before admission. Queue-only staging also resolves its model
before returning. The selected model, reasoning level and project policy stay the same. A local
trace before the change showed about 4.9 seconds in automatic model selection before queue
acceptance; recent checkpoint measurements were 0.08–0.25 seconds. This is diagnostic evidence from
one computer, not a measured speedup or a latency guarantee. Provider inference and the first reply
still take time.

Codex server errors no longer wait for the one-second process-exit grace period. A local read-only
app-server probe returned a rate-limit error immediately with API-key authentication. The old
request helper then waited one second. Both optional metadata reads and required RPC errors now
return at once. Transport failures still wait briefly for the process exit reason.

Run these checks:

```sh
pnpm exec vp test packages/runtime/src/http/thread-start-discovery.test.ts packages/runtime/src/http/endpoints/message-resume.test.ts packages/runtime/src/http/endpoints/setup-routes.test.ts packages/runtime/src/http/endpoints/queue-routes.test.ts packages/runtime/src/agents/tasks/model-selection.test.ts packages/runtime/src/agents/tasks/tasks.test.ts
```

The HTTP tests hold checkout preparation until after Send returns. They check completion, failure
and cancellation during both model selection and checkout preparation. They also check retries,
rename preservation, and provider calls across picker requests, first sends, refresh and account
changes. They use a local runtime, SQLite and mocked provider adapters. They do not measure real
provider inference, WAN delay or phone performance.

## Mobile wake and website auth windows

The mobile root only applies keyboard spacing for a nonzero keyboard frame while the app is active.
Sleep clears that spacing without replacing the navigator, thread or composer. This handles empty
keyboard events from the native shortcut responder. Run
`node scripts/check-mobile-tabbar-browser.mjs` to check zero-height frames, sleep/wake and draft
retention through mocked native events. A physical iPhone lock/unlock test is still required to
confirm the reported black-screen issue.

Website auth popups use the control-less browser shell and the shared page code. They keep the
opener's profile and extensions. Electron's original guest preserves POST data, `window.opener`,
`postMessage` and `window.close`. These temporary windows close their page instead of returning it
to the main window. Run
`pnpm exec vp test apps/desktop/electron/browser.test.ts apps/desktop/electron/browser-window.test.ts`
for mocked boundary checks. The native smoke command is
`xvfb-run -a node apps/desktop/scripts/check-browser-extensions-native.mjs` on Linux. The native
smoke passes in two fresh Electron 45.2.3 processes with the Chromium sandbox enabled. It checks
popup adoption, the control-less shell flag in preload, the profile, extension content scripts, the
opener and cleanup after `window.close()`. Real Google sign-in and arbitrary extensions remain
unverified.

## Workspace and conversation reads

Task summaries and complete conversations have separate types and storage paths. Workspace reads and
metadata edits use summaries. Operations that need messages or checkpoints explicitly request a
complete task; SQLite remains authoritative, and complete histories use a cache capped at 32 tasks
and approximately 64 MiB. The most recently accessed history remains available if it alone exceeds
that budget. Legacy snapshots and exports still include complete conversations.

Thread lists load settled summaries in pages of 25 when sorted by priority or activity. The Settled
count includes visible top-level threads and omitted top-level threads. Paging keeps known thread
families, side chats and sample records available so grouping and hidden drafts remain stable.
Snapshots include the logical identities of omitted threads in `olderSettled.threadKeys`. Desktop
and mobile use these identities to count each omitted thread once across computers, replicas and
connection aliases. This adds one identity per omitted thread, without loading its summary or
conversation. Older runtimes that return only `olderSettled.omitted` retain the scalar fallback;
exact counts across replicas require updated runtimes.

Run `pnpm exec playwright install chromium`, then
`node scripts/check-thread-section-order-browser.mjs` to check the desktop count before and after
loading more history. The fixture uses the real pager and sidebar with test rows and transport. Run
`pnpm exec vp test packages/protocol/src/tasks/settled-page.test.ts packages/runtime/src/http/support/runtime-snapshot.test.ts packages/runtime/src/storage/thread-replication.test.ts`
to check paging and the runtime response.

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

Checkpoint Git previews share one operation-owned `cat-file --batch` process and bounded blob cache.
Identity and icon caches cap at 256 entries. OpenCode clients expire after five idle minutes and cap
at 128 idle entries; active clients retain their shared identity until release. Terminal output uses
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

### Mobile local interaction under poor connectivity, 2026-11-01

New thread opens from the selected computer's cached workspace while disconnected. Local draft
project/computer selection uses cached settings, without remote mutation calls. Start in background
advances after durable outbox admission, keeping network recovery separate from the next draft.
Legacy sends without local admission still wait for acknowledgement and preserve their retry ID.

After installing Playwright Chromium, reproduce with:

```sh
node scripts/check-mobile-background-start-browser.mjs
node scripts/check-mobile-draft-transition-browser.mjs
node scripts/check-mobile-composer-actions-browser.mjs
node scripts/check-mobile-registry-recovery-browser.mjs
```

The background-start fixture exercises real conversation actions and the durable mutation queue with
fast, held and failing transports. All three admit the message without any network request; a second
message can be saved while the recovery worker holds the first response. A failed local write
preserves the draft and does not advance. The provider fixture also verifies ordered recovery and no
extra snapshot download after live actions. The route and composer fixtures check cached offline
creation, draft preservation and local project selection. These are functional browser checks with
native controls adapted; they do not measure phone frame times or establish identical remote
execution, upload or new-content latency across networks.

### Mobile cached startup and Markdown, 2026-11-01

Cached mobile startup and foreground resume wait for the live stream's first connection attempt
before enabling HTTP snapshot fallback. Existing ticket/socket deadlines and failure statuses wake
fallback; no extra grace timer is added. An uncached workspace still starts its HTTP read
immediately. The real-provider browser fixture reproduces one redundant snapshot read before this
change and zero during a successful cached startup or resume afterward. Failed and unsupported
stream attempts each wake one HTTP read immediately. Reproduce with
`node scripts/check-mobile-registry-recovery-browser.mjs` after installing Playwright Chromium.

Native Markdown splitting shares one syntax tree for diagrams, fenced code and images. Fragments
with reference definitions still parse images independently because a definition across a fence can
change nested image/link syntax. Completed-message caching and unfinished-fence behavior remain the
same. Compare the split pipeline with a Git reference preceding this change:

```sh
node scripts/benchmark-mobile-markdown.mjs --baseline-ref HEAD
```

The benchmark uses current shared helpers in both versions, bypasses the completed-message cache,
and checks 107,096 exact outputs across streaming prefixes with local-file rendering on and off. On
the Linux development host with Node 26.8.1, median preprocessing time for a 34 KB reply mixing
diagrams, code and linked images fell from 68.72 ms to 45.91 ms. Adding citations produced 35.6 KB
and fell from 78.22 ms to 53.32 ms. Ordinary inline prose stayed at 0.09 ms. These are isolated
JavaScript preprocessing measurements, excluding native Markdown layout, image decoding, network
latency and phone frame times. They do not establish installed-app rendering performance.

### Mobile history traffic and slow sync clients, 2026-11-01

Mobile opening uses restored history or at most one additional bounded page after the newest reply
lays out, rather than filling 500 messages automatically. Larger windows remain accessible by
scrolling and reading-position/bookmark restoration. Already loaded windows still refill after an
active conversation's gap or revision change; stale offline history never bridges a gap. The
500-message persistent cache and protected reading ranges keep their existing bounds.

In the real-hook browser fixture, opening a thread with 6 KB messages fetched 10 pages / 3,030,359
JSON response bytes before this change and one page / 303,035 bytes afterward (90% less). This
counts application JSON before transport compression and excludes the initial live baseline. Cached
reopening performs no history reads. Reproduce with:

```sh
node scripts/check-mobile-history-memory-browser.mjs
node scripts/check-conversation-history-browser.mjs
```

Runtime sync pauses live writes when a socket has at least 64 KiB buffered. Individual frames can
exceed that window; subsequent updates wait for draining. If every ready reader of a view is backed
up, workspace changes coalesce into one delta from its last published state. A healthy reader
sharing the view continues normally. Each client tracks its own sent sequence so a lagging reader
can replay missing deltas, or receive a fresh baseline if the bounded replay cache has expired.
Heartbeats report that client's sequence, and activity changes coalesce separately. Device
revocation is still checked while sends are paused.

Real-WebSocket integration tests with simulated send-buffer pressure show 12 intermediate workspace
updates becoming one delta for a private backed-up view. Shared-view tests cover ordered replay,
replay-budget eviction, continued healthy-client updates and reconnecting without another baseline
after catch-up. Large current deltas still send directly to healthy clients even when too large for
the replay cache. These tests do not measure radio throughput or physical-phone latency.

```sh
pnpm exec vp test packages/runtime/src/http/runtime-sync.test.ts
```

Worktree creation with origin fetching now reads the branch catalog only after fetching, removing a
complete pre-fetch inspection whose result was discarded. The real Git regression checks one scan
instead of two while asserting the worktree starts at a commit newly added to origin. Checkout,
setup and network-fetch wall-clock times remain machine/repository dependent.

On the review host with Node 26.8.1, the Vite+ recursive runner failed with `spawn EINVAL` for the
root typecheck and build commands. The same package scripts passed using
`pnpm -r --no-bail typecheck` and `pnpm -r --no-bail build` directly.

### Thread handoffs and offline images, 2026-11-01

Clients opt into selection deltas in their live watch request. A thread switch can then patch the
connection's existing snapshot instead of downloading the whole workspace again. Handoffs identify
both the exact predecessor cursor and the destination view's cursor; subsequent updates and
reconnects use the destination. A lagging client whose sent snapshot is no longer retained receives
a full baseline. Older clients and runtimes retain the full-snapshot path. Rapid navigation applies
intermediate handoffs in wire order but only publishes the requested selection.

`node scripts/benchmark-snapshot-deltas.mjs` includes a synthetic 301-thread selection comparison.
With 300 unchanged drafts of roughly 1.3 KB each and a short destination reply, full JSON was
449,243 bytes and the handoff was 502 bytes. Independent level-3 raw deflate produced 8,307 and 268
bytes respectively (about 97% less compressed payload). This excludes protocol framing, runtime
capability/default metadata, physical network latency and rendering; large destination histories
still need transferring. A real-runtime WebSocket regression also compares handoffs with the full
baseline and checks exact state, later streaming, peer isolation, lagging-reader fallback and cursor
resume.

Activity listener replacement within one JavaScript turn preserves its baseline until the handoff
settles. Identical watches on the same socket are omitted. A regression replaces a populated
listener ten times: every replacement receives cached activity immediately with no additional watch
frames or reconnect. Final unsubscription still releases the cache, late activity is ignored, and
new sockets always send their subscriptions.

Mobile keeps successfully loaded thumbnails and sharper previews while their component remains
mounted and the paired source identity is unchanged. Going offline no longer hides the image, and
reconnecting or reopening its preview does not download it again. Failed and cancelled loads still
retry; changing source or pairing cannot show the previous image. This adds no persistent/shared
image cache. The native-component browser fixture covers three disconnect/reconnect cycles with zero
repeat reads, offline preview opening, explicit retry and cancellation. Physical-device image
decoding and radio usage were not measured.

```sh
pnpm exec vp test packages/runtime/src/http/runtime-sync.test.ts packages/protocol/src/runtime/connection/live-sync.test.ts
node scripts/check-mobile-server-images-browser.mjs
```

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

## Remote thread transfers, 2026-11-11

Format-6 sync sends patches for runtime metadata and individual turns. It avoids repeating settings
when only the selected thread changes, and avoids repeating checkpoint contents when a turn's token
count changes. Desktop window reconciliation uses the same patches. State-only deltas retain the
workspace object, and turn patches retain unchanged turns and checkpoints.

The isolated benchmark below compares the existing format with format 6. Both reconstruct the same
snapshot. The fixture has six turns with source-file checkpoints and a 16 KB setup command. Raw
deflate uses independent level-3 payloads; these are synthetic payload measurements.

| Update                 | Before JSON | After JSON | Before deflate | After deflate |
| ---------------------- | ----------: | ---------: | -------------: | ------------: |
| One turn's token count |     568,932 |        156 |         65,558 |           114 |
| Thread selection field |      17,127 |         74 |          2,258 |            68 |

The client also retains bounded recent selections and their exact cursors. A warm revisit replays
only missed updates. The real Chromium-to-runtime check reopened a changed thread with 651 decoded
application bytes versus a 184,251-byte saved snapshot. It used one socket and kept the checkpoint
object. Reconnect used the existing cursor without another full baseline. These checks use loopback
HTTP/WebSocket. They do not measure radio traffic, WAN delay, physical phones or cold app startup.
Shared-thread archive replication keeps its existing durable protocol.

The latency review with Fable 5.2 and Opus 5.5 added immediate replacement of obsolete pending
watches, cursor pinning until watch acknowledgment, cancellation of redundant HTTP fallback, and
protection against duplicate resume replay. Workspace commits now wake sync after 20 ms. Repeated
focus events share one pending resume. Cancelled navigation tickets do not start failure backoff. No
navigation debounce or client request queue was added.

With a held snapshot projection, 40 pending thread switches previously stopped making progress. The
real WebSocket regression now builds only the active view and the final view. Resume barriers,
scope-only updates and final activity subscriptions remain correct. Managed Chromium completed 40
rapid switches without another reconnect. The direct warm-selection fixture took 5.4 ms on loopback.
Twelve store commits reached the browser in 25.27 ms median and 27.90 ms maximum, including decoding
and the browser-to-test callback. These figures exclude rendering the complete Studio interface.

The synthetic navigation benchmark measures the real client microtask with simulated transport. It
compares JSON size accounting with bounded object size accounting. Both admitted the 761,472-byte
fixture with 300 summaries and 1,000 messages. Its first walk was about the same (0.52 vs 0.56 ms);
after one delta, median work fell from 0.45 to 0.04 ms. A cacheable 1.64 MB fixture fell from 0.96
to 0.11 ms. An oversized 8 MiB string fixture fell from 8.07 to 0.05 ms; both versions rejected it.
These are local synthetic results, not end-to-end application latency.

The browser fixture also exercises `prepareRuntimeTask` followed by screen subscription and old
lease release. After warming both singleton selections, the first overlapping pair transferred
180,797 bytes. The next prepared revisit transferred 269 bytes. The cache supports exact selections;
a new pair still needs detail transfer. The early-load and independent-pane behavior stays intact.
These tests do not measure physical-device rendering or WAN/VPN latency.

The next reconciliation pass removes lookup work for unchanged collections. A task field patch keeps
the message array without building a message lookup. A workspace metadata patch does not build a
task lookup. The synthetic apply benchmark compares `HEAD` with the checkout and checks that both
restore the same snapshot. With 10,000 retained messages, a draft-field patch fell from 0.4362 ms to
0.0060 ms median. Live sync pages history to at most 75 messages per thread, so the 10,000-message
case checks scaling; the saving on a normal live page is microseconds. With 10,000 task summaries, a
workspace address change fell from 0.4258 ms to less than 0.01 ms. These are isolated client CPU
costs, not complete UI timings. The change adds no timer, queue or protocol format. Message changes
still validate their baseline and preserve order. Run the same benchmark command below; see its
`reconciliation` results.

```sh
node scripts/benchmark-snapshot-deltas.mjs --baseline-ref HEAD
pnpm exec vp test packages/protocol/src/runtime/connection/sync.test.ts packages/protocol/src/runtime/connection/live-sync.test.ts packages/runtime/src/http/runtime-sync.test.ts apps/desktop/electron/runtime-connections.test.ts
pnpm --filter @dovo/runtime... -r build
pnpm exec playwright install chromium
pnpm test:remote-thread-sync:browser
node scripts/check-startup-performance-browser.mjs
```

See [Remote thread updates](runtime-client.md#remote-thread-updates) for negotiation, cache limits,
fallback behavior and the T3 Code references.

## Desktop thread handoffs, 2026-11-11

Each renderer now has its own IPC sequence and projected baseline. Thread selection changes use
patches, and unchanged source workspaces reuse their projection. Source changes can skip a window
whose detail is absent, then patch from its last delivered snapshot when detail returns. One
window's selection does not change another window's cursor.

Renderer watch changes merge within one microtask. The first subscription and explicit refresh stay
immediate. Foreground refresh passes the renderer cursor and keeps its baseline when IPC already has
the missing updates in order. Missing or invalid cursors still request a full baseline, including
when recovery must wait through an outage. A stopped owner cannot send a queued update afterward.

The native fixture compares the manager at `HEAD` with the checkout. It uses the production preload
source, two real Electron renderers and one HTTP fallback poller. Both runs retain the same thread
content and keep the popout live when the main window closes. The fixture has large conversation
bodies. These are decoded application bytes across IPC, including any fallback update that crosses
the measured operation; they are not compressed runtime network bytes or complete UI timings.

| Operation                                      | HEAD IPC bytes | Checkout IPC bytes |
| ---------------------------------------------- | -------------: | -----------------: |
| Drop the old thread after a two-thread handoff |        360,902 |                421 |
| Foreground refresh with a valid cursor         |        360,701 |                125 |

```sh
xvfb-run -a node scripts/check-desktop-runtime-connections.mjs --baseline-ref HEAD
xvfb-run -a pnpm test:desktop-runtime-connections
```

Use the commands without `xvfb-run -a` on a machine with an active display. The native fixture
supplies the synchronous app-info response used by the production preload and checks incremental
events, so it does not mistake a healthy stream of patches for missing snapshots.

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

Shared settings retain a separate revision for each edited category. The replication adapter stores
these categories as separate immutable values. Concurrent name and pin edits can both survive.
Legacy whole-entry records still load. Settings history joins category changes into past values;
restoring a past value commits all changed categories in one journal transaction.

### PR overview and panels, 2026-11-11

Desktop and mobile share identical in-flight PR reads within one runtime, pairing, project binding
and account. A versioned live result can serve adjacent reads for one second. This adds no wait to
navigation. An explicit refresh bypasses this reuse. If a background read is already running,
callers share one forced follow-up read. There is no queue of repeated refreshes.

The runtime returns a content version with opt-in PR section and overview reads. A later request
sends that version. Matching content returns a 99-byte JSON body. Clients retain the live object and
skip unchanged PR snapshot writes. Account and destination validation still run before the runtime
compares versions. Saved offline snapshots never authorize a conditional response. Older runtimes
return full responses through the same request; no capability probe is needed. Their in-flight reads
are shared, but the next open revalidates an unversioned result.

Descriptions and stacks poll every 60 seconds. Discussion polls every 30 seconds. Status and checks
poll every 10 seconds while work is running, every 30 seconds when settled, and every 60 seconds for
closed PRs. A clean diff pinned to both commit hashes needs no repeat read. Detail polling parks
while hidden or disconnected, but offline hydration still runs. Explicit refresh and foreground
resume force revalidation. A stale response without a refresh error uses a two-second follow-up
interval to collect the runtime’s background result promptly. Failed detail reads back off to at
most 120 seconds; explicit refresh bypasses the timer.

The overview retains loaded pages while page one is unchanged. It rechecks the whole loaded prefix
on the first available poll after 120 seconds. A changed page-one boundary, an error or explicit
refresh also rechecks that prefix. Failed later-page reads keep the previous coherent list and
retry. The existing overview timers remain 30 seconds on desktop and 10 seconds on mobile.

The desktop PR panel also retains pipeline capabilities for the captured project scope. Pagination
and summary polls reuse them. Explicit refresh rechecks them. Pipeline summaries poll every 30
seconds when settled and every 10 seconds when running. Each completed polling cycle sets the next
interval. One poller waits for offline hydration before its first read, so hydration cannot start a
duplicate read or replace a newer network result.

The comparison used T3 Code commit
[`79bca436b24a6eabb05d3d1a95348ae40d31e713`](https://github.com/pingdotgg/t3code/tree/79bca436b24a6eabb05d3d1a95348ae40d31e713),
including `usePullRequestDetail.ts`, `usePullRequestIntentPrefetch.ts`, shared query state and
`pullRequestChecks.ts`. Dovo uses the same useful patterns: shared reads, stable result identity,
separate sections and adaptive checks refresh. Dovo keeps a shorter running-check interval and loads
on navigation without a prefetch delay.

In the browser boundary fixture, one idle minute with a 16 KB description previously used 36 PR
requests, 595,908 JSON response bytes and 74 cache writes for one desktop panel. The updated fixture
uses two open consumers: desktop makes 6 PR requests with 594 response bytes; mobile makes 4 with
396 bytes. Both make zero PR section snapshot writes. Desktop still makes 16 identity cache writes
across the two consumers. These numbers exclude HTTP headers, identity response bytes, initial
loading and provider traffic. The fixture holds provider content and freshness metadata constant.
Real freshness changes produce full replies, so these are regression limits, not production savings.

Reproduce after building dependencies:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec playwright install chromium
node scripts/check-pull-network-browser.mjs
node scripts/check-pr-read-continuity-browser.mjs
node scripts/check-mobile-pull-handoff-browser.mjs
node scripts/check-pull-pipelines-browser.mjs
node scripts/check-mobile-metro-modules.mjs
pnpm exec vp test packages/client-runtime/src/effects/conditional-read-cache.test.ts packages/client-runtime/src/effects/polling.test.ts packages/studio-core/src/scm/pull-reads.test.ts packages/runtime/src/http/scm-source-guards.test.ts
```

The network fixture runs the real desktop and mobile hooks, pollers and conditional-read client. It
replaces transport and native controls. It checks shared consumers, running-check cadence, immediate
refresh, unchanged pagination, periodic older-page updates and failed-page recovery. The runtime
test also checks real HTTP responses for a 64 KB description with a provider double. The Metro check
builds and runs the shared PR reader with the production iOS Hermes transform settings. It provides
text codecs in the Node VM; it does not run Hermes or native UI. Physical iPhone behavior, real
forge bandwidth and end-to-end mobile network latency were not measured.

## Jira reads

Desktop and mobile share concurrent Jira reads within the runtime connection, source, account,
destination, filters, issue section and cursor. Adjacent reads reuse a versioned live response for
one second. Explicit refresh bypasses reuse and reaches the runtime at once. Each connection keeps
at most 64 live responses, with an approximate 8 MiB limit. Offline snapshots do not supply live
versions. Older runtimes keep working with full responses and no capability probe.

Jira lists, issue overviews, discussion pages, action metadata, boards and sprints accept
conditional reads. The runtime validates pairing, the account and the destination before comparing
versions. Matching data returns a 99-byte JSON body. Versions include freshness and errors. A new
cache time or freshness state can require a full response even when the description did not change.

Issue lists and discussion poll every 30 seconds. A stale runtime result uses a two-second
follow-up; errors use a 60-second interval. Hidden views and inactive mobile apps do not issue these
reads. Action metadata refreshes every five minutes. A manual refresh, action retry or successful
issue action checks it at once. Board and sprint discovery remains demand-driven. A failed local
browse-cache read does not prevent the live request.

Unchanged page one retains the opened list or discussion pages. The first available poll after 120
seconds rechecks the loaded prefix. Changed page-one data, an error or explicit refresh also
rechecks that prefix. Refreshed pages publish together. A failed later page retains the previous
visible prefix. Unchanged responses skip issue, discussion and list snapshot writes.

Before the change, the discussion fixture made 6 requests, transferred 97,976 JSON response bytes,
and wrote 6 snapshots per idle minute on each client. It uses two consumers, a 16 KB description,
and two comment pages in the first consumer. The same fixture now makes 2 requests, transfers 198
bytes and writes zero snapshots on both clients. A separate collection fixture opens two list pages
with 16 KB descriptions. It makes 2 requests, transfers 198 bytes and writes zero list/options
snapshots per idle minute on each client.

These fixtures run the real hooks, pollers and conditional reader. Transport and native controls are
doubles. Measurements exclude initial loading, HTTP headers, identity probes and provider traffic.
Fixture content and freshness metadata stay constant. These are regression limits, not measured
production savings. Tests also cover older-page changes, failed-page recovery and immediate refresh.
HTTP tests use the real server and provider doubles to check a 64 KB description, legacy clients,
separate sections, permission failures, account/site changes and invalid pairing tokens.

Reproduce after building dependencies:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec playwright install chromium
node scripts/check-jira-network-browser.mjs
node scripts/check-jira-collection-network-browser.mjs
node scripts/check-desktop-source-readers-browser.mjs
node scripts/check-mobile-integration-continuity-browser.mjs
node scripts/check-mobile-metro-modules.mjs
pnpm exec vp test packages/runtime/src/http/jira-conditional-reads.test.ts packages/runtime/src/scm/work/jira-account-guards.test.ts packages/studio-core/src/scm/jira-reads.test.ts packages/extension-scm/src/work/work-source-page.test.ts
```

The Metro check builds the Jira reader with the production iOS Hermes transform settings and runs it
in a Node VM. It does not run Hermes or a physical iPhone. Live Jira bandwidth, CLI latency and
physical-device behavior remain unmeasured. This applies the shared-read patterns from the T3 PR
review; it does not claim a Jira-specific T3 implementation.

## PR and Jira opening latency

PR and Jira list, detail, discussion, board and sprint views start saved-data reads and live reads
independently on desktop and mobile. Local cache reads previously ran before live reads. A
collection also waited for every source cache before it could request live data. Slow local storage
could therefore delay an online source even when its runtime was ready.

Saved data can appear first. A late saved result cannot replace a live result or reset its
pagination depth. A late cache error cannot replace the live outcome. If the live read fails, saved
content can still appear with the live error. Board and sprint data stays hidden after an account or
permission rejection. View cleanup cancels owned cache tasks or ignores their results. Discussion
cache deletion after a mutation still completes before a new live read can write that cache.

The browser fixtures hold cache reads open. They confirm that PR detail/list and Jira
collection/discussion live results appear before the cache is released on both clients. They also
check late saved content, a live failure followed by saved data, pagination, source/account changes
and explicit retry. This proves that cache latency is no longer on these request paths. It does not
measure a production navigation time or provider latency.

Reproduce with:

```sh
pnpm exec playwright install chromium
node scripts/check-pr-read-continuity-browser.mjs
node scripts/check-pull-network-browser.mjs
node scripts/check-jira-network-browser.mjs
node scripts/check-jira-collection-network-browser.mjs
node scripts/check-desktop-source-readers-browser.mjs
node scripts/check-desktop-integration-continuity-browser.mjs
node scripts/check-desktop-destination-guards-browser.mjs
node scripts/check-mobile-integration-continuity-browser.mjs
```

## Thread startup feedback

Thread startup uses the existing preparation steps on desktop and mobile. Tune and Maestro show
model discovery, then model selection. The selected model appears beside the agent startup step.
Worktree threads retain the completed model steps while fetch, worktree and setup steps run. These
updates do not add a wait to Send.

Scope shows project inspection and project selection while the thread is still a draft. Scope clears
its own progress on completion or failure. A failed selection preserves the draft and its timestamp.
A concurrent draft edit still rejects the old selection and keeps the new text. Runtime tests hold
discovery and selection open to check these states.

```sh
pnpm exec vp test packages/protocol/src/tasks/task-preparation.test.ts packages/runtime/src/agents/tasks/model-selection.test.ts packages/runtime/src/agents/tasks/title-generation.test.ts packages/runtime/src/scm/tasks/task-checkout.test.ts packages/runtime/src/agents/tasks/tasks.test.ts --maxWorkers=4
```

These checks use controlled adapters and browser transport fixtures. Real model discovery, provider
calls and physical-device startup remain outside these measurements.

## Live native browser overlays

Desktop Studio renders its UI and browser pages in sibling Electron `WebContentsView` layers. Menus
and dialogs raise the UI above the existing page. Transparent page slots expose the live page below
it. These controls no longer capture a screenshot, wait for image decoding or subscribe to
replacement image frames. The page keeps its renderer, visibility, draft and running work. The
existing link-preview opener backdrop and explicit screenshot tools keep their capture paths.

Passive tooltips use actual React content in one reusable, non-focusable native child window per
Studio window. That window ignores mouse input. Browser clicks, held presses, text selection, wheel
events and the text caret stay with the page. Linux and Windows restrict the native window's painted
shape to the tooltip bounds. This also prevents a black full-window surface on X11 desktops without
a compositor. Tooltip styles load after the native document is ready. Zoom, theme changes, Escape,
reload, renderer failure and window close use the same owner window.

Browser layout observation ignores mutations from unrelated thread streams. A Chromium fixture with
4,000 message nodes and 90 updates inside an open tool result measured 90 scans and 72.4 ms with the
old observer. The new observer made zero scans during that interval. Overlay insertion, inline
suggestions, resize, transforms and cleanup still trigger the required layout work. A
fractional-bounds test checks Chromium's rounding of clip coordinates and stale-clip cleanup.

Thread navigation also stops writing the unused `lastThreadId` preference. The real workbench
navigation fixture previously made 12 preference writes. It now makes zero. The stored field stays
compatible with older clients. Per-computer thread selection and composer drafts keep their existing
behavior.

Reproduce with:

```sh
pnpm exec playwright install chromium
node scripts/check-native-browser-layout-browser.mjs --baseline
node scripts/check-native-browser-layout-browser.mjs
node scripts/check-shared-browser-browser.mjs
node scripts/check-section-thread-browser.mjs
pnpm test:browser-overlays:native
pnpm exec vp test apps/desktop/electron/browser.test.ts apps/desktop/electron/browser-window.test.ts apps/desktop/electron/thread-window.test.ts apps/desktop/electron/links.test.ts apps/desktop/electron/browser-extension-popup.test.ts packages/protocol/src/runtime/previews/previews.test.ts --maxWorkers=2
pnpm --filter @dovo/desktop --filter @dovo/studio-ui --filter @dovo/studio-shell --filter @dovo/extension-tasks -r typecheck
pnpm --filter @dovo/desktop build
pnpm exec vp check
```

The native fixture needs a desktop session. On Linux, it uses `xdotool` and X11 or XWayland for real
pointer and keyboard input. It checks live page work, input, menus, dialogs, zoom, tooltip styles,
reload, Escape and unsaved-change close guards. The browser fixtures use controlled native command
transports. Their scan and write counts are regression measurements, not production latency claims.
Native input was checked on Linux X11. macOS, Windows, a real Wayland session, physical iPhone wake
and real Google sign-in with extensions remain unverified.
