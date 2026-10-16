import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { fromJSONSchema } from 'zod'
import { decode, enabledStudioTools, runtimePreferencesSchema } from '@dovo/protocol'
import { studioToolDefinitions } from './tool-definitions.js'

/** External-agent stdio transport. HTTP is only the existing authenticated runtime API. */
export async function startStudioMcp() {
  const address = process.env.DOVO_RUNTIME_URL
  const token = process.env.DOVO_DEVICE_TOKEN
  if (!address || !token)
    throw new Error('Set DOVO_RUNTIME_URL and DOVO_DEVICE_TOKEN for Studio Tools')
  const origin = new URL(address)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw new Error('DOVO_RUNTIME_URL must be an HTTP(S) runtime origin')
  async function post(path: string, input: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, origin), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok) throw new Error(`Studio Tools: HTTP ${response.status}`)
    return response.json()
  }
  async function definitions() {
    const preferences = decode(
      runtimePreferencesSchema,
      await post('/api/runtime/preferences/read', {}),
    )
    const enabled = enabledStudioTools(preferences)
    const hostname = origin.hostname
    if (hostname !== 'localhost' && hostname !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/.test(hostname))
      enabled.ui = false
    return studioToolDefinitions(enabled)
  }
  const server = new Server(
    { name: 'dovo-studio-tools', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await definitions() }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
    try {
      const definition = (await definitions()).find((tool) => tool.name === params.name)
      if (!definition)
        throw new Error('Studio Tools part is disabled or unavailable on this connection')
      const parsed = fromJSONSchema(definition.inputSchema).parse(params.arguments ?? {})
      // The generated root schema is always an object; runtime schemas validate the command again.
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Studio Tools arguments')
      const part =
        params.name === 'studio_discover' ? 'discover' : params.name.slice('studio_'.length)
      const result = await post('/api/studio/tools', {
        taskId: 'studio-integration',
        part,
        command: part === 'discover' ? parsed : 'command' in parsed ? parsed.command : undefined,
      })
      if (
        result &&
        typeof result === 'object' &&
        'image' in result &&
        typeof result.image === 'string'
      ) {
        const { image, ...details } = result
        return {
          content: [
            { type: 'text', text: JSON.stringify(details) },
            { type: 'image', mimeType: 'image/png', data: image },
          ],
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              error instanceof Error && error.name === 'ZodError'
                ? 'Invalid Studio Tools arguments'
                : error instanceof Error
                  ? error.message
                  : 'Studio Tools failed',
          },
        ],
      }
    }
  })
  await server.connect(new StdioServerTransport())
}
