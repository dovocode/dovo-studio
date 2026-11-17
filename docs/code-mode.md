# Code mode

Studio exposes `dovo_task code` to providers that support its MCP tools. It runs async JavaScript in
a fresh QuickJS heap. Scripts can discover schemas, combine calls, filter results and return
selected output.

Agents should prefer code mode for batches and large results. Direct tool calls and native file or
shell tools remain allowed when the provider offers them. Code mode is a choice for each task. It
does not change access or approval rules.

```js
const catalog = await tools.search({ source: 'harness', query: 'file' })
print(catalog)
const file = await tools.harness.read_file({ path: 'src/app.ts' })
return file.contents
```

Use these namespaces:

| Namespace                       | Tools                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `tools.dovo.NAME(args)`         | Enabled Studio task tools, including browser, vision, questions and progress |
| `tools.harness.NAME(args)`      | Studio file, search and terminal equivalents                                 |
| `tools.mcp[SERVER][NAME](args)` | Model-visible tools from configured MCP servers                              |

Most provider adapters do not expose callable APIs for their native file or shell tools. Studio
provides equivalents under the run's access rules. This does not expose a provider's private SDK or
remove its native tools.

## Discover and compose

`tools.search({ source, server, query })` returns tool schemas. Omit `source` to find Studio tools,
file tools and MCP server names. Select `source: 'mcp'` and a server name to load that server's
tools. Discovery does not enable disabled tools.

```js
print(await tools.search({ source: 'mcp' }))
print(await tools.search({ source: 'mcp', server: 'github', query: 'issue' }))
```

`data(result)` returns structured content, parsed JSON text or plain text. `print(value)` records
output. Return or print a complete tool result to preserve its image and audio blocks.

```js
const screenshot = await tools.dovo.browser({ action: 'screenshot', id: 'returned-browser-id' })
const image = screenshot.content.find((item) => item.type === 'image')
return await tools.dovo.vision({
  action: 'ocr',
  image: { data: image.data, mimeType: image.mimeType },
})
```

## Files and commands

File tools are `read_file`, `write_file`, `list_files` and `search`. Paths are relative to the run
checkout. Pass `checkoutId` for an inherited linked checkout. New links need a new provider turn.

Text reads and writes accept UTF-8 files up to 1 MiB. To update a file, pass its exact previous
contents as `expectedContents`. Pass `null` to create a new file. A conflict stops the write. Parent
directories must exist. Paths cannot leave the checkout or enter `.git`.

Terminal tools reuse Studio's visible, persistent terminal sessions. Use `terminal_run`,
`terminal_read`, `terminal_input` and `terminal_close`. Read-only runs cannot start commands. Studio
terminals remain unavailable where they cannot enforce the provider's native sandbox. Initial
commands require approval when the run policy requires it. Later terminal input uses the same owned
session and access checks. Cancellation does not stop an already started persistent terminal. Close
it explicitly when finished.

## Limits and recovery

Each execution has a 64 MiB JavaScript heap, a 512 KiB stack, 2 seconds of active JavaScript CPU
time and a 12.5-minute wall deadline. Tool waits do not use the JavaScript CPU budget. Scripts can
make 100 calls with at most 8 calls active at once. Code is limited to 100 KB. Each tool value,
returned value and total printed output is limited to 4 MiB. There are at most 100 print records.

Scripts have no Node globals, filesystem, network, imports or package loader. They reach resources
only through checked tool calls. Calls keep run identity, cancellation, approval and linked-checkout
restrictions. MCP tools in read-only runs must declare a read-only hint and must not declare a
destructive hint. These hints are server claims, not an operating-system sandbox.

Calls are not a transaction. An error or cancellation does not undo completed calls. Inspect the
current state before retrying a mutation. Await calls whose results matter.

## Verification

```sh
pnpm --filter @dovo/runtime build
pnpm exec vp test packages/runtime/src/agent-tools/code-runtime.test.ts packages/runtime/src/agent-tools/code-dispatch.test.ts packages/runtime/src/agent-tools/code-mode.test.ts packages/runtime/src/mcp-apps/bridge.test.ts --maxWorkers=3
```

## Claude proxies and UTCP

Claude uses the same Dovo runner through its local MCP connection when its model requests go through
a proxy. The proxy does not execute the script or receive local MCP credentials. See
[Claude proxy setup](agent-providers.md#claude-through-a-proxy).

[UTCP code-mode](https://github.com/universal-tool-calling-protocol/code-mode) also supports typed
tool discovery and composed JavaScript calls. Dovo keeps its existing QuickJS runner and checked
tool namespaces. No UTCP dependency is required. Native tools remain available alongside code mode.
