# Dashboards

Open **Dashboards** in Studio on desktop or web, or from the navigation menu on mobile. The desktop
and web command palette also has **Open Dashboards**. Connect a computer with an updated Dovo
runtime. Dashboard definitions live on the selected computer. Paired devices can open the same
dashboard over HTTP or HTTPS. Older runtimes do not offer the workspace.

1. Choose a computer and select **New dashboard**.
2. Give the dashboard a name. Select **Add tile**, then choose a tile type.
3. Configure the tile. Select another tile to open its settings. Use **Move earlier** and **Move
   later** to change its position. The width sets how many of the four grid columns the tile uses on
   desktop and web. Phones show tiles in order and open interactive views at full size.
4. Select **Save dashboard**. Use **Reload** in **Dashboard actions** to fetch dashboard edits from
   other devices or agents. If a save conflicts, Studio keeps the current draft. Reload the saved
   version after copying your edits or save the draft as a new dashboard.

Use **Expand** for a larger tile on desktop or web. A previously loaded dashboard list remains
available offline. Data and command actions need a connection to the owning computer.

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
- **Command** runs a saved command in the project's main checkout and displays the terminal output.
  **TUI** opens an interactive terminal on that checkout and starts the configured program. Select
  **Run command** and review the command before it starts. Use **Recover run** after a lost
  response. It retries the same request ID. **Close session** ends the terminal. Leaving the
  dashboard detaches the viewer.
- **Terminal** attaches to an existing terminal on the dashboard's computer. The terminal keeps its
  existing input and resize rules.
- **Iframe** embeds an HTTP or HTTPS page after you select **Load iframe**. The page must allow
  framing. Use **Studio Browser** for sites that need a browser session or an address on the paired
  computer. Its tab uses the paired computer's browser service.
- **Remote desktop** opens the existing Remote Desktop view. Enable the feature on the computer
  first. The view shows the primary display. Enable control explicitly to send input.
- **MCP App** opens a saved app. Enter its source thread and app ID. Studio uses the existing
  isolated app host and requires its normal permissions for tool calls.
- **Pipelines** lists runs for the selected project on **Refresh pipelines**. Select a run to open
  its details. **Threads** and **Automations** show entries from the owning computer.

## Show more than one display

Select **Add display** in a data tile. Enter a title, choose a metric, line graph, or table, and
enter a JSON pointer for that card. Each pointer starts at the result selected by the tile's main
pointer. Add up to eight cards. Studio reads the source once per refresh and uses that response for
all cards. Cards fit side by side when there is room and stack on narrow screens.

Agents can set `panels` on API, CLI, and MCP tiles with entries such as
`{ "title": "Build count", "pointer": "/count", "chart": "number" }`.

## Timed refresh

For HTTP and CLI data, set **Refresh interval in seconds** to a whole number between 30 and 86,400.
Leave it blank for manual refresh. Save the dashboard and select **Start auto refresh** on the tile.
Studio reads the source once, then at the selected interval while the tile is open and connected.
Select **Stop auto refresh** to stop future reads. Timed refresh pauses while the computer is
offline or the browser tab is hidden. It reads once when the tile becomes available again if a read
is overdue. Leaving the dashboard or saving a new dashboard revision clears the current activation.

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
| `/api/dashboards/save`         | `{ dashboard, expectedRevision }`             | `{ dashboard }`       |
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

The runtime assigns IDs. For an update, first read the dashboard. Send the ID and `expectedRevision`
beside the replacement `dashboard` object. Keep the existing tile IDs and omit the ID for each new
tile. The agent tool saves the definition only. Open Studio to run commands, connect viewers, and
refresh data.

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
