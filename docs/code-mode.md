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
tools. Discovery does not enable disabled tools. Code mode filters MCP tool names and descriptions
before deciding whether to retain the result.

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

For a noninteractive check, pass `check: true` to `terminal_run`. It runs once in a new terminal
using the platform shell. The response includes the exit code when the process finishes, up to 3,000
characters of its log, and test names when the output uses a recognized format. The tool waits up to
10 seconds by default. Set `waitMs` between 0 and 20,000. If the check is still running, use
`terminal_read` with its ID, `summary: true` and a wait time. The full retained log remains
available in the terminal.

## Limits and recovery

Each execution has a 64 MiB JavaScript heap, a 512 KiB stack, 2 seconds of active JavaScript CPU
time and a 12.5-minute wall deadline. Tool waits do not use the JavaScript CPU budget. Scripts can
make 100 calls with at most 8 calls active at once. Code is limited to 100 KB. Each tool value,
returned value and total printed output is limited to 4 MiB. There are at most 100 print records.
The guest also has a 4 MiB budget for incoming tool results per execution, including retained result
previews. Code mode returns a reference when a result exceeds the remaining budget and the reference
fits, or when the final text output exceeds 64 KiB. Read a reference with
`tools.harness.read_tool_result({resultId, offset, limit})` in the same thread. Leave out `limit` to
return up to 8,192 UTF-16 code units per page. Pass the returned `nextOffset` to read the next page.
Larger requested pages can be shorter than `limit` to fit the response. Join all pages before
parsing the retained JSON or decoding characters that span page boundaries. Use a fresh code call
when the guest reaches its input limit. If a retained reference cannot fit in the guest, the error
gives its result ID. Result references expire as described by the tool. A reference to assembled
Code mode output also expires if its tool process stops.

Scripts have no Node globals, filesystem, network, imports or package loader. They reach resources
only through checked tool calls. Calls keep run identity, cancellation, approval and linked-checkout
restrictions. MCP tools in read-only runs must declare a read-only hint and must not declare a
destructive hint. These hints are server claims, not an operating-system sandbox.

Calls are not a transaction. An error or cancellation does not undo completed calls. Inspect the
current state before retrying a mutation. Await calls whose results matter. Failed MCP calls reject
with an error. Code mode shortens long error messages.

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
