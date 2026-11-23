# MCP Apps

For agent-composed UI with a fixed component catalog, see [A2UI cards](a2ui.md).

Dovo hosts MCP Apps on desktop and mobile for MCP servers configured in project or agent resources.
The runtime owns one upstream session per thread/server/checkout. Codex, Claude, OpenCode and ACP
receive a scoped stdio proxy; upstream headers and environment credentials are not placed in app
HTML or client snapshots. Native provider-managed servers outside Dovo's configuration are not
intercepted.

Modern apps use the MCP Apps `2026-01-26` protocol, `ui://` resources and
`text/html;profile=mcp-app`. Both `_meta.ui.resourceUri` and the older flat `ui/resourceUri`
declaration are understood. Tool visibility separates model tools from app-only tools. The host
supports input/results, tool calls, resource reads/listing, prompts listing, model context updates,
text messages, links, inline/fullscreen display, file exports, list-change notifications and
graceful teardown. Unsupported optional features are not advertised: PiP, camera, microphone and
geolocation are not granted.

Only modern MCP Apps are supported. Legacy HTML, URL-list and Remote DOM resources are not rendered.
Saved legacy cards keep their history and show an upgrade error. Update the server to return MCP
Apps resources. HTML assets and network requests must declare `_meta.ui.csp` origins; undeclared
access is blocked.

## Reading live app state

Modern apps can expose read-only tools through the MCP Apps tools capability. The host discovers
these tools on initialization and list-change notifications. The agent uses `dovo_app_list_tools`
and `dovo_app_call_tool` to discover and read the current selection or other state in an open app,
including apps opened after the agent cached its initial tool list. Only tools explicitly marked
`readOnlyHint: true` without a destructive hint are exposed. Tool annotations are declarations by
the configured app, not a sandbox guarantee.

Tools belong to the current thread, server and connected view. Closing a view cancels its
outstanding calls. When an app is open on several devices, the latest connected view supplies its
tools; closing it falls back to the remaining view. Device credentials and server configuration are
checked again on each operation. Calls have a 30-second timeout and bounded messages; app tools are
never persisted or polled in the background. Desktop and mobile use the same ticket-authenticated
transport, preserving HTTP and optional HTTPS.

## Permissions and recovery

Apps run in nested, isolated frames. Guest messages are source checked, and the mobile/native
channel requires a per-view nonce unavailable to guest frames. CSP origins are validated before use.
App code receives no runtime token and cannot read host DOM or call native APIs directly.
Thread/device credentials are checked at the runtime, including again after approval. Interactive
tools go through Dovo approvals; read-only threads cannot perform app tool calls or send app
messages. Messages, exports and external URLs also require host confirmation. Context updates are
untrusted input to subsequent turns.

Results and resources are saved separately in the runtime database. Thread sync contains small app
references, not HTML. A declined or disconnected resource does not rerun its originating tool. UI
calls have durable idempotency records: completed actions can be recovered after lost responses,
while interrupted actions require reviewing the outcome rather than automatically repeating a
mutation.

Stop cancels pending app actions. Removed/archived/settled threads are reconciled once per minute;
their idle MCP transports are released and removed-thread artifacts are deleted. The bridge retains
warm sessions otherwise, with a maximum of 64 connections; capacity pressure releases the oldest
idle connection and never evicts an active tool call. Runtime shutdown aborts outstanding work and
closes all sessions.

## Discover MCP Events

