# Architecture and where code belongs

Dovo is a TypeScript monorepo with a runtime, shared client packages, domain extensions, and app
composition roots. Apps compose feature packages; features depend on shared contracts and
platform-neutral utilities. A feature package should not reach into another package's private source
files.

## Package ownership

| Package                    | Owns                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`        | Shared schemas, validated data types, wire contracts, and pure domain helpers used across runtime and clients.                      |
| `packages/client-runtime`  | Extension lifecycle contracts and framework-neutral Effect helpers such as polling and task scopes.                                 |
| `packages/runtime`         | Host services: HTTP/WebSocket handling, authentication, SQLite, agents, terminals, Git/SCM, and jobs.                               |
| `apps/api`                 | Standalone server entry point and process startup for the runtime.                                                                  |
| `packages/studio-core`     | Frontend extension contracts, runtime connections, workspace state/synchronization, and app-facing host APIs.                       |
| `packages/studio-ui`       | Shared React controls, styles, and presentation primitives.                                                                         |
| `packages/studio-shell`    | Shared workbench shell, navigation, command palette, and extension catalog.                                                         |
| `packages/extension-*`     | Feature-owned desktop/web views and behavior: tasks, SCM, agents, jobs, and runtime/device settings.                                |
| `apps/desktop`, `apps/web` | Desktop and web composition roots: register extensions and provide platform-specific host behavior.                                 |
| `apps/mobile`              | Native Expo screens and navigation. Mobile shares protocol and client-runtime contracts, while native interactions stay in the app. |

The practical dependency direction is:

```text
apps/api → runtime → protocol
                 └→ client-runtime
apps/desktop + apps/web → extension-* → studio-core → protocol + client-runtime
                            extension-* → studio-ui → studio-core
