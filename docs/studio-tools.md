# Studio Tools (experimental)

Studio Tools lets an agent operate and inspect its Dovo runtime. Open **Settings → Studio Tools** on
desktop/web, or **Studio Tools (experimental)** in a computer's mobile preferences. Each part has
its own toggle; all five default to off.

| Part           | Tool               | Operations                                                                                                                            |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Threads        | studio_threads     | List/search, create drafts with project/agent/model choices, send prompts, read paginated history, wait, stop/resume, archive/restore |
| Automations    | studio_automations | Create/edit/validate/dry run workflows, configure triggers, enable/disable, run, inspect runs, wait, cancel/retry                     |
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

Paired desktop and mobile Studio clients share their saved computer connections with the runtime.
**Access paired computers** is on by default in the runtime's Studio Tools settings. It supports
headless runtimes over HTTP LAN, VPN and existing Connect connections. Each Studio Tools part still
defaults to off. Enable the required parts on both the calling and destination computers. Agents
retain their access limits at the destination.

Remote grants survive client disconnects and runtime restarts. The mobile client publishes only
while the app is active, when connections change or the app returns. It adds no background timer.
Turn off **Access paired computers** to revoke grants from remote clients. Local Studio grants
remain active. Turning it on again requires a connected client to publish its pairings again.
Forgetting a connection, changing its credentials or revoking its registering device removes its
grant. Retrieval-only registrations cannot enable control.

Credentials stay in the private pairing registry. Grants store fingerprints, and discovery never
returns tokens. Both runtimes must support paired Studio forwarding. Older destination runtimes
reject the dedicated forwarding endpoint before any tool action executes. Older clients need an
update to publish pairings to a remote runtime. UI interaction stays on the runtime's own computer
through a loopback connection. It has no computer selector and cannot be forwarded.

Most tools accept a command object containing an action and its arguments. Thread creation makes a
draft by default. Set `start:true` with a prompt to create and start together, or use resume to
execute the draft later. Supply a stable `requestId` for creation: concurrent retries and lost
replies return the original thread ID. Retrying a paired creation preserves its saved watch state.
Use `watch` to restart monitoring. Reusing an ID with different arguments is rejected. If startup
fails, the response retains the created ID with `startError`; repair/resume that thread instead of
creating another. An interrupted operation is reported as uncertain after restart, rather than
repeated blindly. Use a stable messageId when sending and a stable requestId when starting an
automation, so repeating a request after a lost reply does not execute it twice. The wait action
accepts up to 20 seconds and returns current state on timeout without cancelling work. Thread
list/history cursors are returned as before. A thread that creates a thread gets a subthread. A Bot
that creates a project thread can steer and monitor it, while the thread appears on its own in the
project. When `send` targets a Bot, the tool returns the ID and reference for a new conversation on
the Bot’s computer. Open it from the caller’s side threads. A Bot calling itself gets a subthread.
For cross-computer sends, update both runtimes. Automation run and runs take an automation ID; wait,
cancel and retry take a run ID. Runs retain their original workflow when retried. Supported triggers
are manual, schedule (cron and timezone), webhook and GitHub; workflows use the existing
trigger/task/review graph schema.

Thread reads return a short thread summary and up to 16,000 characters of recent message text. Use
the returned `before` cursor for older messages. When a message has `nextOffset`, use
`{ "action": "message", "id": "thread-id", "messageId": "message-id", "offset": 8000 }` to continue
it. Use `detail: "files"` to read saved file contents, `detail: "checkpoints"` to read the
checkpoint history, or `detail: "full"` for the older complete response shape. When `wait` finishes,
its response includes compact history. Older paired runtimes still return the full thread read and
combined browser state. Use `studio_discover` on that computer to check for
`capabilities.compactToolResults`.

Use diagnostics `activity` to see recent event headers and grouped tool calls. A tool row includes
its outcome, duration when known, command, and a short output preview. Use the returned `before`
cursor to read older activity. Use `{ "action": "event", "id": "event-id" }` to read one retained
raw event. Pass `nextOffset` as `offset` to continue a large payload. When the provider records a
separate start event, `inputEventId` opens its original arguments, even if progress and completion
appear on a later page. The duration starts at the earliest retained event for the call. When a
provider wraps a terminal command, Activity shows the recorded command once across pages. A failed
provider call remains visible with its error.

After a CI or release run starts, register its ID with `pipeline_watch` when follow-up is
authorized. Use the completion notification to continue. Use `pull_request_watch` for ongoing PR
checks when enabled and authorized. Use `studio_threads watch` for an existing thread that will
finish in the background.

