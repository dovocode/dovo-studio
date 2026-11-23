# A2UI cards

Studio includes a fixed A2UI renderer in its MCP Apps host. Agents describe a card with JSON data.
They do not supply executable HTML or JavaScript. Cards appear in the thread on desktop, web and
mobile. Mobile uses the existing MCP App WebView. This is not a React Native renderer.

For the wider design, protocol comparison and remaining platform work, see
[Agent-driven interfaces in Studio](agent-driven-interfaces.md).

No extra MCP server, account or login is required. Pair the client with the runtime as usual. HTTP
remains supported for LAN and VPN connections. HTTPS is optional.

## Agent tools

The regular `dovo_task a2ui` tool is independent of Studio Tools and the Artifacts setting. Start
with `{"action":"catalog"}`. The result contains the current catalog and usage rules. Then call
`publish` with a stable `key`, a `title`, `expectedRevision` and ordered A2UI messages. Use
`expectedRevision: 0` to create a card. An exact retry returns the same card and revision.

See [the issue selection example](../examples/a2ui/issue-picker.json) for a complete tool argument.
The example has a choice list, text input, checkbox and submit button. The
[change review workbench](../examples/a2ui/change-review-workbench.json) adds an overview,
searchable file comparison, configuration and a single approved response. Its data is illustrative.

Call `{"action":"read","key":"issue-picker"}` before updating that card. Supply its revision as
`expectedRevision`. Updates apply to its current snapshot. They can change components or data,
create another surface, or delete a surface. An accepted update creates a new revision of the same
card. Stale updates fail instead of replacing newer state.

Use `createSurface` with inline `components` and `dataModel` for the initial UI. The root component
must have ID `root`. Use the catalog ID `https://dovo.dev/a2ui/catalog/v1`. Every envelope must
contain `version: "1.0"` and exactly one supported operation:

- `createSurface`
- `updateComponents`
- `updateDataModel`
- `deleteSurface`

The Dovo catalog includes these 29 components:

- Layout: `Column`, `Row`, `List`, `Card`, `Divider`, `Tabs`, `Disclosure` and `Modal`.
- Media: `Image`, `Icon`, `Video` and `AudioPlayer`.
- Information: `Text`, `Badge`, `Callout`, `Metric`, `Progress`, `CodeBlock`, `BarChart`, `Diff` and
  `Timeline`.
- Input and browsing: `TextField`, `NumberField`, `CheckBox`, `ChoicePicker`, `DataTable`, `Slider`
  and `DateTimeInput`.
- Response: `Button`.

Child lists are static arrays of component IDs. Editable values use absolute JSON Pointer bindings,
such as `{"@path":"/instructions"}`. Choice values are arrays of option IDs, including single-choice
inputs. Button actions use `event.name` and optional `event.context`. Context values can be literals
or data bindings.

The renderer supports A2UI v1.0 with the Dovo catalog. It does not claim support for every A2UI
catalog or optional feature. It rejects functions, arbitrary components, dynamic list templates and
HTML. `CodeBlock` displays literal code without executing it. Use HTML artifacts for custom
documents and applications. Use native question tools for simple questions. Use secure input for
secrets. A2UI drafts and responses are stored as ordinary thread data.

## Media, dialogs and configuration

The [media and configuration example](../examples/a2ui/media-and-configuration.json) shows all seven
components together. Its sample remote URLs are placeholders.

- `Image`, `Video` and `AudioPlayer` accept HTTP and HTTPS URLs and base64 data URLs for supported
  raster image, audio and video formats. `Video.posterUrl` uses the image URL rules. Give media a
  `description` for accessibility. Remote media requires the user to select **Load**. The media
  server must allow anonymous cross-origin requests, and browser rules for mixed content still
  apply. Video and audio have playback controls.
- `Icon` uses the named icons from the A2UI Basic Catalog, such as `check`, `info` and `warning`.
- `Modal` takes the IDs of a `Button` trigger and a separate content component. The trigger opens
  the dialog locally. Use a separate button in the content to send a response if needed.
- `Slider` saves a number. Set `max`, and optionally set `min` (defaults to zero) and `steps` (the
  number of equal divisions in the range).
- `DateTimeInput` saves a local ISO string or an empty string. Use `enableTime` for a time,
  `enableDate` and `enableTime` together for a date and time, or omit both for a date. Set `min` and
  `max` in the same format as the value. Date and time values carry no time zone.

