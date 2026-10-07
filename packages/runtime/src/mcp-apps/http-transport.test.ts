import { createServer } from 'node:http'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { expect, it } from 'vite-plus/test'
import { mcpHttpOptions } from './http-transport'

it.each(['streamable', 'sse'] as const)(
  'does not follow same-origin GET redirects over %s, including the SSE notification channel',
  async (kind) => {
    let redirected = false
    let observedGet!: () => void
    const requested = new Promise<void>((resolve) => {
      observedGet = resolve
    })
    const http = createServer(async (request, response) => {
      if (request.url === '/redirected') {
        redirected = true
        response.writeHead(400).end()
        return
      }
      if (request.method === 'GET') {
        response.writeHead(307, { Location: '/redirected' }).end()
        observedGet()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      const input = JSON.parse(Buffer.concat(chunks).toString())
      if (input.id === undefined) return response.writeHead(202).end()
      response.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session' })
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: input.id,
          result:
            input.method === 'initialize'
              ? {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1' },
                }
              : { tools: [] },
        }),
      )
    })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('Missing port')
    const client = new Client({ name: 'boundary-test', version: '1' })
    const options = mcpHttpOptions({ 'X-API-Key': 'fixture-key' })
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`)
    const transport =
      kind === 'streamable'
        ? new StreamableHTTPClientTransport(endpoint, options)
        : new SSEClientTransport(endpoint, options)
    client.onerror = () => {}
    try {
      const error: unknown = await client.connect(transport).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(error === undefined).toBe(kind === 'streamable')
      expect(
        error === undefined || (error instanceof Error && /fetch|redirect/i.test(error.message)),
      ).toBe(true)
      if (kind === 'streamable') await client.listTools()
      await requested
      // Give a follow-up GET time to reach the same server if redirects were followed.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(redirected).toBe(false)
    } finally {
      await client.close()
      await transport.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  },
)
