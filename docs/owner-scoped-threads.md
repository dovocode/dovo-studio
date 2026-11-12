# Owner-scoped threads

Dovo keeps each thread on its owning computer. Desktop/web and mobile connect directly to that
computer with the saved pairing. Clients combine thread lists. They cache read data per connection
for offline use. A thread ID on one computer does not identify a thread on another computer.

## T3 Code comparison

Reviewed T3 Code commit `dbbd1d25`:

- [Thread routes](https://github.com/pingdotgg/t3code/blob/dbbd1d25/apps/web/src/threadRoutes.ts)
  use `ScopedThreadRef`, with an `environmentId` and a `threadId`.
- [Mobile cache storage](https://github.com/pingdotgg/t3code/blob/dbbd1d25/apps/mobile/src/connection/environment-cache-store.ts)
  reads shell and thread data within that environment. It checks stored identities and orders
  writes.
- [Shared preferences](https://github.com/pingdotgg/t3code/blob/dbbd1d25/packages/client-runtime/src/state/sharedSettings.ts)
  use an explicit allowlist and check provider compatibility.
- [PR routing permissions](https://github.com/pingdotgg/t3code/blob/dbbd1d25/packages/client-runtime/src/connection/pullRequestRoutingPermissions.ts)
  bind trust to saved endpoints and default to off.

Dovo uses the same ownership model. It reuses its existing direct runtime streams, paired-computer
routes and bounded per-connection caches. This change does not add T3 dependencies or replace the
runtime transport.

## Change and migration

Automatic cross-runtime thread mirroring is retired on desktop/web, mobile and the runtime. New
runtimes no longer advertise the thread replication capability. They reject old mirroring and
shared-metadata requests with HTTP 410. Shared settings synchronization continues.

New clients filter mirror rows from old runtime snapshots and saved caches. They keep the real
owner's title, icons, draft and cached history. They filter foreign omitted-thread keys when the
snapshot provides them. Older scalar-only omission counts have no ownership data and remain as
reported until the runtime refreshes them.

The Computer updates screen ignores mirror tasks when it checks for running work. Running local
tasks and automation runs still block the normal update path. A thread running on Cod must not block
updates on an idle Mac or Dovo Agent.

No migration deletes the old SQLite journals or client archive documents. Runtime archives remain
readable with the authenticated human endpoint:

```text
POST /api/threads/replica/read
{ "ownerRuntimeId": "<original runtime ID>", "threadId": "<original thread ID>", "before": "<optional message cursor>" }
```

Use the existing paired human bearer credential. Do not put credentials in chat or shell history.
Omit `before` for the latest page. The response contains `task.historyBefore` for the next older
page. Archive views are read-only. They cannot rename, pin, execute or resume a task. Old stored
copies can be incomplete. They do not replace the owner's database or its backup. Client archive
documents stay on disk; this change adds no new client-archive export UI.

Pairing codes, device tokens, local credentials, drafts and project handoff remain in place. HTTP
connections over LAN, Tailscale and NetBird remain supported. HTTPS remains optional.

## PRs, Jira and pipelines

Integration lists, detail reads and actions use the selected computer and account. If that computer
is offline, the client keeps its cached view and waits for it to reconnect. It does not silently
send a read through a different computer that has the same account. Reconnect resumes through the
original source. Retained account and destination checks still reject a changed account or endpoint.
Explicit PR delegation remains available; this change does not grant new routing permissions.

T3 binds PR routing trust to saved endpoints. Dovo already has explicit delegation and account
checks, so this change keeps those controls and removes implicit handoff from ordinary readers. The
T3 source has no matching Jira implementation. Jira and pipelines use the same ownership rule.

## Shared preferences

T3 shares an explicit set of compatible preferences. Dovo keeps its existing global and shared
project scopes. These share model choices, instructions and portable defaults. Appearance and
navigation preferences remain local to each app.

Agent installations, executable paths, configuration directories, literal environment values and
non-environment secret references stay in Computer or Project on computer. Shared MCP settings use
environment-variable references. Each computer resolves those names from its own environment. Local
skill folders stay local; catalog skills install independently on each computer.

The desktop/mobile agent editors explain this rule and reject invalid shared profiles before sending
an HTTP request. Runtime save and sync endpoints validate the same policy. Clients also validate old
stored shared records before sending them. An incompatible saved record stops that settings exchange
with an error. A rejected new edit can be corrected and saved. If private values are already in a
durable journal, editing its current value does not erase that history. That journal stays blocked
and intact for explicit recovery. Automatic private-journal migration is not part of this change. No
private saved configuration is deleted or silently moved.

## Verification

Build before running runtime tests, because package imports use built dependencies:

```sh
pnpm --filter @dovo/api... -r build
pnpm exec vp test packages/runtime/src/storage/thread-replication.test.ts packages/runtime/src/storage/thread-replication-journal.test.ts packages/runtime/src/http/diagnostics.test.ts packages/runtime/src/http/runtime-sync.test.ts packages/protocol/src/runtime/cache/overview-state.test.ts packages/protocol/src/runtime/connection/runtime-upgrades.test.ts packages/protocol/src/runtime/connection/runtime-fleet.test.ts packages/protocol/src/runtime/connection/thread-replication.test.ts --maxWorkers=2
pnpm exec playwright install chromium
node scripts/check-computer-updates-browser.mjs
node scripts/check-update-button-browser.mjs
node scripts/check-preset-sync-browser.mjs
node scripts/check-workspace-recovery-browser.mjs
node scripts/check-mobile-registry-recovery-browser.mjs
node scripts/check-thread-replication-browser.mjs
node scripts/check-durable-connections-browser.mjs
node scripts/check-scoped-agents-browser.mjs
node scripts/check-scoped-settings-browser.mjs
node scripts/check-mobile-task-list-rendering-browser.mjs
node scripts/check-mobile-workspace-overview-browser.mjs
node scripts/check-mobile-workspace-browser.mjs
pnpm test:integration-scopes:browser
pnpm --filter @dovo/runtime --filter @dovo/protocol --filter @dovo/studio-core --filter @dovo/mobile --filter @dovo/extension-tasks -r typecheck
pnpm check
```

Runtime integration tests start two real HTTP runtimes with SQLite. They check owner isolation,
rejected old exchanges, archive paging and restart recovery. The WebSocket test checks that a local
change streams without publishing archived foreign data. Browser checks mount the desktop/mobile
providers and controls. The mobile checks use browser adapters for native APIs. Tasks and Workspace
show cached owner rows without waiting for mirror resolution. A controlled tap check opens a cached
thread while selected-computer storage is blocked. It also verifies that live arrival keeps the same
row and that connection failures never substitute a mirror. This does not measure native startup
time.

The full local unit run also includes runtime browser tests that require a working Chromium sandbox.
This host rejects those sandbox launches. The UI browser checks above use managed Playwright
Chromium; they do not establish the sandboxed runtime browser boundary.

No native iPhone/Android run, installed-machine upgrade or hosted CI result is established by these
checks. Existing app installs keep their old behavior until they receive this change. The active
runtime must not restart while it has local work running.
