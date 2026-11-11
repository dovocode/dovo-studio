# Next performance work, 2026-11-11

Start with working-tree Changes reads, then file-review sync. Both have measured costs and clear
causes. Keep navigation and Send immediate. Do not add another debounce or a general request queue.
The sections below record the measured baseline and remaining work. The current follow-up implements
batched working-tree blobs, negotiated per-file sync patches, task-field hash reuse, lightweight
Changes acknowledgements, cached review fingerprints and serialized-file reuse in storage. See
[performance verification](performance.md) for implementation checks and before/after results. Lazy
file-body loading and physical-phone traces remain follow-up work.

## 1. Read Changes metadata first and batch old blobs

The selected thread refreshes Changes every 15 seconds while the document is visible, including when
the Changes pane is hidden. See `extension-tasks/src/view.tsx` and
`extension-tasks/src/detail/live-refresh.ts`. The endpoint calls `GitService.changes` in
`runtime/src/scm/git/git.ts`. It gathers repository state, then builds file previews in sequence.
`workingFilePreview` calls `blobPrefix`, which starts one `git cat-file` process per old blob.

Three warm reads on this checkout, with 51 changed files, took 173–183 ms. Each read started 31 blob
processes. Their cumulative waits took 126–137 ms. Other runs under concurrent load took 263–370 ms.
These measurements used the existing built Git service with call counters; its source was unchanged.
The response serialized to 1,657,285 bytes. At four reads per minute, this is about 6.6 MB of raw
JSON per minute. Actual compressed transport bytes were not measured. The preview content budget
does not include every serialized copy: `after` also appears as `diskContents`.

Recent installed-runtime diagnostic spans reported diff reads of 320–733 ms. Those spans cover other
requests and are not the same benchmark. They support investigating this path, but do not establish
the cause of a particular visible delay.

Implemented and remaining work:

- Implemented: use one bounded, operation-owned blob reader for working-tree previews. Checkpoint
  previews already use `GitBlobReader` from `cat-file-batch.ts`. Preserve byte limits, binary
  detection, UTF-8 boundaries, cancellation and file ordering when adapting it.
- Remaining: return summary metadata for background counts. Load bodies for an opened Changes pane
  and its selected files. Keep explicit refresh immediate and keep every changed file in the
  summary.
- Implemented first: omit file bodies from the discarded background response with
  `includeFiles: false`. Commit the same authoritative files, then let live sync deliver changes.
  This removes the duplicate HTTP payload without changing file identity or body availability.
- Compare subprocess count, elapsed time, compressed response bytes and opened-file latency on small
  and large repositories. Include renames, untracked files, binary files and large text.

T3 Code at `79bca436b24a6eabb05d3d1a95348ae40d31e713` has a useful reference in
`apps/server/src/vcs/GitVcsDriverCore.ts`, `getReviewDiffPreview`: it obtains `--numstat` metadata
and supports `metadataOnly` before returning a patch. This is a design comparison. We did not
measure T3 and Dovo under equal conditions.

## 2. Send file-review changes without every file body

`runtime/src/scm/reviews/reviews.ts` replaces one file entry when a viewed flag changes.
`protocol/src/runtime/connection/sync.ts` compares `files` as one task field. The modern delta
therefore includes the entire array. A changed entry also defeats the array identity fast path, so
field comparisons serialize the file list again.

The controlled production-function benchmark uses 50 files with 31,779 source characters each. It
retains `before`, `after` and `diskContents`. Toggling one flag produced a 4,832,304-byte delta for
a 4,832,191-byte file array. The median delta construction took about 10.6 ms. Reconstruction
through `applySnapshotDelta` matched the full next snapshot.

`runtime/src/http/support/body.ts` caches a digest per task object. Streaming replaces that object,
so `snapshotTag` hashes the unchanged file bodies again. In the same fixture, tag creation took
about 4.6 ms with files, versus about 0.007 ms without them. These are Node host measurements with
synthetic content. They exclude SQLite, compression, transport, native decoding and rendering.

Implemented in the current follow-up:

- Format 7 sends file order and changed fields. Viewed flags do not repeat file bodies. Older
  clients keep their current format.
- Task-field hashes now use immutable object identity. The new `sync tag` diagnostic span records
  tag creation separately from `sync delta`.
- Snapshots still include bodies for `task.files` consumers. Checks cover file deletion, renames,
  reordering, review conflicts, reconnect and old-client fallback.

Reproduce the controlled measurement from the checkout:

```sh
node scripts/benchmark-review-sync.mjs
```

## 3. Measure phone resume and connection setup on the device

Recent installed-runtime samples showed relay setup of 990–1,409 ms, one direct setup of 5,876 ms
and a connection health timeout. One relay RTT sample was 200 ms. This is a small diagnostic sample,
not an average or proof of a reconnection defect. No paired-phone trace was available.

The mobile transport already shares connection attempts, preconnects the selected computer, retains
a connection during the iOS inactive state and closes it on a real background transition. See
`apps/mobile/src/runtime/connection/peer-transport.ts`. Do not add another connection cache or keep
background sockets alive without measuring the native lifecycle and battery cost.

Record unlock to cached thread, first usable input, tunnel ready, first fresh snapshot and first
Send admission on a physical phone. Test Wi-Fi, cellular, LAN/VPN HTTP and relay routes. Separate
ICE negotiation, signaling, health timeout, snapshot transfer and rendering. Then optimize the
largest measured stage while preserving pairing and retry identities.

## Lower-priority checks and limits

`runtimeSnapshot` decodes defaults on each projection build. The 163-byte default fixture took 0.017
ms for the two reads and public decode, so no extra cache was added. Live settings size and decode
cost with large scoped settings remain unmeasured. Existing history, icon, snapshot-cache and
projection identity caches already avoid much repeated work. Do not replace them with another
scheduler without evidence.

The installed runtime showed snapshots of 36–128 ms and sync deltas of 7–18 ms. Process heap grew by
about 13–17 MB during individual delta spans. Concurrent work and garbage collection affect these
readings. They do not prove a retained memory leak or attribute all allocation to sync. The file
benchmark gives a specific allocation lead to verify with a CPU/allocation profile.

The next storage measurement found 22.15 ms of repeated review hashing inside a single viewed edit.
Exact input comparisons reduced that work to 0.010 ms. A weak fingerprint cache also removes
repeated hashing from review reads on both clients and the runtime. File-backed title updates still
encoded unchanged file bodies. Reusing their serialized form reduced the median from 4.26 to 2.03 ms
without a schema migration. WAL traffic did not fall; file-body separation from task rows would
require a measured migration and recovery design. The synthetic fixture is not evidence of
physical-phone speed or a production storage leak.

Physical iPhone sleep/wake and real Google sign-in with extensions remain unverified. The existing
controlled Linux popup smoke and browser adapters do not establish these native behaviors.
