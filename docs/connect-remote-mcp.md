# Connect remote MCP

Link an AI app with custom remote MCP support to a computer you own in Dovo Connect. The connector
uses Streamable HTTP, OAuth authorization code with S256 PKCE, dynamic registration for public
clients, and rotating refresh tokens.

To let agents sign in to another service's MCP server, see
[Sign in to MCP servers with OAuth](mcp-oauth.md).

## Enable and link

1. If you host Connect, set `DOVO_CONNECT_REMOTE_MCP=1` on the HTTPS Connect service and configure
   its existing Dovo Auth identity provider.
2. On desktop or a separately paired phone, go to **Settings → Devices & runtime**. Select the
   computer that should run the tools, enable **Dovo Connect**, then choose **Enable remote MCP**.
   Enable Threads and Automations in Studio Tools for the operations you want to use. The runtime
   must be online and use a connection mode that allows Dovo Connect.
3. Choose **Copy MCP server URL** and paste the address into the AI app's custom MCP server
   settings. The app obtains its credentials when you sign in and approve access with OAuth.
4. Review the selected computer and the app's callback domain. Choose **Allow read access** or
   **Allow reading and running agents**. The grant covers threads and automations on that computer
   across its projects. Read grants advertise project and agent discovery, thread reads, and
   automation reads. Run grants also advertise actions that create or steer threads and run or
   cancel automations.
5. Choose **Manage connected apps** to revoke an individual app. Choose **Disable remote MCP** to
   pause access for every linked app on this computer. The grants remain saved until you revoke
   them. Disabling Dovo Connect or replacing the installation grant invalidates the old links.

For unattended runtimes, `DOVO_REMOTE_MCP=1` supplies the initial setting. A saved choice in
Settings overrides it and takes effect without a restart.

Connect sees the commands and responses it relays to the external app. It keeps these payloads in
memory for the active request. The other app can retain data according to its settings. Ordinary
Studio LAN/VPN pairing and encrypted Connect device sessions use their existing transports.

## Run an agent

Use `dovo_discover` for project, agent and model choices. Call `dovo_threads` with
`action: "create"`, a title, repository ID, prompt, stable request ID, and `start: true`. You can
select a configured agent ID and model. The runtime applies saved permissions and approvals. Retry
the same launch arguments and request ID after an uncertain response. A changed request needs a new
ID.

Pass the user's objective and explicit constraints in new prompts and follow-ups. Let the receiving
agent choose from the skills enabled in Dovo Studio for that agent and project. Keep skill names and
paths from the calling app's own environment out of the handoff. For an explicitly required skill,
pass its exact Studio name in `requiredSkills` on `create`. The runtime checks enabled skills before
creating the thread. Older runtimes must be updated for this check. Studio labels new Remote MCP
messages with the connected app's name when available.

Use `snapshot` or `read` to follow progress, `send` with a stable message ID to add a follow-up, and
`stop` or `resume` to control the run. Sending to a configured Bot uses Studio's Bot conversation
flow. Use `dovo_automations` to list and start configured flows and inspect their runs. Human review
steps continue to require human review in Studio.

An older runtime can stay connected to Connect. It will appear on the MCP management page after it
supports remote MCP and opts in. If the computer disconnects between launch and reply, check for the
thread or retry with its original request ID.

The runtime starts the next queued call after a reply. A result can still reach Connect after the
runtime's operation authorization window expires, while the original request is waiting and the
app's grant is active.

## Poll for thread events

With Threads enabled in Studio Tools, an OAuth app with read or run access can discover the
`io.modelcontextprotocol/events` extension using MCP `2026-07-28` on the same server URL.
`events/list` advertises two event types with poll delivery:

- `thread.turn_finished` provides the thread, project and turn IDs and the outcome (`completed`,
  `failed`, or `cancelled`).
- `thread.needs_input` provides the thread, project and request IDs and the kind (`question` or
  `approval`). Review and respond in Studio.

Start each subscription with `events/poll` and a null cursor to read from the current position. Pass
the returned cursor on the next poll. Optional `threadIds` and `projectIds` under `arguments` narrow
the subscription. Start a new cursor when changing filters. Use the stable `eventId` to deduplicate
results when retrying a poll. When `hasMore` is true, poll again with the new cursor before waiting
for `nextPollMs`.

The runtime keeps the latest 1,000 events in its local database across restarts. The feed carries
IDs and status only. It returns `truncated: true` when a cursor no longer covers the retained
history, as can happen after a restore or a long disconnect. Read the thread's current state if you
need to reconcile missed updates. Older runtimes continue to offer their existing MCP tools.

## Poll for automation events

An updated computer with Automations enabled in Studio Tools offers `automation.run_finished` and
`automation.needs_review`. Narrow a poll with `automationIds`, `runIds`, or both. The finished event
names the run attempt and outcome. The review event also names the review step and step attempt. Use
`dovo_automations` with `action: "readRun"` and the run ID to reconcile after a retention gap. Open
the run in Studio to review the step. Remote MCP apps can read review events under their grant.

## Verify

```sh
bash verification/check.sh
pnpm --filter @dovo/protocol build
pnpm exec vp test apps/connect-server/src/remote-mcp-admission.test.ts packages/runtime/src/http/remote-mcp.test.ts
```

For a regression in the OAuth integration test, build Connect and the runtime in the clean base
checkout with
`pnpm prove -- --build --build-package @dovo/connect-server packages/runtime/src/http/remote-mcp.test.ts`.

Lean checks grant and installation binding, the write gate, saved permission selection, and
at-most-once launch admission for a retained receipt. The generated cases exercise the TypeScript
admission function. The integration test exercises OAuth, the Streamable HTTP client, broker
routing, and the runtime's durable launch receipt. The Lean model abstracts the network and database
implementation.
