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
