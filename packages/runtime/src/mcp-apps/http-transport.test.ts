import { createServer } from 'node:http'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { expect, it, vi } from 'vite-plus/test'
import * as transport from './http-transport'
const { mcpHttpOptions } = transport
// The base has no per-call binding. Exercise its transport directly for the regression proof.
const mcpHttpCall =
  transport.mcpHttpCall ?? (<T>(_signal: AbortSignal, operation: () => Promise<T>) => operation())

it('closes a cancelled tool response body and keeps the shared client usable', async () => {
  let closed = false
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const http = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString())
    if (input.id === undefined) {
      response.writeHead(202).end()
      return
    }
    if (input.method === 'tools/call' && input.params.name === 'stall') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(': waiting\n\n')
      response.on('close', () => {
        closed = true
      })
      started()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
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
            : { content: [{ type: 'text', text: 'Still connected' }] },
      }),
    )
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const client = new Client({ name: 'cancellation-test', version: '1' })
  client.onerror = () => {}
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}`),
        mcpHttpOptions({}),
      ),
    )
    const controller = new AbortController()
    const call = mcpHttpCall(controller.signal, () =>
      client.callTool({ name: 'stall' }, undefined, { signal: controller.signal }),
    )
    const rejected = call.then(
      () => false,
      () => true,
    )
    await ready
    controller.abort()
    expect(await rejected).toBe(true)
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1500 })
    expect(await client.callTool({ name: 'healthy' })).toMatchObject({
      content: [{ text: 'Still connected' }],
    })
  } finally {
    await client.close()
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
})

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
