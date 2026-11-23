# Studio extensions

On desktop, web, or mobile, open **Settings → Agents & tools → Studio extensions**. Choose a paired
computer that supports extensions. Paste a manifest in **Add extension manifest** and select **Stage
manifest**. Select **Review draft** and check the proposed manifest. Select **Install draft** in the
review to make its contributions available on that computer. If the draft changes, close the review
and open the new draft. Staging and installation do not connect to a tool server, run a command, or
open a view.

On mobile, new labels for dashboards and extensions use English until translations are available.

## What an extension can add

- **Studio launchers** open Threads, Terminals, Browser, Dashboards, Automations, or Pull requests.
- **MCP tool actions** call one named tool on a configured MCP server. The manifest names the source
  thread, server, tool, and JSON arguments. Studio displays the result in the extension view or
  tile. Use a source with read-only credentials. The MCP server's read-only annotation is a
  declaration. The runtime checks the tool declaration and validates the arguments before each call.
- **Data sources** read an HTTP API or capture CLI stdout. Use a source as a dashboard tile or bind
  its result to Studio components in an extension view.
- **MCP App views** open a saved MCP App in its original thread's app host. Give the source thread
  ID and saved app ID. The app keeps the existing sandbox, permissions, and tool approvals.
- **Settings** declare text and switch fields. Studio renders a settings view for each extension
  with fields. A tool can map settings to named input arguments. Studio stores the values on the
  paired computer and retains compatible values during an update.
- **Component views** use Studio controls in a settings section, tool view, standalone page, or
  dashboard tile. They can show settings, call declared tools, and display fields from the result.
- **Dashboard tiles** use any installed contribution. Edit a dashboard, add a **Studio extension**
  tile, and choose a contribution. Exported dashboards keep extension and contribution IDs. Install
  the matching extension on the destination computer to use the tile there.

On desktop and web, search for the extension name in the command palette to open its settings page
or focus a specific contribution. Actions run only when selected in that view or on a dashboard.
Studio loads extension definitions when you open an extension view, a dashboard with an extension
tile, or the command palette.

## Open and pin extension pages

Select a page in **Studio extensions** to open it in the main workspace. On desktop and web, you can
also search for it in the command palette. Use **Pin to sidebar** on desktop or web, or **Pin to
navigation** on mobile. The shortcut appears when that computer is selected. Use the same control to
unpin it. Disable the extension to hide its shortcuts. Enable it again to restore them.

Use the UI SDK to define the page, its API source, and the Studio controls that display its data.

```ts
import {
  apiSource,
  defineExtension,
  page,
  result,
  sourceControls,
} from '@dovo/protocol/studio-extension-sdk'

const health = apiSource({
  id: 'health-feed',
  title: 'Service status',
  url: 'http://service.lan/status',
  refreshSeconds: 60,
})

export default defineExtension({
  id: 'example.service-status',
  name: 'Service status',
  contributions: [
    health,
    page({
      id: 'overview',
      title: 'Service overview',
      root: {
        id: 'summary',
        kind: 'card',
        children: [
          sourceControls('refresh', health),
          { id: 'status', kind: 'status', value: result(health, 'status') },
          dataGrid({
            id: 'metrics',
            value: result(health),
            panels: [
              { title: 'Active builds', pointer: '/active', chart: 'number' },
              { title: 'Latency', pointer: '/latency', chart: 'line' },
              { title: 'Workers', pointer: '/workers', chart: 'table' },
            ],
          }),
        ],
      },
    }),
  ],
})
```

Use `cliSource()` for command output. Both source helpers default to a table and the whole result.
Use `sourceControls()` to place refresh controls in the layout. If you omit it, Studio places
refresh controls above the components that use the source. Use the other UI SDK components for
settings, tabs, dialogs, buttons, menus, and custom fallbacks. An agent can create and stage these
pages. Paired users control pins and start source reads.

## Add HTTP or CLI data

Add an `api` or `cli` contribution to the manifest. An API source takes `url` and reads it with GET.
A CLI source takes `repositoryId` and `command` and runs on that computer. Both use `pointer` to
select part of the response and `chart` to choose the standalone display. Chart values are `table`,
`number`, and `line`.

```json
{
  "id": "build-count",
  "kind": "cli",
  "title": "Build count",
  "repositoryId": "PROJECT_ID",
  "command": "your-cli --json",
  "pointer": "/count",
  "chart": "number",
  "refreshSeconds": 60
}
```

