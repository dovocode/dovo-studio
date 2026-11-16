# A2UI cards

Studio includes a fixed A2UI renderer in its MCP Apps host. Agents describe a card with JSON data.
They do not supply HTML or JavaScript. Cards appear in the thread on desktop, web and mobile. Mobile
uses the existing MCP App WebView. This is not a React Native renderer.

No extra MCP server, account or login is required. Pair the client with the runtime as usual. HTTP
remains supported for LAN and VPN connections. HTTPS is optional.

## Agent tools

The regular `dovo_task a2ui` tool is independent of Studio Tools and the Artifacts setting. Start
with `{"action":"catalog"}`. The result contains the current catalog and usage rules. Then call
`publish` with a stable `key`, a `title`, `expectedRevision` and ordered A2UI messages. Use
`expectedRevision: 0` to create a card. An exact retry returns the same card and revision.

See [the issue selection example](../examples/a2ui/issue-picker.json) for a complete tool argument.
The example has a choice list, text input, checkbox and submit button.

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

The catalog includes `Text`, `Column`, `Row`, `List`, `Card`, `Divider`, `TextField`, `CheckBox`,
`ChoicePicker` and `Button`. Child lists are static arrays of component IDs. Editable values use
absolute JSON Pointer bindings, such as `{"@path":"/instructions"}`. Choice values are arrays of
option IDs, including single-choice inputs. Button actions use `event.name` and optional
`event.context`. Context values can be literals or data bindings.

The renderer supports A2UI v1.0 with the Dovo catalog. It does not claim support for every A2UI
catalog or optional feature. It rejects functions, arbitrary components, dynamic list templates,
HTML and URLs. Use HTML artifacts for custom documents and applications. Use native question tools
for simple questions. Use secure input for secrets. A2UI drafts and responses are stored as ordinary
thread data.

## Drafts and responses

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
log. The generated renderer is bundled with the runtime. It loads no external assets or packages.

The upstream core and React renderer are pinned to `0.15.0`. Their protocol version is `1.0`. The
renderer package uses Zod 3. The MCP Apps SDK uses the host's Zod 4 context through
`@dovo/studio-ui/mcp-app-sdk`. Keep these separate when upgrading either dependency.

## Verification

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
