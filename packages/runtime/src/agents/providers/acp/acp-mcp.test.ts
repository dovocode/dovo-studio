import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { MCP_PROTOCOL_VERSION, type McpOperationContext } from '@agentclientprotocol/sdk/unstable'
import { acpMcpHttp } from './acp-mcp.js'
const close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of close.splice(0)) await cleanup()
})
function context(signal = new AbortController().signal) {
  return {
    serverId: 'server',
    requestId: 'request',
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: { text: 'hello' },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
    protocolVersion: MCP_PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: undefined,
    envelopeMeta: undefined,
    signal,
    notify: vi.fn<McpOperationContext['notify']>(async () => {}),
  } satisfies McpOperationContext
}
async function endpoint(handler: RequestListener) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  close.push(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test listener')
  return `http://127.0.0.1:${address.port}/mcp`
}
it.each(['json', 'sse'] as const)(
  'forwards one native MCP operation over %s with credentials and notifications',
  async (encoding) => {
    const calls: unknown[] = []
    const url = await endpoint(async (request, response) => {
      expect(request.headers.authorization).toBe('Bearer fixture-secret')
      expect(request.headers['mcp-protocol-version']).toBe(MCP_PROTOCOL_VERSION)
      const buffers: Buffer[] = []
      for await (const chunk of request) buffers.push(chunk)
      const input = JSON.parse(Buffer.concat(buffers).toString())
      calls.push(input)
      const result = {
        jsonrpc: '2.0',
        id: input.id,
        result: { content: [{ type: 'text', text: 'hello' }] },
      }
      response.writeHead(200, {
        'Content-Type': encoding === 'sse' ? 'text/event-stream' : 'application/json',
      })
      response.end(
        encoding === 'sse'
          ? `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\nevent: message\ndata: ${JSON.stringify(result)}\n\n`
          : JSON.stringify(result),
      )
    })
    const operation = context()
    expect(await acpMcpHttp(url, { Authorization: 'Bearer fixture-secret' }, operation)).toEqual({
      result: { content: [{ type: 'text', text: 'hello' }] },
    })
    expect(calls).toHaveLength(1)
    expect(operation.notify.mock.calls).toEqual(
      encoding === 'sse' ? [['notifications/progress', { progress: 1 }]] : [],
    )
  },
)
it('does not follow redirects or retry a tool request', async () => {
  let calls = 0
  const url = await endpoint((_request, response) => {
    calls++
    response.writeHead(307, { Location: '/another' }).end()
  })
  await expect(acpMcpHttp(url, {}, context())).rejects.toThrow('fetch failed')
  expect(calls).toBe(1)
})
it('handles concurrent fragmented large SSE responses independently', async () => {
  const payload = 'é'.repeat(512 * 1024)
  const url = await endpoint(async (request, response) => {
    const buffers: Buffer[] = []
    for await (const chunk of request) buffers.push(chunk)
    const input = JSON.parse(Buffer.concat(buffers).toString())
    const bytes = Buffer.from(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { text: payload } })}\n\n`,
    )
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let offset = 0; offset < bytes.length; offset += 8191)
      response.write(bytes.subarray(offset, offset + 8191))
    response.end()
  })
  const calls = Array.from({ length: 3 }, (_, index) => ({ ...context(), requestId: `r${index}` }))
  const results = await Promise.all(calls.map((call) => acpMcpHttp(url, {}, call)))
  expect(results).toEqual(calls.map(() => ({ result: { text: payload } })))
})
it('cancels an outstanding HTTP tool when its ACP caller disconnects', async () => {
  let resolveReceived!: () => void
  const received = new Promise<void>((resolve) => {
    resolveReceived = resolve
  })
  const url = await endpoint(() => {
    resolveReceived()
  })
  const controller = new AbortController()
  const call = acpMcpHttp(url, {}, context(controller.signal))
  await Promise.all([
    expect(call).rejects.toThrow('Stopped'),
    received.then(() => controller.abort(new Error('Stopped'))),
  ])
})

it('tests native MCP servers through discovery and paginated tools without a legacy handshake', async () => {
  const { testMcpServer } = await import('../../configuration/resources.js')
  const methods: string[] = []
  const url = await endpoint(async (request, response) => {
    const buffers: Buffer[] = []
    for await (const chunk of request) buffers.push(chunk)
    const input = JSON.parse(Buffer.concat(buffers).toString())
    methods.push(input.method)
    const result =
      input.method === 'server/discover'
        ? {
            supportedVersions: [MCP_PROTOCOL_VERSION],
            capabilities: { tools: {} },
            _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Native MCP', version: '1' } },
          }
        : input.params?.cursor
          ? { tools: [{ name: 'second' }] }
          : { tools: [{ name: 'first' }], nextCursor: 'next' }
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
  })
  expect(
    await testMcpServer({
      name: 'native',
      enabled: true,
      transport: 'http',
      url,
      acpTransport: true,
    }),
  ).toEqual({ server: 'Native MCP', tools: ['first', 'second'] })
  expect(methods).toEqual(['server/discover', 'tools/list', 'tools/list'])
})