apps/mobile → protocol + client-runtime
```

Arrows mean “depends on”; the table above lists additional direct edges. Keep `protocol` free of
runtime, React, and platform imports. Keep the host runtime out of browser/native client bundles.
Feature extensions depend on shared contracts and UI; the app decides which extensions to compose.

## Add or change a feature

- Put shared request/response schemas and cross-runtime pure transformations in `packages/protocol`.
  Update the runtime producer and every client consumer when a contract changes.
- Put host-side persistence and external IO in `packages/runtime`. Domain folders already separate
  agents, SCM, jobs, storage, terminal, auth, and HTTP. `services.ts` assembles these services;
  `http/routes.ts` and its route modules expose them.
- Put frontend connection, workspace synchronization, and cross-feature host contracts in
  `packages/studio-core`. Keep feature state selectors and transformations near their domain when
  they do not need to become a shared contract.
- Put a desktop/web feature's view, components, hooks, local selectors, and view-specific state in
  its owning `packages/extension-*` package. Its `index.ts` declares the extension contribution and
  lazy view import. Use core host APIs for navigation and runtime calls; use `studio-ui` only when a
  control is genuinely shared.
- Put native screen composition and platform-native interaction in `apps/mobile`. It has its own
  navigation and screen contributions, even when it uses the same protocol and runtime client.
- Put reusable visual primitives in `packages/studio-ui`, not domain-specific panels. Add another
  package boundary only when ownership or dependency direction becomes clearer.

For example, a new runtime response usually needs a schema in `protocol`, a host operation in the
relevant runtime domain, an HTTP route, and a frontend caller in core or the owning extension. A
view-only filter usually belongs beside the feature's existing selector or hook and does not need a
new protocol type.

## Components, hooks, models, and IO

Keep React components focused on rendering and user interaction. Put reusable view lifecycle work in
a feature-local hook; put pure sorting, filtering, formatting, or state transitions in a
feature-local model/helper with direct tests. Pass data and actions through the existing host or
feature boundary instead of making components import storage, process, filesystem, or network
modules.

The runtime owns filesystem, Git, provider SDK, database, and network access. Put those operations
behind a runtime service that can validate inputs and preserve the existing workspace/data
invariants. Validate untrusted values at the protocol or runtime boundary before they reach domain
logic. Keep persistence and side effects out of pure presentation selectors.

This is a current ownership guide, not a claim that every legacy module has already been moved into
these boundaries. Follow the nearest working pattern and improve a boundary only when a real change
needs it. For runtime effect and cancellation conventions, see
[Effect patterns](effect-patterns.md).

## Feature structure in practice

Prefer descriptive feature folders over generic `components/`, `utils/`, or `services/` buckets.
Related UI, domain logic, and tests should be discoverable together:

- `apps/mobile/src/tasks/conversation/`: message rendering, provider integration, activity groups,
  tool events, and scrolling. `tasks/draft/` owns draft persistence and hydration.
- `apps/mobile/src/tasks/` groups creation, composer, list, detail, preview, and conversation code;
  `apps/mobile/src/scm/` groups connections, pull requests, and work items.
- `packages/protocol/src/` groups contracts by auth, automation, conversation, runtime, SCM, and
  tasks. `index.ts` remains the public package entrypoint.
- `packages/extension-tasks/src/task-creation/`: the project/device picker; the task workspace
  coordinates the selected host and draft creation.
- `packages/extension-scm/src/work/`: issue/pipeline collection orchestration, issue detail, forms,
  and formatting. Package subpath exports retain the existing public imports.
- `packages/runtime/src/scm/work/cache.ts`: issue/pipeline cache reads, stale fallback, and
  invalidation, separate from forge routing and provider commands.
- `packages/runtime/src/scm/` groups Git, forges, pull requests, repositories, tasks, and work;
  `agents/` groups configuration, execution, task ownership, and provider adapters.
- `packages/runtime/src/agents/acp-installation/`: registry schemas and distribution selection;
  `agents/configuration/acp-installations.ts` owns transport and installation lifecycle.
- `packages/studio-core/src/workspace/`: `context.ts` defines the client contract, `scope.tsx` binds
  editors to a specific host, and `provider.tsx` coordinates connections and sync.

Within a module, put imports first, then local contracts/constants, then the exported operation or
component and its private helpers. Prefer descriptive names over numbered parts or catch-all
helpers. Keep an entrypoint stable when splitting internals; avoid barrels that make sibling modules
import back through their own parent and create cycles. A line count is a signal to inspect
responsibilities, not a reason to create another layer.

## Provider ownership and history

Each logical run has a stable `runId`; physical execution attempts have distinct IDs. The
`activeRunId` exposed to clients is the current attempt's control token. Stop and Steer freeze that
token when submitted, including mobile retries, and reject a retired or missing token. Fallback
steering continues the logical run while retiring the old attempt's callbacks. Provider adapters
also correlate native execution IDs. OpenCode v2 reconciles an existing execution before submission,
waits for its new start event, and awaits interrupt cleanup.

SQLite `provider_actions` records compact intent and dispatch state for start, steering, interrupt,
answer and checkpoint operations. Submission/answer receipts and their initial intent commit with
workspace changes. On restart an unacknowledged dispatched provider operation becomes uncertain and
prevents automatic resubmission; it requires reviewing the provider session. This does not promise
exactly-once execution across an external process. Local checkpoint capture can retry separately
after a successful provider outcome.

History is stored incrementally in `conversation_items`, with task metadata and a count manifest in
the version 2 workspace storage envelope. Migration preserves the original full document as
`workspace-before-history-v2` in the same transaction. Missing history rows fail closed instead of
rewriting an incomplete conversation. Older binaries cannot read the new envelope; use a full
database backup when downgrading. Runtime exports still contain complete conversations.

Clients negotiate `history=paged` for selected-task snapshots and sync tickets. Recent history is
bounded by ten user requests, 75 messages and an approximate byte budget. Whole oversized messages
remain accessible; files are never removed to fit a page. Authenticated `POST /api/tasks/history`
loads earlier pages with stable message-ID cursors. Loaded history is separate from live workspace
and draft state, and live versions win on overlap. Budget totals, search, bookmarks, copy and
checkpoint review retain access to older history. Legacy clients receive full history until they opt
in.

Auditing and history persistence skip unchanged task and message objects. Replaceable tool progress
is coalesced for 50 ms with bounded buffering; terminal and boundary events flush it. Raw transport
replay tests exercise Codex JSON-RPC and OpenCode SSE through real task ownership, queues, SQLite,
receipts, restart recovery and Git checkpoints. These boundaries align with
[T3's orchestrator v2](https://github.com/pingdotgg/t3code/pull/2829) without replacing Dovo's
runtime or requiring a relay, account service or HTTPS on LAN/VPN connections.
