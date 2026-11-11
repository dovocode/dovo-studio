# Runtime client

Use `createRuntimeClient(connection)` from `@dovo/protocol` for paired runtime operations. The
client binds the logical connection and credentials; each request uses the existing
identity-verified route selection and fallback behavior.

```ts
const client = createRuntimeClient(connection)
const result = await client.request('/api/terminals/ticket', { id }, responses.ticket)
const socket = new WebSocket(client.socketUrl('/ws/terminal', result.ticket))
```

`requestEffect` provides the same operation as an Effect. Request options are named: `method`,
`timeoutMs`, `mutationId`, and `route`; Promise requests also accept `signal`. Effect cancellation
follows the enclosing Effect scope.

Use `client.url(result.url)` for runtime-issued file paths and `client.socketUrl(path, ticket)` for
ticketed streams, after obtaining the file share or ticket. Both resolve the current selected route
and reject URLs outside its origin. Device tokens are never added to URLs. Obtain stream route
tickets with `{ route: 'stream' }` and pass that same option to `socketUrl`.

HTTP remains supported for LAN/VPN runtimes and maps to `ws:` for sockets. HTTPS maps to `wss:`.
Native WebRTC uses the existing private loopback transport. These helpers do not establish a
connection independently: obtain the ticket/share through a request first.

Keep `runtimeRequest` / `runtimeRequestEffect` for pre-pairing requests without a saved connection.
Existing authorization, route identity checks, mutation replay protection and revocation apply
unchanged beneath the bound client.

Concurrent requests share identity probes for each connection and route purpose. Cancelling one
reader leaves other readers running; cancelling the last reader aborts discovery. HTTP and stream
routes, and different pairing credentials, remain isolated. Request payloads and mutations are never
coalesced.

Transport failures while sending or reading a response invalidate only the route used by that
operation. A late failure cannot invalidate a newer route. Existing safe-read and deduplicated-write
retry rules still apply; uncertain mutations are not replayed on another transport.

Use `/api/snapshot?scope=overview` for connection checks and task status. Full snapshots include
conversation histories and file contents, which readiness and pairing-recovery checks do not need.

## Remote thread updates

The shared desktop, web and mobile sync client requests
`/api/sync/ticket?format=4&history=paged&subscriptions=live&incremental=1&files=1`. Current runtimes
return format 7. Older runtimes ignore extra options and keep their format-4/5/6 scoped path. Older
clients keep their existing format. HTTP remains supported for LAN and VPN connections. Pairing
tokens and device revocation checks remain required. Accounts and HTTPS remain optional.

Format 6 patches changed runtime fields and individual turn fields. A token count change does not
send the other turns or their checkpoints again. Removed optional fields and reordered turns have
explicit updates. Reconciliation retains unchanged objects, and a runtime-only update retains the
whole workspace object.

Format 7 also patches individual files by path. A viewed flag update keeps unchanged file bodies.
File order carries additions, deletions and renames. Removed optional fields have explicit updates.
Invalid or ambiguous patches require a fresh baseline. Duplicate paths use the existing complete
file array. The server keeps format-6 and format-7 replay views separate. Desktop window updates use
format 7 internally. Web and mobile use the same negotiated client.

`POST /api/scm/changes` accepts `includeFiles: false` with a `taskId` for clients that only need to
refresh saved Changes. The runtime commits the scan before returning `{"ok":true}`. The client
receives changed files through normal sync. Omit the option, or set it to true, to read the files in
the response. Use `responses.changesRefresh` for the acknowledgement path: it also accepts a full
file reply from older runtimes. This option does not change workspace ordering or authentication.

The client keeps recent departed selections for up to five minutes. The cache holds at most eight
snapshots and 4 MiB of estimated retained data per open connection. It stays in memory and belongs
to that connection's credentials. Larger snapshots use the existing scoped handoff. Returning to a
cached selection sends its epoch and sequence with the watch request. The server confirms the exact
baseline with `selection-resume`, then replays missed updates under the existing send-buffer limit.
The client publishes the selection after replay reaches the server's confirmed sequence, so an older
cached snapshot cannot replace newer workspace state while catch-up runs. Unknown epochs, evicted
replay history and cache misses use a scoped handoff or fresh baseline. A client with a missing or
inconsistent baseline reconnects for a full baseline.