In the MCP server editor, configure a native MCP 2026-07-28 HTTP server, enable **MCP-over-ACP**,
and select **Test connection**. If the server advertises `io.modelcontextprotocol/events`, Dovo
lists the event names and delivery modes on desktop, web, and mobile. This check runs on the
selected computer and works without starting an agent. The result is a catalog of advertised events.
It does not subscribe, poll, or start work. See the
[MCP Events specification](https://modelcontextprotocol.io/extensions/events/overview).

## Subscribe to MCP Events from a thread

Use the `dovo_task` **mcp_events** tool from a harness that receives Dovo's task tools. The same
interface works in Codex, Claude, OpenCode and ACP without relying on provider-specific event
notifications. The runtime calls native MCP Events methods on the server configured for the thread.
It supports MCP 2026-07-28 stdio servers and HTTP servers configured with **MCP-over-ACP**. The
server must advertise `io.modelcontextprotocol/events`.

1. Run `servers` to list configured candidates, then `catalog` with the server name to check support
   and get event names, schemas and delivery modes.
2. Run `subscribe` with the server, exact event name and arguments. Dovo starts from now, preferring
   poll when offered. Set `delivery` to `push` to request a stream explicitly.
3. Run `read` with the subscription ID. Process the returned `items`, then pass `nextOffset` as
   `after` on the next read. Leave `after` unchanged when retrying a lost reply. Respect
   `retryAfterMs`. Recover any authoritative state you need when an item reports a replay gap.
4. Run `subscriptions` to find the thread's saved subscriptions and `unsubscribe` to remove one.

Poll checks the server when the harness reads. Push streams reconnect from the saved cursor while
the agent's run grant is active. A read in a later turn can reopen the stream. Dovo saves queued
data and the cursor together. Servers without replay may miss events while disconnected. Unread
events stay in the thread inbox until acknowledged. Dovo limits inbox size and pauses a filled
stream until reads free space. Event payloads are external data and carry no tool authorization.

Webhook-only sources require an HTTPS receiver or a relay that exposes poll or push. The thread tool
uses poll and push and does not provision public callbacks. These subscriptions deliver data to the
calling harness. Use a saved
[MCP event automation](automations.md#start-a-bot-automation-from-an-mcp-event) to start a Bot
workflow from upstream activity while the clients are closed.

To use a received event in a saved automation, call `studio_automations` before acknowledging the
item. Choose a Manual automation on the same computer and pass the event's `subscriptionId`, item
`offset`, and `eventId` to `previewFromEvent` or `runFromEvent`. The preview runs no steps. A run
captures the event as external data and uses the automation's saved task settings, review gates, and
budget. Retrying the same event for the same automation returns the existing run while its history
is retained, even after the inbox item has been acknowledged.

### MCP Tasks

[MCP Tasks](https://modelcontextprotocol.io/extensions/tasks/overview) is a separate capability for
operations that a harness starts. A future Tasks client would persist the upstream task handle,
resume status through `tasks/get`, present any input requests for review before `tasks/update`, and
report the server's final result or cancellation status. The Events inbox tracks upstream
occurrences and does not negotiate the Tasks capability.

## SDK compatibility boundaries

Dovo task tools use the MCP SDK’s `McpServer` registrations and input validation. A call may contain
at most 10,000 array elements and object members combined; the SDK rejects larger inputs before
schema validation or execution. Large artifact bodies remain strings and do not consume that
allowance per character. Omitted arguments use `{}` and are still checked against the tool schema.

Upstream MCP requests retain tool `_meta` and validate tool/prompt arguments using the SDK schemas.
Malformed arguments fail explicitly. The bridge does not advertise MCP Tasks and rejects
Task-augmented calls rather than silently executing them synchronously.

HTTP MCP connections support plain HTTP and optional HTTPS. Redirects are blocked for POST, GET/SSE
and DELETE, including notification streams; configure the final endpoint URL. Legacy SSE fallback
applies only to HTTP 404, 405 or 406 responses, not authentication or parsing failures. Upstream
sessions remain scoped to each thread/server/checkout.

## Verification

Run `pnpm check`, `pnpm build`, and the focused MCP Apps tests. The browser host is generated by
`scripts/build-mcp-apps.mjs` during install/build and bundled into both clients. It has no runtime
CDN dependency. `pnpm test:mcp-apps:browser` exercises modern apps and rejects all three legacy
formats with protocol fixtures; native-device coverage remains necessary for OS-specific WebView and
sharing behavior.

## Shared live dashboards

Published artifacts can receive a fixed, explicitly approved read query from the publisher's MCP
server. Desktop and mobile sharing controls provide tool selection, fixed JSON arguments, field
selection, preview, approval and stopping/clearing the feed. Readers receive selected data through a
one-way sandbox event; they cannot call tools or inherit credentials. Read-only tool annotations
require a trusted server with source credentials restricted to read-only.

See [hosted artifact sharing](hosted-artifacts.md#publisher-approved-live-mcp-dashboards) for setup,
the `dovo:artifact-data` event API, expiry, cached-data behavior and revocation limits.