New browser tabs use isolated profiles. Listing returns every live tab with its kind, title, URL and
a unified Studio reference: the user's Browser-workspace tabs appear as `workspace` (remote runtime
tabs, ID `workspace:<tabId>`) or `desktop` (desktop-local tabs, ID `desktop:<tabId>`, driven through
the desktop's page-scoped CDP host while the tab is open in the desktop Browser workspace),
alongside `thread`, `agent` and `studio` sessions. Workspace and desktop tabs are the user's live,
signed-in tabs; private-profile tabs are never listed or accessible. Choose a session ID explicitly
before operating a live tab. Desktop tabs support CSS and `text=` selectors (no `role=`) and capture
no console logs. Page actions return the accessibility tree and fresh element refs. Logs contain at
most the most recent 100 console, page-error and failed HTTP/network entries. They live only as long
as the browser session.

Use this browser workflow:

1. Use `list` and choose a session ID or reference. Use `open` for an isolated session.
2. Use the tree returned by `open` or `snapshot`. It shows roles, names, states and element
   references such as `[ref=abc-1-e4]`. Use the `elements` action only for DOM details such as
   current values, CSS selectors and select options. It leaves existing refs valid. Password values
   and file paths are excluded.
3. Use `selector: "ref=abc-1-e4"` with `click`, `fill`, `key` or `scroll` to target a tree element.
   References belong to one tab and one snapshot. A new snapshot or navigation makes old references
   invalid. DOM CSS selectors remain available as a fallback. Navigation and input return fresh page
   state. Check that state before the next action. Selectors describe the current DOM; inspect again
   if the page changes or a selector no longer matches.
4. Use `evaluate` for a focused read, such as `document.querySelector('output').textContent`, or a
   JSON object with the fields you need. It returns only the expression result and page URL/title.
   Wrap statements in an IIFE. Async expressions are supported, with a 10-second limit. This action
   can change the page and is unavailable in read-only runs.
5. Use `screenshot` only when you need pixels to check layout or appearance. It returns a PNG image
   and page URL/title. Other browser actions do not return images.

Accessibility text is limited to 32,000 characters. Live DOM element data has a separate
32,000-character budget. It includes up to 150 visible elements, including elements outside the
viewport, and up to 50 options per select. The response reports truncation through
`snapshotTruncated`, `elementsTruncated` and `optionsTruncated`. Use a focused `evaluate` read when
data is truncated. DOM element data covers the main document. Iframe entries report frame URLs;
inner frame and shadow-root controls are not included in this list. Both the isolated `browser` tool
and `studio_browsers` use this data-first workflow. `snapshot`, `elements` and `screenshot` work in
read-only runs; existing pairing and private-tab rules still apply.

The tree and reference design follows the patterns used by
[T3 Code](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/preview/ServerBrowserPage.ts),
[Playwright MCP](https://github.com/microsoft/playwright-mcp#tools) and
[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md#take_snapshot).
T3 Code namespaces native Playwright references and invalidates them after snapshots and navigation.
Playwright MCP uses accessibility trees and element references as the default interaction path.
Chrome DevTools MCP uses snapshot element IDs and separates screenshots from text snapshots.
[Browser Use MCP](https://github.com/browser-use/browser-use/blob/main/browser_use/mcp/cli_mcp.py)
also provides a separate screenshot tool alongside code and live-data reads. Dovo keeps that
separation and uses page-scoped CDP node references for desktop tabs.

Browser actions do not need browser focus. They use the selected session ID, even while you work in
another tab or window or keep Studio hidden or minimized. Keep the live tab open. Desktop tabs
disable background throttling while an agent connection is active. The last disconnect restores the
normal policy and restarts the idle timer. Hidden pages still report `document.visibilityState` as
`hidden`; sites can use this state to pause their own work.

Give `key` a `selector` to send input to that element. Without one, it uses the active element in
the target page. Give `scroll` a `selector` to scroll that element. Without one, it scrolls the
window. Both accept a CSS selector or a current tree reference. For example:

```json
{ "action": "key", "id": "desktop:tab-id", "selector": "ref=abc-1-e4", "key": "Enter" }
```

Run the desktop background check with:

```sh
pnpm exec playwright install chromium
pnpm test:agent-browser-background:native
```

This check builds the runtime and uses real Electron windows with temporary profiles. It checks tree
references, input, navigation, scroll, focus, draft preservation and connection cleanup with another
tab or window focused and Studio hidden or minimized. Linux checks need a display or `xvfb-run`. The
Linux fixture uses `--no-sandbox` for the test process only.

Verify the browser data flow from a source checkout:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/api... -r build
pnpm exec vp test packages/runtime/src/previews/agent-browser.test.ts packages/runtime/src/previews/desktop-browser.test.ts
pnpm test:studio-tools:browser
```

Threads and browser tabs share one paste-ready ID format: `studio:<runtime>:thread:<id>` and
`studio:<runtime>:browser:<id>` (the three-part `studio:<runtime>:<id>` form also works). Users copy
it from **Copy Studio ID (for agents)** in thread and browser-tab menus (on mobile, remote browser
tabs have the same action). Passing a full reference as a tool `id` unwraps it and selects its
computer, so no separate `runtimeId` is needed. If you supply both, they must select the same
computer. Use thread references with `studio_threads` and browser references with `studio_browsers`.
Thread lists and browser lists include each item's `reference`.

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
threads inherit the calling agent's permission limits, preserving narrower target restrictions. Set
`allowPermissionIncrease:true` on create/send/resume only when the user explicitly requested broader
target access. Automatic model selection preserves the resulting policy. Read-only runs still cannot
mutate threads. Automations cannot exceed the calling agent's permissions. Automation review gates
remain human-controlled. These tools do not expose runtime administration or backups.

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