In a typed UI SDK view, use `result('build-count')` as the value of a metric. Studio renders refresh
controls for each source the view references. Use `result('build-count', 'field')` to read a field
when the selected result is an object. The contribution also appears on the extension page and can
be selected directly for a dashboard tile.

Leave `refreshSeconds` out to skip timed refresh. With an interval of 30 to 86,400 seconds, a paired
user can start or stop auto refresh. CLI sources show the exact command for confirmation. The
schedule pauses when the view is closed or disconnected. It reads once when the view is available
again if a read is overdue. Saving unrelated settings preserves the result and schedule. Install and
agent authoring only store the source. Agents cannot run these contributions. The
[dashboard data source limits](dashboards.md#timed-refresh) also apply to extensions.

Studio keeps the last API or CLI result for each source in the current app session. It restores the
result in cards and views that use the same source, including after a sidebar change. A previously
read API source refreshes when its view becomes active again. Reopening a view restores a CLI
result. The user can run the command again or start a new interval.

Use a runtime that supports data sources to manage extensions that contain API or CLI definitions.
Older runtimes can fail to load saved manifests that contain these contribution types.

## Install from the marketplace

In **Studio extensions**, select **Browse extension marketplace**. Search by name, publisher, or
description. Preview a package to see its version, contributions, and any dashboard template.

For each MCP tool or app, choose a thread on the selected computer and an available local source.
For a CLI source, choose a project or **No Project** on that computer. Tools use a configured MCP
server. Apps use a saved MCP App from that thread. Studio checks the source selection when it stages
the package. For tools, the runtime checks that the named tool declares read-only access when you
run it.

Select **Stage package**, then **Review staged draft**. Review the exact manifest with the local
bindings and select **Install draft**. To change an existing installation, preview the required
version, bind its sources, and stage it again. Studio keeps compatible settings and the previous
installed version. Use **Restore previous version** to roll back.

If the package has a dashboard template, select **Add dashboard** after you install and enable that
release. Studio adds the dashboard to the same computer. You can then edit or export it from
**Dashboards**. Repeating **Add dashboard** keeps the dashboard already on the computer.

### Use the marketplace with an agent

Send these requests to `studio_extensions`. Use the package ID and digest returned by the search.
For the request schema, call `catalog` with `component: "marketplace"`.

```json
{ "action": "marketplace", "marketplace": { "action": "list", "query": "service" } }
```

| Marketplace action | Inputs                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `list`             | Optional `query`. Returns package names, publishers, versions, and digests.                   |
| `read`             | Package `id` and `digest`. Returns the portable manifest and dashboard template.              |
| `sources`          | No extra inputs for an agent. Returns the available sources in its current thread.            |
| `stage`            | Package `id`, `digest`, `expectedRevision`, and `bindings`. Use revision 0 for a new install. |

Each binding has a `contributionId` and a `source` containing the MCP server name, saved app ID, or
CLI project ID. An agent binds sources in its current thread. Set `bindings: []` for a package with
no sources. The standard `install` action still requires the computer's agent-install opt-in and
ownership checks. A paired user must review and install a staged draft with a CLI source.

### Publish a package

Submit a pull request to the Studio repository that adds a release to
`packages/runtime/src/studio-extensions/marketplace-catalog.json`. The catalog ships with the
runtime. Approved additions appear when a computer installs a runtime release that includes them.
Browsing the catalog and installing packages use the paired computer. The curated catalog requires
no sign-in.

- Give the extension a stable, publisher-scoped ID and set the release's `publisher`, `description`,
  and `version` as `major.minor.patch`. The manifest itself still uses version 1.
- Build the manifest with the typed UI SDK. For MCP tools, set `taskId` and `server` to
  `marketplace-source`. For MCP Apps, set `taskId` and `appId` to `marketplace-source`. Keep local
  thread IDs, credentials, and account data out of the package.
- For an optional dashboard, supply a stable UUID, title, and tiles that reference contributions in
  the package. A dashboard uses the same UUID in each release so an update keeps existing
  dashboards.
- Add a new release for each change and keep published package bytes intact. Studio verifies the
  release digest at staging and records the version and digest through installation and rollback.
- Run the runtime and browser checks below before submitting the catalog change.

## Build with an agent

Use the `dovo_task` tool `studio_extensions`. The `catalog` action returns a manifest example and
the component names and UI SDK entry point. Use `{"action":"catalog","component":"custom"}` to get
one component schema, or use `component: "manifest"` to get the full JSON Schema. Ask the agent to
validate the manifest and stage it. Install the draft in Studio. To let an agent install its own
drafts, turn on **Allow agents to install their own extensions on this computer**. Studio leaves
this setting off by default. A paired user must install drafts with CLI sources, even when this
setting is on. An agent can replace a pending draft from its own thread. A paired user can discard
or replace a draft from any author.

| Action     | Inputs                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog`  | Optional `component` kind or `manifest` for a schema                                                                                       |
| `read`     | Extension `id`. Returns the draft and installed manifest that this thread authored. Saved setting values are private to the paired client. |
| `install`  | Extension `id` and `expectedRevision`. Requires opt-in and a draft from this thread without CLI sources.                                   |
| `validate` | `manifest`                                                                                                                                 |
| `stage`    | `manifest`, `expectedRevision`. Use 0 for a new ID.                                                                                        |
| `list`     | None. Returns revisions and tool contributions available in the current thread.                                                            |
| `call`     | Extension `id`, `contributionId`, and `expectedRevision`. Calls an installed read-only tool bound to the current thread.                   |

For example, configure an MCP server named `health` for an existing thread. Replace `THREAD_ID` with
that thread's ID. The MCP server must expose a read-only tool named `service_status` that accepts a
`service` string argument.

```json
{
  "id": "example.operations",
  "version": 1,
  "name": "Operations",
  "settings": [{ "id": "service", "title": "Service name", "default": "web" }],
  "contributions": [
    {
      "id": "status",
      "kind": "tool",
      "title": "Read service status",
      "taskId": "THREAD_ID",
      "server": "health",
      "tool": "service_status",
      "inputs": { "service": "service" }
    },
    {
      "id": "terminal",
      "kind": "studio",
      "title": "Open terminals",
      "destination": "terminal"
    }
  ]
}
```

## Use the typed UI SDK

In the Studio workspace, import the SDK from `@dovo/protocol/studio-extension-sdk`. The SDK provides
all 22 component kinds and checks their props in TypeScript. Compose nested components with `view`.
Use `defineExtension` to produce the flat manifest and check that its settings, tool actions, and
result bindings exist. Build the protocol package before running the example with Node.

```sh
pnpm --filter @dovo/protocol build
```

```ts
import { defineExtension, result, setting, view } from '@dovo/protocol/studio-extension-sdk'

const manifest = defineExtension({
  id: 'example.operations',
  name: 'Operations',
  settings: [{ id: 'service', title: 'Service name', default: 'web' }],
  contributions: [
    {
      id: 'status',
      kind: 'tool',
      title: 'Read service status',
      taskId: 'THREAD_ID',
      server: 'health',
      tool: 'service_status',
      inputs: { service: 'service' },
    },
    view({
      id: 'overview',
      title: 'Service overview',
      placement: 'settings',
      root: {
        id: 'card',
        kind: 'card',
        children: [
          { id: 'service', kind: 'input', label: 'Service', setting: 'service' },
          { id: 'current', kind: 'text', value: setting('service') },
          { id: 'refresh', kind: 'button', label: 'Read status', action: 'status' },
          { id: 'health', kind: 'badge', value: result('status', 'health') },
        ],
      },
    }),
  ],
})

console.log(JSON.stringify(manifest, null, 2))
```

Replace `THREAD_ID` and the MCP server and tool names. Pass the JSON manifest to `studio_extensions`
with `validate`, then `stage`. The same view can appear in extension settings and as a dashboard
tile. Studio supplies the desktop, web, and mobile renderers.

Agents working outside the Studio workspace can request the manifest JSON Schema with `catalog` and
`component: "manifest"`. Use the returned `schema` object for JSON editor completion. For
TypeScript, save that object as a literal `as const` and use `FromSchema<typeof schema>` from
`json-schema-to-ts` as the manifest type. Run `studio_extensions validate` to check rules that
depend on references between nodes and contributions.

## Build a component view

Add a `view` contribution as shown below. Use `placement: "settings"` to show it in the extension
settings. Use `placement: "tool"` for an on-demand view. Both placements can be dashboard tiles.

```json
{
  "id": "overview",
  "title": "Service overview",
  "kind": "view",
  "placement": "settings",
  "view": {
    "version": 1,
    "root": "card",
    "nodes": [
      { "id": "card", "kind": "card", "children": ["service", "refresh", "health"] },
      { "id": "service", "kind": "input", "label": "Service", "setting": "service" },
      { "id": "refresh", "kind": "button", "label": "Read status", "action": "status" },
      { "id": "health", "kind": "badge", "value": { "result": "status", "path": ["health"] } }
    ]
  }
}
```

| Use           | Component kinds                                     |
| ------------- | --------------------------------------------------- |
| Layout        | `stack`, `row`, `card`, `separator`                 |
| Content       | `text`, `badge`, `status`, `empty`, `metric`        |
| Tool actions  | `button`, `menu`                                    |
| Settings      | `input`, `textarea`, `switch`, `checkbox`, `select` |
| Panels        | `tabs`, `disclosure`, `dialog`                      |
| Data          | `table`, `chart`                                    |
| Custom layout | `custom`                                            |

Give each node a unique ID and one place in the tree. A view can have up to 64 nodes and 12 levels.
Use a literal value or bind one to a named setting with `{"setting":"service"}`. To read a tool
result, give its tool contribution ID and an optional path. For example, `["items","0","name"]`
selects the name of the first item. Results stay in the open view. Studio waits for a click before
it calls a tool. Save edits before running a tool that uses those settings. A revision change keeps
pending edits to compatible fields. If another client changes a field you are editing, Studio shows
the saved value and pauses saving. Choose **Use saved values** or **Keep my edits**, then save any
remaining edits. If a save conflicts with a newer revision, Studio reloads the settings and shows
the error.

For a custom component, set `fallback` to the ID of a Studio component in the same tree. For
example, this node uses the standard `health` badge as its fallback.

```json
{
  "id": "health-diagram",
  "kind": "custom",
  "label": "Service health",
  "fallback": "health",
  "component": {
    "type": "diagram",
    "shapes": [{ "kind": "circle", "x": 500, "y": 500, "radius": 200, "tone": "accent" }],
    "actions": [{ "label": "Refresh health", "action": "status" }]
  }
}
```

Replace the reference to `health` in the card with `health-diagram` and add the custom node to the
tree. Diagrams use a 1,000 by 1,000 coordinate space. They support `rect`, `circle`, and `text`
shapes and up to eight Studio action buttons. Each text shape can bind to one declared value. Studio
uses the fallback if it cannot render the custom type. Users can also switch to the fallback with
**Show Studio components**. Put renderer-specific JSON in the optional `component.props` object. The
object can contain up to 8,192 JSON characters. Studio can display the fallback for unrecognized
types with props. Update older clients to review and install drafts that use props. Use an MCP App
contribution for an HTML application with its own sandbox and permissions.

Use a Studio client and runtime that support component views to review, install, and display these
contributions. Older clients can still list and manage the extension's other contributions.

## Failure and recovery

Studio renders manifests as data. It loads no extension code at startup. Extension tool calls use
the runtime's existing MCP connections and credentials. The extension gives the user a result or a
local error within 10 seconds. A slow call occupies a bounded slot until its upstream work ends.
Disabling or removing an extension cancels its pending tool requests and prevents new calls.

Use **Disable extension** or **Remove extension** from Settings when a contribution fails. **Restore
previous version** reinstalls the last manifest and its settings. This works even when the current
tool server is unreachable. Selecting an existing MCP App still uses the platform's existing app
renderer and its original thread permissions.

## Verify

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/protocol/src/studio-extension-sdk.test.ts packages/protocol/src/runtime/studio-extension-views.test.ts packages/runtime/src/http/endpoints/studio-extensions.test.ts packages/runtime/src/agent-tools/dashboards-tool.test.ts packages/runtime/src/agent-tools/context-budget.test.ts
pnpm exec playwright install chromium
pnpm test:dashboards:browser
```

The runtime integration check stalls an extension's MCP call and verifies that the paired client can
still read the draft, query the running terminal, and disable the extension. The browser check uses
production views with fixture responses. It checks staging, installation, settings, and dashboard
tiles. It also covers custom component fallback, result binding, and retaining a settings draft
while the computer reconnects. Native views require separate device verification.
