# Durable connections

`@dovo/durable-connections` is Dovo's custom, framework-independent library for durable,
bidirectional JSON state replication. It uses established ideas—an append-only version journal,
last-writer-wins registers, tombstones, durable acknowledgements and resumable batches—without
depending on another sync engine. This is a new implementation, not a battle-tested database.

Use it for preferences, drafts, shared application state and small structured documents. Each
channel owns a key space; applications choose their value schema, storage, transport and access
policy. It has no dependency on Dovo protocols, React, Node, browser APIs or an account service.
Effect owns reconnect cancellation and backoff; the replication protocol is implemented here.

```ts
import { DurableState, jsonStateStorage, startReplication } from '@dovo/durable-connections'

const state = await DurableState.open({
  channel: 'preferences:v1',
  // Persist this UUID alongside the storage. Every independent replica needs a unique ID.
  replicaId,
  storage: jsonStateStorage({
    read: () => localStorage.getItem('preferences-replica'),
    write: (json) => localStorage.setItem('preferences-replica', json),
  }),
  decode(value) {
    if (typeof value !== 'string') throw new Error('Expected a string')
    return value
  },
})

const unsubscribe = state.subscribe(() => render(state.get('theme')))
await state.set('theme', 'dark')

const connection = startReplication({
  state,
  peerId: pairedRuntimeId, // resume this source’s persisted checkpoint after reconnect
  async exchange(request, signal) {
    const response = await fetch(`${pairedAddress}/state/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify(request),
      signal,
    })
    if (!response.ok) throw new Error(`State sync failed (${response.status})`)
    return response.json()
  },
  onError: showConnectionError,
})

// The authenticated peer endpoint returns await itsOwnState.exchange(requestBody).
// Save checkpoints and values before returning that response.

await state.delete('draft') // a versioned tombstone; old copies cannot resurrect it
const previous = state.history('theme')[1]
if (previous) await state.restoreVersion(previous) // restores through a new winning revision

