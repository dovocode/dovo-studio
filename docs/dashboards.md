# Dashboards

Open **Dashboards** in Studio on desktop or web, or from the navigation menu on mobile. The desktop
and web command palette also has **Open Dashboards**. Connect a computer with an updated Dovo
runtime. Dashboard definitions live on the selected computer. Paired devices can open the same
dashboard over HTTP or HTTPS. Older runtimes do not offer the workspace.

1. Choose a computer and select **New dashboard**.
2. Name the dashboard and choose **Add tile**. Tile types are grouped into data sources, project
   activity, and interactive tiles.
3. Select a tile in the layout to edit its settings. Change **Width** and **Height** to see how many
   columns and rows it occupies. On desktop and web, drag the handle onto another tile to change its
   position. **Move earlier** and **Move later** work with the keyboard and on mobile.
4. Select **Save dashboard**. Use **Reload** in **Dashboard actions** to fetch dashboard edits from
   other devices or agents. If the connection drops during a save, press **Save dashboard** again
   with the same draft. A runtime with save receipts returns the original saved revision. If a save
   conflicts, Studio keeps the current draft. Reload the saved version after copying your edits or
   save the draft as a new dashboard.

Desktop and web boards use up to four columns, with fewer columns when the pane narrows. Mobile
shows two columns when there is room and keeps interactive views full screen. Use **Expand** for a
larger tile on desktop or web. A previously loaded dashboard list remains available offline. Data
and command actions need a connection to the owning computer.

## Tile types

- **HTTP data** reads a saved HTTP or HTTPS URL from the computer when you select **Refresh data**.
  It uses GET and accepts JSON or text. It uses no redirects, cookies, or configured authorization
  headers.
- **CLI data** runs a saved command on the selected computer and uses its stdout as data. Choose a
  project to run in its main checkout or **No Project** to run in the home folder. Select **Run
  command** and review the command before it starts. Use Command or TUI when you need a terminal.
- **MCP data** reads a saved tool and arguments from a configured MCP server in an existing thread.
  Use an editable thread and a tool declared read-only and non-destructive. Use MCP credentials that
  enforce read-only access at the source. Select **Refresh data** to run it.
- **Metric**, **Table**, and **Line graph** display data from HTTP, CLI, and MCP tiles. An empty
  JSON pointer selects the whole response. Use a pointer such as `/stats/durations` to select a
  field. A line graph accepts an array of numbers or objects with a numeric `value` field, in order.
  Return historical values from your API to plot a time series.
- **Command** runs a saved command and displays the terminal output. Choose the **Home folder** or a
  project's main checkout.
- **TUI** opens an interactive terminal on the dashboard's computer. Enter a **Startup command**
  such as `top`. It starts in the **Home folder** by default. You can select a project to start in
  its main checkout. Select **Start TUI** and review the computer, folder, and command. Use the live
  terminal in the tile on desktop and web. Mobile opens it full screen.
- Use **Recover run** after a lost response. It retries the same request ID. Leaving the dashboard
  detaches the viewer. Open the dashboard again to reattach. **Close session** ends the terminal.
- **Terminal** attaches to an existing terminal on the dashboard's computer. The terminal keeps its
  existing input and resize rules.
- **Iframe** embeds an HTTP or HTTPS page after you select **Load iframe**. The page must allow
  framing. Use **Studio Browser** for sites that need a browser session or an address on the paired
  computer. Its tab uses the paired computer's browser service.
- **Remote desktop** opens the existing Remote Desktop view. Enable the feature on the computer
  first. The view shows the primary display. Enable control explicitly to send input.
- **MCP App / A2UI card** opens a saved app or an interactive card published in a thread. Choose the
  source thread, then pick the saved app or card by name. Use **Enter app ID** to bind one manually.
  Studio uses the isolated app host and requires its normal permissions for tool calls.
- **Pipelines** lists runs for the selected project on **Refresh pipelines**. Select a run to open
  its details. **Threads** and **Automations** show entries from the owning computer.

