# Studio Tools (experimental)

Studio Tools lets an agent operate and inspect its Dovo runtime. Open **Settings → Studio Tools** on
desktop/web, or **Studio Tools (experimental)** in a computer's mobile preferences. Each part has
its own toggle; all five default to off.

| Part           | Tool               | Operations                                                                                                                            |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Threads        | studio_threads     | List/search, create drafts with project/agent/model choices, send prompts, read paginated history, wait, stop/resume, archive/restore |
| Automations    | studio_automations | Create/edit/validate workflows, configure triggers, enable/disable, run, inspect runs, wait, cancel/retry                             |
| Browsers       | studio_browsers    | List/open/close tabs, navigate/interact, capture screenshots/accessibility snapshots, inspect console and failed-request logs         |
| UI interaction | studio_ui          | Inspect and control live desktop/web Studio sessions on this machine only                                                             |
| Diagnostics    | studio_diagnostics | Read runtime health and paginated activity, optionally scoped to a thread/run                                                         |

The discovery tool, studio_discover, accompanies any enabled part. It returns project IDs/defaults
and configured agents/models, plus the computers already paired in the local Studio app. Pass
`runtimeId` from `computers` to discovery, threads, automations, browsers or diagnostics to select a
paired computer; omit it (or use `local`) for this computer. Pass repositoryId for project-scoped
agents and agentId for its available model catalog. Project, thread, browser and run IDs and
pagination cursors belong to the selected computer. Existing browser and Device Hub tools remain
independently available.

Keep Studio open and connected to its local runtime to make its saved computer pairings available.
This also works while viewing another computer in Studio, provided the local runtime remains
connected. Studio renews a private, in-memory pairing registration every 15 seconds; registrations
expire after 45 seconds without renewal. Tokens stay private and are never returned by discovery.
Removing a saved connection updates the registration. Tools must be enabled on both the calling and
destination runtime; scoped agents retain their read-only access, enabled parts and permission
ceilings at the destination. Both runtimes must support paired Studio forwarding; older destination
runtimes reject the dedicated forwarding endpoint before any tool action executes. HTTP LAN/VPN
addresses remain supported. UI interaction has no computer selector and cannot be forwarded.

Most tools accept a command object containing an action and its arguments. Thread creation makes a
draft. Use resume to execute its initial prompt, or send to add a prompt and start. Use a stable
messageId when sending and a stable requestId when starting an automation, so repeating a request
after a lost reply does not execute it twice. The wait action accepts up to 20 seconds and returns
current state on timeout without cancelling work. Thread list/history cursors are returned as
before. Automation run and runs take an automation ID; wait, cancel and retry take a run ID. Runs
retain their original workflow when retried. Supported triggers are manual, schedule (cron and
timezone), webhook and GitHub; workflows use the existing trigger/task/review graph schema.

New browser tabs use isolated profiles. Listing also exposes existing runtime browser tabs; choose
the returned session ID explicitly before operating a live tab. Page actions return PNG screenshots
and accessibility snapshots. Logs contain at most the most recent 100 console, page-error and failed
HTTP/network entries. They live only as long as the browser session.

**UI debugging is local to the machine.** Both UI control and client registration require a loopback
runtime connection (localhost, 127.0.0.1 or ::1). Remote paired desktop/web clients cannot register
for UI control. Select a local session with list, then use snapshot to obtain visible text and CSS
selectors. Take another snapshot after changes. UI commands cannot evaluate scripts or operate
password/file fields or marked human approval controls. For native mobile interaction and
screenshots use Device Hub; for browser screenshots use browser tools. The UI bridge returns
structured state, not a rendered screenshot. Threads, automations, browsers and diagnostics retain
their normal runtime access; the local restriction applies only to UI debugging.

Tool registration and run credentials include only enabled parts. Turning a part off rejects further
calls immediately, including calls from existing agents. Newly enabled parts appear on the next
agent turn. Read-only runs can inspect state but cannot create, send, execute or interact. Starting
threads/workflows cannot exceed the calling agent's permissions. Automation review gates remain
human-controlled. These tools do not expose runtime administration or backups.

Existing paired/run authentication remains required. No account is needed; HTTP runtime addresses
over LAN/VPN remain supported.

## Integrating other agents over stdio MCP

The standalone MCP server communicates over stdin/stdout. Enable the parts under Settings → Studio
Tools, then configure your agent's MCP client:

```json
{
  "mcpServers": {
    "dovo-studio": {
      "command": "dovo-server",
      "args": ["studio-tools"],
      "env": {
        "DOVO_RUNTIME_URL": "http://127.0.0.1:PORT",
        "DOVO_DEVICE_TOKEN": "PAIRED_DEVICE_TOKEN"
      }
    }
  }
}
```

Replace PORT with the runtime's port and use a token obtained through Dovo's existing pairing flow.
Use a dedicated paired device for each integration so its access can be revoked from device
settings. Treat the token as a secret: an external integration has paired-client access to enabled
Studio Tools, including creating and executing threads and automations. Scoped in-runtime agents
continue to use their run credentials through dovo_task; those credentials cannot access this
external endpoint.

LAN/VPN HTTP addresses work for threads, automations, browsers and diagnostics. UI tools are exposed
only on a direct loopback connection to the runtime on the Studio machine. Forwarded headers do not
change this decision. Tool lists reflect current toggles on each request; clients may need to
refresh their tool list after settings change. Disabling a part or revoking its device token takes
effect on subsequent requests, including calls from an already connected MCP client.

For a source checkout, build the API and runtime, then use `node` with args
`["/absolute/path/to/apps/api/dist/server-cli.js", "studio-tools"]`. The installed nightly server
provides the `dovo-server studio-tools` command. Only the existing runtime API uses HTTP; no HTTP
MCP endpoint is exposed.