Studio extensions can embed saved cards via
[an App contribution and an App view](studio-extensions.md#embed-an-a2ui-card).

## Change details and history

Use `Diff` with a `label` and `hunks`. Each hunk has `oldStart`, `newStart`, and `lines`. Each line
has a `kind` (`context`, `add`, or `delete`) and literal `text`. Use zero as the starting line for
an empty side. The renderer calculates line numbers and shows the supplied excerpt. Use the PR or
file review view in Studio for the current repository diff.

Use `Timeline` with a `label` and ordered `items`. Each item has an `id` and `title`, plus optional
`time`, `detail`, `status`, and `tone`. Use an ISO 8601 timestamp with a UTC offset or `Z` for
`time`. The renderer shows items in the supplied order. The
[review example](../examples/a2ui/change-review-workbench.json) shows both components and a
browse-only table.

## Drafts and responses

Workspaces expand to their full content height inside the conversation. The conversation owns
vertical scrolling. Tables can still scroll horizontally. Expanding details or changing tabs updates
the inline height. The renderer uses a transparent background and follows the client's light or dark
theme. Theme changes preserve the open workspace, local navigation and input.

Tabs, disclosure, row details, table sorting and table filtering run locally. They do not invoke
tools or start a model turn. They remain usable after submission and in view-only cards. Their view
state resets when the card is reopened or its renderer model is replaced. Table row selections and
input values use saved draft bindings.

Omit `DataTable.value` for a browse-only table. For selection, bind it to an array of declared row
IDs and set `multiple: false` for a single selection. Filtering preserves selected rows outside the
visible result. Set a row's `detail` to a child component ID to open it from the first cell. One
detail panel can be open per table. `NumberField.value` is a finite number or `null` for an empty
draft. Minimum, maximum and step constraints apply on the runtime. Invalid numeric edits stay
visible locally until corrected. Required values are checked before an approval request.

Studio saves input on the runtime while the user edits it. Reopening a card restores the last
confirmed draft. Unsaved edits during a connection failure stay visible in the open view. Refresh
requires confirmation before it replaces a failed local draft. Closing that view can lose edits that
the runtime did not confirm.

Use **Retry saving draft** after a connection failure. Studio first checks the runtime's version. It
can recover a lost acknowledgement without repeating a confirmed write. It rejects the retry if
another device changed the draft.

Draft writes use a version check. If another device changes the draft, Studio keeps the local input
visible and reports a conflict. Load the current card to replace that local input. Compatible agent
updates preserve the saved draft. An update that cannot preserve edited fields fails.

Open cards receive publication notifications through the existing MCP Apps host. They load agent
updates without a polling loop. If local edits are unsaved or awaiting acknowledgement, Studio keeps
them visible and offers the existing explicit load-and-replace choice.

A button requests human approval to send the resolved event and input values to the thread. The
runtime validates required fields, choice values, component identity and the current revision. It
resolves event context from the saved component definition. The client cannot supply a different
action or command. Declining approval keeps the card available. A sent response locks that revision.
The agent can publish an update to continue the interaction.

Responses use the existing thread message path. A paused queue stays paused. A response grants no
permission to run commands or change external systems. Read-only threads can publish and view cards,
but cannot submit responses. Stop cancels pending approval. The runtime checks permissions again
after approval.

Action receipts prevent duplicate delivery for retries with the same request identity. A second
device cannot submit an already recorded revision. If delivery fails after it starts, the card stays
locked and reports unconfirmed delivery. Check the thread before asking the agent for another card.
Runtime restart restores cards and drafts without replaying actions.

## Limits and maintenance

Each card supports at most four surfaces and 200 components. A child list supports at most 100
entries. Input strings support at most 4,000 characters. A publication accepts at most 32 messages.
UI state is limited to 256 KiB. The runtime stores compact snapshots instead of a growing message
log. The runtime bundles the renderer, its styles and its icons. Media comes from the component URL.

A table supports 100 rows and 12 columns. Tabs support eight child panels. A bar chart and a
timeline each support 40 items. A diff supports eight hunks and 200 lines in total. These limits
stay within the existing state and component budgets.

The upstream core and React renderer are pinned to `0.15.0`. Their protocol version is `1.0`. The
renderer package uses Zod 3. The MCP Apps SDK uses the host's Zod 4 context through
`@dovo/studio-ui/mcp-app-sdk`. Keep these separate when upgrading either dependency.

Dovo checks the byte limit before parsing publications, saved cards and input values. The Zod
3.25.76 patch checks array and set size limits before validating elements. It applies to both module
formats and leaves valid inputs unchanged. The version-based production audit still reports the
upstream advisory. Replace the patch when A2UI supports a fixed upstream version.
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

## Verification

The [Lean state model](a2ui-verification.md) checks the draft and response rules. The runtime tests
exercise the corresponding behavior against SQLite.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/build-mcp-apps.mjs
pnpm --filter @dovo/runtime... -r build
pnpm --filter @dovo/a2ui typecheck
pnpm exec vp test packages/protocol/src/a2ui.test.ts packages/runtime/src/mcp-apps/a2ui.test.ts packages/runtime/src/agent-tools/interactions.test.ts
pnpm exec playwright install chromium
pnpm test:a2ui:browser
pnpm test:mcp-apps:browser
```

The browser check runs the bundled renderer inside the real nested MCP App host. It connects to a
local runtime through the paired-client HTTP API. It tests desktop and mobile host modes, themes,
input bindings, draft restore, conflicts, approval and response receipts. It uses a fixture message
sink instead of a live agent. Mobile host mode in Chromium does not establish physical iOS or
Android WebView behavior.