unsubscribe()
await connection.stop()
await state.close()
```

Storage must atomically replace a snapshot and resolve only after the write is durable. SQLite
transactions and IndexedDB transactions fit; mobile files should use a temporary file and atomic
rename. `jsonStateStorage` adapts atomic string stores. The example uses localStorage for brevity;
its browser quota and durability guarantees still apply. I/O errors propagate to the caller and
leave the last committed in-memory state and checkpoints intact. With only `load`/`save`, use **one
open owner per storage key**. For multiple windows/processes sharing a key, provide
`StateStorage.update(change)` (or the equivalent string adapter in `jsonStateStorage`). It must run
the synchronous callback in a serializable read/modify/write transaction and resolve with the
committed snapshot. Every mutation rebases on that snapshot before allocating a revision; history or
checkpoint rollback fails visibly. `refresh()` observes another owner's committed writes.

`DurableState.openPersisted({ ...options, createReplicaId })` initializes the actor identity inside
the same transaction and retains it on reload. Owners of the **same transactional store** share this
identity; independent stores need unique identities. Stop connections and close state before
releasing storage. Restoring/forking an old backup as an independent replica requires a new ID.

Set `forkOnDivergence: true` for an app store which a file, profile or device restore can return to
an earlier point. A peer then proves the rollback: it acknowledges more of this actor's journal than
the journal holds (`StateRollbackError`), or it rejects another version at a sequence which it holds
(`A replayed state sequence changed`). `startReplication` then calls `state.forkReplica(actor)` one
time for each open state, also when new replication handles replace stopped ones. The fork replaces
only the actor identity, in one storage transaction. The journal, version IDs, history, receive
checkpoints and learned peer sources stay. Pairings and credentials are not part of this store. The
peer accepts the retained journal as a new source, removes duplicates and returns the versions which
the restore removed. Other owners of the same transactional store adopt the new identity on their
next refresh. Without this option the error stays visible and the identity does not change. A
version conflict (`A state version was reused with different data`) and a diverged peer journal
never cause a fork. Append storage rejects the option: a host with its own restore generation must
use that mechanism.

Each write advances a logical revision beyond all observed revisions, using the local time as a
floor. Higher revisions win; equal revisions use the immutable change ID as a deterministic
tie-break. A causal edit wins over every edit it has seen, including after the wall clock moves
backwards. Concurrent offline edits have no globally knowable real-time order: all replicas choose
the same winner by this ordering. Values are atomic **per key**; use separate keys when fields
should merge independently. Arrays and text are not collaborative CRDTs. Losing versions stay in
`history`; recovery creates a new edit rather than rewriting history.

Peers exchange bounded batches (128 changes, 8 MiB by default), acknowledge only persisted data, and
retain source checkpoints through restarts. Lost responses replay safely. Gaps and identity
collisions fail visibly; reconnect restarts from an idempotent prefix, then resumes from the durable
acknowledgement. Connected sessions send only new journal entries. Polling is completion-based, with
immediate draining of backlogs, cancellation, and jittered exponential reconnect backoff. Transports
must honor `AbortSignal`, enforce request timeouts and authenticate peers. The library does not
retry arbitrary commands or external side effects: it replicates state only. Schema and channel
validation run before persistence; applications can also supply `validateVersion` for key-specific
rules. Subscriber errors are reported separately from committed writes.

Each connection sends its first page from sequence zero. When the peer acknowledged more than that
page, the connection also sends the last acknowledged sequence one more time. A journal which went
back to an earlier point and then grew past the receipt of the peer holds another version at that
sequence, and the peer rejects it. Thus a diverged journal gives an error or a fork, not silent
loss. This check adds one exchange with one change to a connection whose journal is longer than one
page.

## Historical repairs

`recoverVersion(previous, incoming)` lets a channel repair a retained version which has the same
identity and less data, for example a record that an older release wrote without a field. A repair
keeps the version ID and the journal sequence. Sequence checkpoints thus cannot show that a peer
needs it. Each replica keeps a durable repair generation for this purpose:

- The checkpoint map holds the local generation in the reserved key `@repairs`. The key
  `@repairs:<source>` holds the generation received from a source. Both commit in the same
  transaction as the repair or the received page. Storage adapters do not change. Actor IDs must not
  start with `@repairs`.
- A batch carries `repairs` (the generation of the sender) and, on the page that completes an
  unbroken replay from sequence zero, `replayed`. A response carries `accepted.repairs`: the
  generation which the receiver holds for the sender. These fields are optional in protocol 1. A
  channel without `recoverVersion` does not send them.
- Push: when the generation changes during a session, or when the peer holds a lower generation, the
  session sends the complete journal again with its own page cursor. It does not skip to the
  checkpoint of the peer. The peer records the generation on the final page.
- Pull: when a peer reports a generation which this replica did not receive, the session pulls the
  journal of that peer from sequence zero one time and records the generation on the final page.
  `afterExchange` reports `caughtUp: false` until that pull is complete.

Repairs made during a disconnect or before a process restart thus arrive on the next connection, in
both directions. The generation starts at one. Stores from an earlier release therefore replay one
time for each peer and direction after the upgrade, which also repairs divergence that already
exists. A repair costs one full journal push to each peer, and one full pull by each peer of a
replica which applied it. A peer without these fields receives a replay only for a repair made
during a connected session.

A conflict which recovery cannot resolve stays visible. After the first conflict the session pulls
the complete peer journal one time, then tries the push again. It remembers the failed page and the
repair generation. Later automatic reconnects keep the usual backoff, pull only new changes from the
durable checkpoint, and report the same error; they do not download the complete journal again. A
new repair, a different failed page, a successful push of that page or `restart()` permits a new
full recovery. The record belongs to the open state and the `peerId`. It stays when an application
stops a handle and starts a new one for the same peer. A handle without a `peerId` keeps its own
record. The record is not durable: a new process permits one new full recovery.

`decode` must preserve the JSON data of an existing version. A schema that strips unknown fields,
adds defaults or changes values can otherwise forward different data under the same version ID. The
engine rejects such a schema before it imports, receives or reopens the version. Version validators
must also preserve the complete version, including its identity. Failed batches leave stored
records, receive checkpoints and learned peer identities intact. After an app upgrade, the same
batch can retry without clearing local drafts or creating duplicate versions. Update connected apps
and runtimes together. Use a compatible decoder or a new channel with a data migration for schema
changes. Do not remove the version collision check or clear a replica to hide a conflict.

Local commits wake replication immediately. `connection.wake()` also checks for remote changes
without discarding its session cursors; `restart()` cancels an in-flight request or retry delay and
permits a new full conflict recovery. Set `intervalMs: null` to keep a caught-up session idle until
a state change or explicit wake. Offline failures still retry with backoff. `startPolling` provides
the same owned, coalescing worker used by the client compatibility adapter.

For an append-only database with one writer, implement `readChanges(after)` and
`append(after, changes, checkpoints)`. The read returns a snapshot envelope with `after`. It
includes only journal entries after that sequence. It must reject a truncated journal and gaps
between entries. The append transaction must check the expected stored sequence. It must save new
records and checkpoints together before it resolves. Provide both methods. Do not combine them with
`update`. The runtime SQLite thread journal uses this path. Its idle refresh reads no message
bodies.

`jsonStateStorage` supplies content identities to skip unchanged snapshots. No-op transactions keep
the stored string. With `update`, a changed write encodes only new and repaired journal entries: the
adapter keeps the JSON text of each retained entry and joins those texts. It does not parse its own
committed text again. The store still receives and writes one complete string, so atomic replacement
and failure behavior do not change. A failed write leaves the committed string in use. The first
write after a load, or after another owner changed the store, encodes all entries one time. The
retained texts use memory of about the journal size. Snapshots and journal entries that reach or
leave this adapter are immutable: do not change them.

Version 1 retains the complete journal in memory and storage. It deliberately does not prune
tombstones or recovery history: doing that without peer-aware compaction could resurrect old values.
Keep channels small; high-volume event storage, file transfer and automatic execution failover need
a different storage/design. Cross-process writers require a storage adapter with serializable
transactions. The wire protocol and stored snapshots are explicitly versioned; schema changes need
an application migration/new channel.

## Dovo integration

Global/project shared settings, including scoped presets, use the same durable journal on runtime,
desktop/web and mobile. `SharedStateSynchronization` in the protocol package owns app sessions,
imports existing preferences/snapshots without changing their revisions, retains competing versions,
and bridges paired runtimes through one app replica. Desktop windows use serializable IndexedDB
updates; mobile uses serialized app-private files with temporary writes and backup rotation (Expo's
overwrite move alone does not provide atomic replacement). Interrupted moves retain the last
committed journal. Pairing tokens never enter these journals.

Foreground changes, network recovery and manual refresh wake synchronization. Backgrounding stops
sessions; late responses from removed/replaced pairings are discarded. Settings errors flow through
the existing connection UI and retry automatically, including unchanged edits after a failure.
Mobile manual-refresh mode avoids idle exchange requests. Runtimes advertise
`stateReplicationVersion: 1`; older versions continue through the shared-settings endpoint rather
than receiving simulated durable receipts. Existing mutation queues and private caches stay in
place.

Locally registered Studio pairings authorize direct runtime-to-runtime sessions. One registered
connection suffices for two-way exchange, even while Studio is closed. Retrieval-only pairings do
not gain new always-on control. Removing/revoking a pairing stops its session. Shared preferences
remain app-wide after a pairing is forgotten, matching their existing scope. HTTP over LAN/VPN
remains supported; pairing codes and device tokens remain required.

Only explicitly shared settings enter this channel. Machine settings, credentials, workspace paths,
task execution and files remain with their owning runtime. Existing settings form preconditions
continue to reject stale read/modify/write submissions; **accepted** shared versions resolve
automatically during replication. Rapid accepted local edits are archived in the same SQLite
transaction as their settings write, so a restart before the next sync does not lose history.

Authenticated human clients can inspect `GET /api/state/status`, request history with
`POST /api/state/history { "key": "global" }`, and restore a returned revision with
`POST /api/state/restore { "key": "global", "updatedAt": ..., "changeId": "..." }`.
`POST /api/state/exchange` serves the generic request/response protocol for this one channel. These
endpoints accept existing paired credentials; scoped agent-run credentials cannot use them.

## Shared threads

`shared-threads:v1` is a separate application channel. The owning runtime writes thread status,
metadata and message records into an immutable SQLite outbox **inside the workspace transaction**.
The replica imports that outbox after commit, including after a crash. Runtime persistence appends
normalized journal rows; it does not rewrite message bodies on disk for every checkpoint. Thread
lists query metadata only; detail reads page 40 messages at a time.

Thread identity is `(ownerRuntimeId, threadId)`. Titles, pins and snooze times have independent
latest-wins registers. Messages have stable IDs and separate records, so additions do not replace an
entire conversation. Completed assistant messages are archived once; live tokens stay on the
existing owner stream. Accepted user messages are archived immediately. Later edits/removals keep
older versions; a reset revision invalidates loaded pages when existing history changes. Thread
removal is an explicit retained record, preventing old delivery from resurrecting the thread. Shared
titles are limited to 2,000 characters. A message over 1,048,576 UTF-16 code units has a clearly
marked shortened shared copy, keeping even escaped text within transport limits; its complete
authoritative text remains on the owner.

Desktop/web and mobile persist a separate thread replica and bridge capability-advertising paired
runtimes. Direct runtime sessions use existing Studio pairing grants. Data and receive checkpoints
commit together. Known runtime identities resume persisted pull cursors on a fresh connection;
outbound delivery may replay an already accepted prefix and is deduplicated. Backgrounding and
removed/replaced pairings cancel app sessions and reject late replies. Older runtimes do not
advertise `threadReplicationVersion: 1` and receive no thread replication from apps. A direct
connection to an older runtime reports endpoint failure and retries with backoff; it never simulates
acknowledgement or changes the older runtime's workspace.

Lists prefer the connected owner, then a reachable shared copy, then cached originals/copies. A
shared conversation has its own desktop/mobile view with paged text and title/pin editing. Copies
never enter the executable workspace. Receiving a thread cannot launch, resume, steer or fail over
an agent. Only the owner publishes its history and execution status; paired human clients may edit
shared metadata. An owning runtime rejects foreign attempts to rewrite its descriptor or messages.
Paired runtimes can forward another owner's records as trusted shared data; this is not a signed
multi-tenant event system.

The shared projection includes message text, title, pin, snooze, status, owner name and project
name, including owner-controlled settlement/archive flags. It excludes structured credentials,
sessions, permission grants, queues, unsent drafts, local paths, attachments, file contents and
checkpoints. **Message text is shared as written**; it is not secret-redacted. Shared history
remains in each replica after forgetting/revoking a pairing; revocation stops further
synchronization, not previously delivered data. Historical revisions and removals remain retained.
There is no journal compaction, account service, execution migration or file synchronization. The
generic state still keeps its complete journal in memory and app storage uses snapshots: this
version targets ordinary conversation archives, not unbounded token/event storage. Replicated
conversation search and arbitrary historical-version restore UI are not part of this version.

Authenticated human endpoints:

- `GET /api/threads/state/status`: local journal revision and direct peer errors.
- `POST /api/threads/state/exchange`: the durable bidirectional exchange protocol.
- `POST /api/threads/replica/read { ownerRuntimeId, threadId, before? }`: a safe conversation page.
- `POST /api/threads/metadata { ownerRuntimeId, threadId, field, value }`: title, pin or snooze
  edit.

Metadata submissions use existing mutation receipts when an action ID is supplied. A lost reply
returns its original receipt; replay never creates a newer winning edit. If the process dies between
commit and recording the response, recovery reports an uncertain action rather than blindly
repeating it. Run-scoped agent credentials cannot access these endpoints. HTTP LAN/VPN connections
and existing pairing requirements are preserved.

## Backup restore and request limits

Restoring a runtime backup starts a new replication generation. The runtime keeps its stable
identity. When the current database has the same identity as the backup, restore also keeps the
current device tokens, revocations, provisional deadlines and paired-runtime registrations.
Restoring workspace data does not restore old device access. Each generation uses a separate journal
actor, so old receive cursors cannot strand sync after rollback. Update clients and paired runtimes
together; older clients that require an exact actor/runtime ID match cannot sync with a restored
generation.

App replicas have no restore generation of their own. They open their stores with
`forkOnDivergence`, so a restored or cloned app journal continues under a new actor after a peer
proves the divergence. See the option above.

Each replica saves the last accepted actor for a stable peer ID. Reconnects and process restarts
resume that actor's checkpoint. Outbound delivery can still replay its accepted prefix; the receiver
deduplicates it. This keeps recovery safe when the receiver has also restored a backup.

After restore, newer owner history received from a peer becomes a separate archived shared copy. Its
owner name ends with `(recovered)`. The owner publishes its restored message values and removals to
the current shared thread. The recovered copy keeps the newer text. It cannot start or resume work.
Recovery copies, owner corrections and the receive checkpoint commit together. Repeated delivery
does not create another copy. Shared preferences keep their latest-wins policy.

The runtime settings channel uses an incremental SQLite journal. It migrates the previous JSON
document once and keeps that document for recovery. Browser and mobile adapters still write JSON
snapshots. They do not gain incremental disk writes from this runtime change.

State batches allow 8 MiB. Runtime exchange requests allow that batch plus 16 KiB for the bounded
request envelope. Oversized requests still return HTTP 413. This also accepts batches from existing
clients that were valid before the envelope limit was corrected.

The generic engine can ignore non-authoritative echoes with `acceptVersion`. Ignored records still
advance the source checkpoint. The pure `additionalVersions` callback can add recovery records in
that same transaction. Neither callback may perform external writes.

The integration borrows design ideas from
[T3 Code's connection runtime](https://github.com/pingdotgg/t3code/blob/main/docs/internals/connection-runtime.md),
[transactional event sink](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/EventSink.ts)
and
[client thread state](https://github.com/pingdotgg/t3code/blob/main/packages/client-runtime/src/state/threads.ts):
server-owned execution, commit before publish, cursor/data consistency, and separate list/detail
history. T3 Code's documented design is client/server projection synchronization; this custom
channel additionally forwards shared state between paired runtimes. Its implementation is original.

A peer without repair-generation receipts receives one full replay per connection on a recoverable
channel. This also delivers repairs made while disconnected or before the sender reopened. An idle
connection does not repeat the replay. Upgrade both peers to retain the receipt across reconnects.
