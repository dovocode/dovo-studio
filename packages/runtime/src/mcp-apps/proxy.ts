// Thread-scoped stdio transport. Upstream credentials and processes stay in the runtime.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
const address = process.env.DOVO_MCP_BRIDGE_URL
const credential = process.env.DOVO_MCP_BRIDGE_TOKEN
if (!address || !credential) throw new Error('Missing MCP bridge scope')
const server = new Server(
  { name: 'dovo-mcp-bridge', version: '1.0.0' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  },
)
async function rpc(method: string, params: unknown, signal: AbortSignal) {
  const response = await fetch(address!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]),
  })
  const value: unknown = await response.json()
  if (!response.ok) throw new Error('MCP bridge request failed')
  if (!value || typeof value !== 'object' || !('result' in value))
    throw new Error('Invalid MCP bridge response')
  return value.result
}
for (const schema of [
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
]) {
  server.setRequestHandler(schema, async (request, extra) => {
    const result = await rpc(request.method, request.params, extra.signal)
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('Invalid MCP result')
    return result
  })
}
await server.connect(new StdioServerTransport())
