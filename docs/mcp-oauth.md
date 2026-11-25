# Sign in to MCP servers with OAuth

Connect agents to a remote MCP server that asks you to sign in. This page covers outbound MCP
servers that agents use. To let another AI app use Dovo as an MCP server, see
[Connect remote MCP](connect-remote-mcp.md).

## Connect

1. Open **Settings → MCP, skills & hooks** and add or edit a **Remote server (Streamable HTTP)**.
2. Turn on **Sign in with OAuth**. Optionally enter scopes; otherwise Studio requests the scopes the
   server advertises.
3. Select **Connect**. The provider's sign-in page opens. Approve access.
   - In a browser on the same computer, the last page says **Signed in** and Studio updates.
   - On another device, such as a phone, the last page does not load because it points to the
     computer's loopback address, for example `http://127.0.0.1:43123/callback?...`. Copy that
     address from the browser, paste it into **Browser address after sign-in** and select **Finish
     sign-in**.
4. Save the server. The editor shows **Signed in on** and the computer name.

**Test connection** uses the same sign-in. Select **Reconnect** to sign in again, for example with
another account. Select **Disconnect** to remove the sign-in from that computer. Studio asks the
provider to revoke the tokens and reports whether it confirmed this.

Each computer signs in separately. The connection belongs to the server name and its exact URL on
that computer, so shared settings can carry an OAuth server and each computer connects its own
account. Turning off **Sign in with OAuth** keeps the stored sign-in until you select
**Disconnect**.

## How it works

The runtime is the OAuth client. It uses the MCP TypeScript SDK 1.32.2 with protected resource
metadata discovery, dynamic client registration, S256 PKCE and the resource indicator. Refresh
tokens rotate when the provider rotates them.

In a normal thread, every harness reaches MCP servers through Dovo's MCP bridge, and the runtime
connects to the server. The runtime adds the access token there and refreshes it when the server
returns 401, including during a long turn. Codex, Claude Code, ACP agents and the other harnesses
use the same path. The harness receives only the bridge command, never the token.

Tokens stay in the runtime database on that computer. They are not in snapshots, shared settings,
replicated configuration, transcripts, activity or harness launch configuration. Local database
backups on that computer include them, like other literal MCP credentials. Disconnect deletes them.

If the refresh fails, the tool call fails with
`Sign in to the MCP server NAME again in Settings → MCP, skills & hooks.` An agent never opens a
sign-in page.

Plain HTTP works for MCP servers and providers on a LAN or VPN, such as Tailscale or NetBird. Studio
does not require HTTPS. The provider decides which redirect addresses it accepts; the loopback
address follows RFC 8252.

## Limits

- **Sandboxed threads:** the harness connects to MCP servers directly, without the bridge. Studio
  leaves OAuth servers out of sandboxed threads and records this in the thread's activity.
- **MCP-over-ACP:** OAuth sign-in uses Streamable HTTP. Turn off MCP-over-ACP for an OAuth server.
- **Credentials:** an OAuth server cannot also have a bearer token variable or an `Authorization`
  header.
- **Pre-registered clients:** Studio uses dynamic client registration. Providers that require a
  manually registered client ID are not supported yet.
- **Older runtimes:** the editor shows an update notice when the computer does not support OAuth
  sign-in. An older runtime ignores the setting and connects without a token.

Codex has its own `mcpServer/oauth/login` and Claude Code shows `needs-auth` for MCP servers. Studio
does not use them: Codex keeps those tokens in its own store and the Claude Agent SDK has no sign-in
API. One runtime client gives every harness the same behavior.

## Verify

```sh
pnpm exec vp test packages/runtime/src/mcp-oauth/oauth.test.ts
pnpm exec playwright install chromium
pnpm test:agent-plugins:browser
```

The test starts a local OAuth provider and MCP server, signs in through `/api/agents/mcp/oauth`,
calls a tool through the stdio bridge command that harnesses launch, expires the token to check
refresh, restarts the runtime and disconnects with revocation. It checks that tokens are absent from
the snapshot, workspace, activity and harness configuration. When the `codex` command is available,
a Codex app-server with an empty `CODEX_HOME` calls the signed-in server through the bridge.
