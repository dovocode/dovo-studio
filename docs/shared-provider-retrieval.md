# Shared GitHub and Jira retrieval

Dovo coordinates provider reads over existing authenticated runtime connections. HTTP LAN/VPN
addresses remain supported. Pairing codes and device tokens remain required; no account service or
inbound public endpoint is needed.

## Use

Update the participating runtimes and open Studio with the computers paired and connected once.
Studio registers the fleet with each connected runtime. Registrations survive Studio disconnects and
runtime restarts, so servers can continue doing the work. Forgetting a computer updates the
registration when Studio reconnects; revoking the registering device removes its contribution.

Computer preferences include **Share retrieval with paired computers** and **Preferred retrieval
computer**. Automatic preference uses the existing computer icon/type: Server and Cloud first,
Desktop (including CPU/Terminal) second, Laptop last. Equal-priority hosts use runtime ID order, so
connected machines converge on the same executor. When no computer type is saved, Dovo server
deployments default to Server, Linux portable chassis default to Laptop, and other hosts default to
Desktop. A saved type always overrides detection. A preferred computer overrides that order. An
unavailable, disabled, older or differently authenticated host falls back to the next eligible host
and eventually local execution for non-PR retrieval. PR communication follows the persistent owner
policy below.

The requester must have a verified provider identity. Sharing does not grant a different provider
account access. GitHub and Jira credentials never leave their host. Runtime pairing credentials are
retained privately by the runtime, like the existing saved runtime connections; keep the Dovo data
directory private. Tokens, provider credentials and peer connections are absent from retrieval
diagnostics.

## PR communication over P2P

PR lists, details, status, discussion, changes, stacks, creation, comments and actions use one
persistent executor per provider instance and verified account. This applies to every supported
forge provider. **Preferred retrieval computer** explicitly selects that executor. Automatic mode
chooses a capable connected server, desktop or laptop on first use, then retains its runtime ID in
the runtime database across restarts. A returning computer does not reclaim an existing assignment.
Clearing an explicit preference retains the current PR owner; select another computer to move it.
Use the same preferred computer on participating runtimes to pin all their PR traffic to that
server.

Requests use existing authenticated peer connections, including HTTP LAN/VPN addresses. The executor
re-resolves its own provider credentials and verifies the account before serving even cached
results. Callers send typed PR operations and repository identity, never credentials, checkout paths
or commands. The executor runs operations locally, so asymmetric peer lists cannot cause relay
loops. Local Git operations, worktree annotations, thread creation and notification delivery stay
local.

The owner shares a bounded 15-second PR response cache across gateways and coalesces concurrent
reads. Explicit refresh bypasses it. Writes execute once, without fallback or automatic retries, and
invalidate the account's PR cache before and after execution, including an ambiguous failure. Late
in-flight reads cannot repopulate invalidated cache entries. Cached responses retain the owner's
fetch timestamp through gateway caches. Desktop and mobile preserve a newer snapshot when another
gateway returns an older one.

If the owner disconnects, PR reads retain their saved data with a stale/error indication; refreshes
and actions do not silently execute on another server. Reconnect the owner or explicitly choose
another preferred retrieval computer. Older executors must be updated before accepting this PR
protocol. Disabling shared retrieval intentionally restores local execution on that computer.

## Retrieval and freshness

GitHub REST GET requests and parsed GraphQL query operations participate, covering PRs, issues,
reviews, comments, diffs, checks, jobs and logs. GraphQL mutations and subscriptions are excluded.
Jira participates through the existing bounded issue/JQL, issue discussion, board and sprint read
commands. Account discovery and verification remain local.

Fresh local cache entries are used first. Otherwise the preferred host serves its cache or fetches
the provider once for concurrent identical requests. Keys include the provider instance, verified
account, Jira project and complete request arguments/input. Distinct queries, pages and fields
remain isolated. GitHub transport retains its existing ETag/conditional request and rate-limit
handling.

Mutable responses have a 15-second sharing window; immutable GitHub objects/commits addressed by
full SHA have a 24-hour window. Explicit refreshes bypass shared cached values. Existing typed
PR/issue caches still validate and scope responses and handle offline/stale presentation.

Up to 128 responses of at most 1 MiB each are retained per computer. Larger logs can still be
forwarded and concurrent requests coalesced, but are not persisted. Provider failures are not cached
as successful results.

## Watches and recovery

Non-PR provider reads and pipeline watchers can use shared subscriptions. Only the selected executor
refreshes those snapshots, every 30 seconds, with a 45-second shared freshness window. An interested
requester renews a three-minute lease. When interest stops, background work expires. The runtime
caps active shared subscriptions at 64; additional reads still work normally.

A fallback desktop hands a subscription to a returning preferred server. Remote read endpoints
always execute locally, so asymmetric peer lists cannot create forwarding loops. Provider identities
are checked again for background refreshes. Existing per-thread watchers continue to own
notifications and their delivery cursors; PR retrieval and actions use their owner; watch delivery
stays local.

This uses authenticated peer requests and polling. It does not configure GitHub/Jira webhooks,
expose an internet listener, or elect a cluster-wide notification owner. Network partitions can
temporarily cause independent reads, while request handling and caches stay available locally.

## Mutations and diagnostics

Non-PR writes execute once on the initiating computer; PR writes execute once on their selected
owner. Shared entries and the existing PR/issue caches are invalidated before and after provider
writes, including ambiguous failures. Connected peers receive invalidations; disconnected peers'
mutable entries expire within their bounded window. Late in-flight results cannot repopulate
invalidated caches.

Authenticated POST /api/retrieval/host returns runtime ID/type, sharing state, watch and pending
counts, local/remote/cache/fallback counters and refresh/invalidation failure counts. It contains no
credentials. Agent run tokens cannot register peers or use these private endpoints; ordinary agent
reads benefit through their existing authorized operations.

Sharing reduces duplicate provider requests. It does not increase a GitHub account's rate limit.