## Show an A2UI card

To show an A2UI table with expandable rows, a diff, or a timeline on a dashboard, publish a card
with [`dovo_task a2ui`](a2ui.md), then add a **MCP App / A2UI card** tile. Choose the card's thread
and title and save the dashboard. Open the tile with **Open MCP App**. The tile shares the card's
saved draft and sends approved replies to the source thread. A Studio extension tile can also show a
card embedded in an [extension view](studio-extensions.md#embed-an-a2ui-card).

## Show more than one display

Select **Add display** in a data tile. Enter a title, choose a metric, line graph, or table, and
enter a JSON pointer for that card. Each pointer starts at the result selected by the tile's main
pointer. Add up to eight cards. Studio reads the source once per refresh and uses that response for
all cards. Cards fit side by side when there is room and stack on narrow screens.

Agents can set `panels` on API, CLI, and MCP tiles with entries such as
`{ "title": "Build count", "pointer": "/count", "chart": "number" }`.

## Timed refresh

For HTTP and CLI data, set **Refresh interval in seconds** to a whole number between 30 and 86,400.
Leave it blank to skip timed refresh. Save the dashboard and select **Start auto refresh** on the
tile. Studio reads the source once, then at the selected interval while the tile is open and
connected. Select **Stop auto refresh** to stop future reads. Timed refresh pauses while the
computer is offline or the browser tab is hidden. CLI refresh reads once when an overdue tile
becomes available again. Leaving the dashboard or saving a new dashboard revision stops the
interval.

Select **Load on open** for an HTTP, CLI, or MCP data tile to read it when the dashboard opens or
reconnects. A saved refresh interval runs while the tile is visible. The choice stays on the paired
computer across restarts and applies to the source you approved. For CLI data, review the project
and command before enabling it. Select **Disable load on open** to stop. The setting stays on the
paired computer when you export or share the dashboard.

For a source with **Load on open** and a saved refresh interval, open clients share the latest
reading until that interval is due. **Run command** and **Refresh data** still request an immediate
read. Source grants remain separate.

Studio keeps recent results in the current app session. It labels the last result stale while
offline, after a failed refresh, or when you reopen the tile. Once you have read an HTTP source,
Studio refreshes it when the view or window becomes active again. It keeps the last result visible
until the request succeeds. Reopening a view restores CLI and MCP results. Select **Run command**,
**Start auto refresh**, or **Refresh data** to make a new CLI or MCP read.

CLI data parses stdout as JSON when possible. Otherwise it displays stdout as text. The process has
15 seconds to finish. A failed exit reports its exit code. Raw output can be at most 1 MB and the
selected JSON value can be at most 256 KB. Use a command that can run without terminal input.

## Templates and API

Open **Dashboard actions** and select **Export dashboard** to download a `.dovo-dashboard.json` file
on desktop or web. On mobile, choose where to save or send the file in the share sheet. The file
contains the layout, tile settings, URLs, queries, and command text. It leaves out results, terminal
sessions, and bindings to local projects, terminals, threads, and apps.

Choose a computer and use **Import dashboard** to open the file as a new draft. You can also use
**Paste template** to open JSON from the clipboard. Bind the required sources, review the tile
settings, and save the draft. Import and save only store configuration.

The paired API uses POST for each operation.

| Path                           | Input                                         | Result                |
| ------------------------------ | --------------------------------------------- | --------------------- |
| `/api/dashboards/list`         | `{ dataSources: true }`                       | `{ dashboards }`      |
| `/api/dashboards/save`         | `{ dashboard, expectedRevision, requestId? }` | `{ dashboard }`       |
| `/api/dashboards/delete`       | `{ id, expectedRevision }`                    | `{ ok: true }`        |
| `/api/dashboards/read`         | `{ id, tileId, expectedRevision }`            | `{ data, updatedAt }` |
| `/api/dashboards/command-data` | `{ id, tileId, expectedRevision }`            | `{ data, updatedAt }` |
| `/api/dashboards/session`      | `{ id, tileId, expectedRevision }`            | `{ terminalId }`      |
| `/api/dashboards/run`          | `{ id, tileId, expectedRevision, requestId }` | `{ terminalId }`      |

Use the list flag on runtimes with `studioDataSourcesSupported` in the snapshot. A list request
without the flag omits dashboards with CLI data, timed API refresh, or multiple displays for
compatibility with older clients. Only paired clients can read source data.

Nightly 1038 cannot read saved dashboards with CLI tiles, timed API refresh, or multiple data
displays. One such dashboard can prevent it from listing any dashboard. Before downgrading to that
runtime, export the affected dashboards and remove those settings or tiles on the current runtime.

The runtime returns HTTP 409 for a stale revision. The read result gives `updatedAt` in Unix
milliseconds. The session result gives a terminal ID for the last run of the current command, or
`null` if the session is gone.

Use revision `0` to create a dashboard. Use the revision returned by the runtime to update, delete,
refresh, or run a saved tile. Once a command is accepted, retries with the same request ID resolve
the existing run. Read the [dashboard schemas](../packages/protocol/src/runtime/dashboards.ts) for
limits and tile settings.

## Build a dashboard with an agent

Use the `dovo_task` tool named `dashboards`. Ask the agent to build a dashboard on the computer that
owns the work. The tool can list and read definitions. A writable agent run can also create, update
and delete definitions. Open **Dashboards** and select **Reload** to see its work.

To add a published A2UI card, use a tile with `kind: "app"`, `taskId` from the publication, and
`appId` set to the publication's `id`. The same tile can open a saved MCP App.

For example, these arguments create a dashboard with an HTTP line graph and a thread tile.

```json
{
  "action": "create",
  "dashboard": {
    "title": "Delivery",
    "tiles": [
      {
        "kind": "api",
        "title": "Build duration",
        "span": 3,
        "height": 2,
        "url": "http://builds.lan/metrics",
        "pointer": "/durations",
        "chart": "line",
        "refreshSeconds": 60
      },
      { "kind": "threads", "title": "Recent threads", "span": 1, "height": 2 }
    ]
  }
}
```

For CLI data, use `kind: "cli"`, `repositoryId`, and `command` instead of `kind: "api"` and `url`.
CLI and HTTP data both accept optional `refreshSeconds`. Studio requires a paired user to start
refresh.

For a machine-only TUI, set `kind: "tui"`, `repositoryId: "dovo:scratch"`, and `command` to the
startup command. The home folder choice carries over in dashboard exports. A paired user starts the
TUI from the dashboard.

The runtime assigns IDs. For an update, first read the dashboard. Send the ID and `expectedRevision`
beside the replacement `dashboard` object. Keep the existing tile IDs and omit the ID for each new
tile. On create or update, give each intended save a new UUID in `requestId`. Reuse that ID with the
same request if the reply is lost. The agent tool saves the definition only. Open Studio to run
commands, connect viewers, and refresh data.

## Verify

Run from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/runtime --filter @dovo/mobile --filter @dovo/extension-tasks --filter @dovo/studio-shell typecheck
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/runtime/src/dashboards/dashboards.test.ts packages/runtime/src/http/endpoints/dashboards.test.ts packages/runtime/src/http/endpoints/dashboard-agent.test.ts packages/runtime/src/agent-tools/dashboards-tool.test.ts packages/runtime/src/agent-tools/context-budget.test.ts
pnpm exec vp test packages/protocol/src/runtime/dashboards.test.ts packages/studio-core/src/dashboards.test.ts packages/studio-shell/src/navigation-commands.test.ts apps/mobile/src/shell/route-paths.test.ts
pnpm exec playwright install chromium
pnpm test:dashboards:browser
```

The browser check uses the production editor with fixture runtime responses. It checks grid sizing,
command retry, iframe loading, offline drafts, timed refresh, and reconnect. The runtime tests check
saved definitions, API requests, terminal execution and retries. Physical device tests are needed
for native WebView and terminal input behavior.