Cache admission counts strings and reuses sizes of unchanged objects. It does not serialize whole
histories during navigation. Sent format-6 watches include an increasing `watchId`. The server sends
`watch-ack` after the selection response, including when the selected view stays the same. The
client keeps requested baselines until their watches are acknowledged. Pending navigation keeps only
the latest watch between resume requests. Scope-only watches preserve a pending thread selection.
This adds no debounce or client request queue.

Committed workspace changes wake sync after 20 ms. The periodic tick still handles other service
changes and connection checks. One active build and one pending wake bound this work. Repeated
foreground wakeups share a resume request. A stale resume on an established socket catches up from
the last sent cursor, so crossing live updates do not replay twice. Cancelled selection tickets
start their replacement without failure backoff. Web and desktop keep cold HTTP fallback immediate,
then cancel it when the stream provides a usable snapshot.

Desktop windows keep their own IPC sequence and last delivered projection. Changing one window's
thread selection sends a patch from that projection, without repeating the retained conversation or
moving another window's cursor. Source updates can skip views that omit a window's selected history;
the next covered source patches directly from that window's baseline. Unchanged source workspaces
reuse their projected workspace.

Renderer subscription changes merge within one microtask. Initial subscription stays immediate.
Refresh flushes the current selection before it reaches the main process, and stop cancels pending
updates. Foreground refresh supplies the renderer's cursor. A matching epoch and a sequence at or
behind the last sent sequence need no new baseline, because IPC preserves order. A missing, future
or foreign cursor requests a baseline. If the runtime is offline, that recovery request stays
pending until the next usable source snapshot. The cursor remains optional for existing callers.

This follows the same approach as T3 Code's
[per-thread resume state](https://github.com/pingdotgg/t3code/blob/79bca436/packages/client-runtime/src/state/threads.ts)
and
[bounded replay](https://github.com/pingdotgg/t3code/blob/79bca436/apps/server/src/orchestration-v2/ThreadStream.ts).
Dovo retains its existing workspace patches, mutation receipts and shared-thread replication.

After building the runtime and its dependencies, verify the real browser boundary with:

```sh
pnpm exec playwright install chromium
pnpm test:remote-thread-sync:browser
```

The test uses managed Chromium and a real loopback runtime. It checks remote changes while a thread
is hidden, exact history restoration, checkpoint identity, 40 rapid switches, prepared navigation,
connection reuse and reconnect replay. It measures decoded application bytes, not compressed network
traffic or physical-device latency. `pnpm test:desktop-runtime-connections` checks native Electron,
production preload source, IPC, shared fallback polling, selection handoffs and foreground refresh.

## Computer and resource scope

Keep these identities separate:

- A saved profile ID identifies this client's computer entry and remains stable when its address is
  updated. A profile's initial ID may be an HTTP origin; it is not the server identity.
- `connection.runtimeId` / `snapshot.runtimeId` identifies the server persistently across restarts.
- `snapshot.runtimeInstanceId` identifies one process lifetime. Compare snapshot revisions only
  within that lifetime.
- Forge reader and destination identities identify the account and repository behind an integration.
  Matching a computer or a public repository URL does not replace these checks.

Capture a `RuntimeTarget` when starting an operation. `resolveRuntimeTarget(profiles, target)`
resolves it only while that saved profile still has the captured address and device token. Check
before dispatch and before publishing a result. Return the latest saved profile so learned route
hints stay current. This check does not select another computer or authorize an account change;
retain existing account-session, forge and mutation-journal checks.

Use `runtimeResourceKey(runtimeId, resourceId)` for a resource collection's scoped identity. Its
credential-free tuple encoding preserves existing keys and handles origins containing colons. A
resource key is a lookup identity, never an authorization check.

When replacing a saved connection, call `verifyRuntimeReplacement(previous, candidate, snapshot)` on
its authenticated snapshot **before** confirming pairing or transferring saved edits. A known server
identity must match; an unknown identity cannot verify an existing known computer. Legacy profiles
without a recorded server identity remain supported and learn it on their next connection. An
intentionally different server must be added separately.

Native tunnel setup releases the peer if creating the readiness channel or signaling socket fails.
If accepting a local socket races native peer teardown, the socket and tunnel close so subsequent
requests can establish a fresh connection. Route diagnostics discard statistics collected before an
ICE state change and read the recovered pair before displaying a connection type.
