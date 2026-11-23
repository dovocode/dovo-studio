# Connect remote MCP

Link an AI app with custom remote MCP support to a computer you own in Dovo Connect. The connector
uses Streamable HTTP, OAuth authorization code with S256 PKCE, dynamic registration for public
clients, and rotating refresh tokens.

## Enable and link

1. Set `DOVO_CONNECT_REMOTE_MCP=1` on the HTTPS Connect service. Configure its existing Dovo Auth
   identity provider.
2. Set `DOVO_REMOTE_MCP=1` in the chosen runtime's environment and restart it. Enable Dovo Connect
   on the computer and enable the Threads and Automations parts in Studio Tools. The runtime must be
   online while it handles requests.
3. Open `https://connect.dovo.studio/mcp/manage`, or the same path on your Connect service, and sign
   in. Copy the computer's address into the AI app's custom MCP server settings.
4. Review the selected computer and the app's callback domain. Choose **Allow read access** or
   **Allow reading and running agents**. The grant covers threads and automations on that computer
   across its projects.
5. To remove an app's access, return to **Remote MCP connections** and revoke that app. Disabling
   Dovo Connect or replacing the installation grant invalidates the old link. Removing
   `DOVO_REMOTE_MCP` and restarting also stops the runtime from claiming work.

Connect sees the commands and responses it relays to the external app. It keeps these payloads in
memory for the active request. The other app can retain data according to its settings. Ordinary
Studio LAN/VPN pairing and encrypted Connect device sessions use their existing transports.

## Run an agent

Use `dovo_discover` for project, agent and model choices. Call `dovo_threads` with
`action: "create"`, a title, repository ID, prompt, stable request ID, and `start: true`. You can
select a configured agent ID and model. The runtime applies saved permissions and approvals. Retry
the same launch arguments and request ID after an uncertain response. A changed request needs a new
ID.

Use `snapshot` or `read` to follow progress, `send` with a stable message ID to add a follow-up, and
`stop` or `resume` to control the run. Sending to a configured Bot uses Studio's Bot conversation
flow. Use `dovo_automations` to list and start configured flows and inspect their runs. Human review
steps continue to require human review in Studio.

An older runtime can stay connected to Connect. It will appear on the MCP management page after it
supports remote MCP and opts in. If the computer disconnects between launch and reply, check for the
thread or retry with its original request ID.

## Verify

```sh
bash verification/check.sh
pnpm --filter @dovo/protocol build
pnpm exec vp test apps/connect-server/src/remote-mcp-admission.test.ts packages/runtime/src/http/remote-mcp.test.ts
```

Lean checks grant and installation binding, the write gate, saved permission selection, and
at-most-once launch admission for a retained receipt. The generated cases exercise the TypeScript
admission function. The integration test exercises OAuth, the Streamable HTTP client, broker
routing, and the runtime's durable launch receipt. The Lean model abstracts the network and database
implementation.
