import { McpApps, MCP_SESSION_IDLE_MS } from './bridge'
import { HttpError } from '../errors'
import { runtimeIntegration } from '../testing/integration'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  codexMcpServers,
  claudeMcpServers,
  acpMcpServers,
} from '../agents/configuration/mcp-settings'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  McpError,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  CallToolRequestSchema,
  CallToolResultSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import {
  decode,
  mcpServerSchema,
  recentTools,
  mcpAppReferences,
  runtimeRequest,
  runtimeRequestTimeout,
  mcpAppRpcResponseSchema,
} from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(
  resourceCsp = true,
  failureStatus?: number,
  toolDelay = 0,
  discovery?: 'tools-only' | 'full',
  appToolName = 'refresh',
) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'test-owner-token-with-at-least-32-characters',
  })
  cleanups.push(() => runtime.close())
  const parameters: unknown[] = []
  let calls = 0,
    resources = 0
  const upstream = new Server(
    { name: 'apps-fixture', version: '1' },
    {
      capabilities: {
        tools: {},
        ...(discovery === 'tools-only' ? {} : { resources: {} }),
        ...(discovery === 'full' ? { prompts: {} } : {}),
      },
    },
  )
  const discoveryRequests: Array<{ method: string; cursor?: string }> = []
  if (discovery === 'full') {
    const page = (method: string, cursor?: string) => {
      discoveryRequests.push({ method, cursor })
      if (cursor === 'error')
        throw new McpError(ErrorCode.InternalError, 'Upstream catalog unavailable', {
          retryable: false,
        })
      if (cursor === 'missing')
        throw new McpError(ErrorCode.MethodNotFound, 'Advertised discovery method failed')
      return { nextCursor: cursor ? undefined : 'next' }
    }
    upstream.setRequestHandler(ListResourcesRequestSchema, async ({ params }) => ({
      ...page('resources/list', params?.cursor),
      resources: [{ uri: `fixture://${params?.cursor ?? 'first'}`, name: 'Resource' }],
    }))
    upstream.setRequestHandler(ListResourceTemplatesRequestSchema, async ({ params }) => ({
      ...page('resources/templates/list', params?.cursor),
      resourceTemplates: [
        { uriTemplate: `fixture://${params?.cursor ?? 'first'}/{id}`, name: 'Template' },
      ],
    }))
    upstream.setRequestHandler(ListPromptsRequestSchema, async ({ params }) => ({
      ...page('prompts/list', params?.cursor),
      prompts: [{ name: params?.cursor ?? 'first' }],
    }))
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'chart',
        inputSchema: { type: 'object' },
        _meta: { ui: { resourceUri: 'ui://chart' } },
      },
      {
        name: appToolName,
        inputSchema: { type: 'object' },
        _meta: { ui: { visibility: ['app'] } },
      },
      { name: 'legacy', inputSchema: { type: 'object' } },
    ],
  }))
  upstream.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'refresh' && toolDelay)
      await new Promise((resolve) => setTimeout(resolve, toolDelay))
    calls++
    parameters.push(request.params)
    return request.params.name === 'legacy'
      ? {
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'ui://legacy',
                mimeType: 'text/html',
                text: '<button>Legacy</button>',
              },
            },
          ],
        }
      : { content: [{ type: 'text', text: 'Chart ready' }], structuredContent: { count: calls } }
  })
  if (discovery !== 'tools-only')
    upstream.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
      resources++
      return {
        contents: [
          {
            uri: params.uri,
            mimeType: 'text/html;profile=mcp-app',
            text: '<h1>Chart</h1>',
            _meta: resourceCsp
              ? { ui: { csp: { resourceDomains: ['https://example.com'] } } }
              : undefined,
          },
        ],
      }
    })
  await upstream.connect(transport)
  const requestMethods: Array<string | undefined> = []
  const http = createServer((request, response) => {
    requestMethods.push(request.method)
    if (failureStatus) {
      request.resume()
      response.writeHead(failureStatus).end('Server request failed; configuration 404')
      return
    }
    void transport.handleRequest(request, response)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    await upstream.close()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No upstream port')
  const server = decode(mcpServerSchema, {
    name: 'fixture',
    transport: 'http',
    enabled: true,
    url: `http://127.0.0.1:${address.port}`,
  })
  f.workspace.agents[0].resources = { mcpServers: [server], skills: [], hooks: [] }
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'App task',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Chart',
  })
  const proxy = runtime.services.mcpApps.proxies(task.id, [server], f.directory, 'ask', {
    port: runtime.port,
    host: '127.0.0.1',
  })[0]
  return {
    runtime,
    task,
    f,
    server,
    proxy,
    token: proxy.envValues?.DOVO_MCP_BRIDGE_TOKEN ?? '',
    calls: () => calls,
    parameters,
    requestMethods,
    discoveryRequests,
    resources: () => resources,
    notify: () => upstream.sendToolListChanged(),
  }
}
it('closes MCP sessions and revokes proxy scopes when a thread is auto-settled', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/list', {})
  const close = vi.spyOn(Client.prototype, 'close')
  s.runtime.services.store.updateTask(s.task.id, (task) => ({
    ...task,
    archived: true,
    autoSettled: true,
  }))
  await bridge.reconcile()
  expect(close).toHaveBeenCalledOnce()
  await expect(bridge.proxy(s.token, 'tools/list', {})).rejects.toThrow(
    'Invalid MCP bridge credential',
  )
  expect(bridge['resolved'].size).toBe(0)
  expect(bridge['sessions'].size).toBe(0)
})
it('captures MCP Apps and legacy resources once without putting HTML in sync', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  const listed = await bridge.proxy(s.token, 'tools/list', {})
  expect(listed).toMatchObject({
    tools: [
      { name: 'chart' },
      { name: 'legacy' },
      { name: 'dovo_app_list_tools' },
      { name: 'dovo_app_call_tool' },
    ],
  })
  await expect(bridge.proxy(s.token, 'tools/call', { name: 'refresh' })).rejects.toThrow(
    'not available',
  )
  await bridge.proxy(s.token, 'tools/call', { name: 'chart', arguments: { city: 'Amsterdam' } })
  const result = await bridge.proxy(s.token, 'tools/call', { name: 'legacy' })
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  const events = s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events
  const refs = recentTools(events).flatMap((event) => mcpAppReferences(event.payload))
  expect(refs).toHaveLength(2)
  expect(JSON.stringify(events)).not.toContain('<h1>')
  expect(refs.map((ref) => bridge.read(s.task.id, ref.id).format).sort()).toEqual([
    'apps',
    'legacy',
  ])
  expect(s.calls()).toBe(2)
  expect(s.resources()).toBe(1)
  expect(bridge.read(s.task.id, refs[0].id).connected).toBe(true)
  expect(() => bridge.read('another-thread', refs[0].id)).toThrow('Task')
  await expect(bridge.proxy('wrong-token', 'tools/list', {})).rejects.toThrow('credential')
})
it('requires UI approval and deduplicates calls, including persisted completed actions', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  const approve = vi.spyOn(s.runtime.services.approvals, 'request').mockResolvedValue('approve')
  const [a, b] = await Promise.all([
    bridge.action(s.task.id, ref.id, 'same', 'tools/call', { name: 'refresh' }),
    bridge.action(s.task.id, ref.id, 'same', 'tools/call', { name: 'refresh' }),
  ])
  expect(a).toEqual(b)
  expect(s.calls()).toBe(2)
  expect(approve).toHaveBeenCalledTimes(1)
  await expect(
    bridge.action(s.task.id, ref.id, 'same', 'tools/call', { name: 'chart' }),
  ).rejects.toThrow('reused')
  approve.mockResolvedValue('deny' as const)
  await expect(
    bridge.action(s.task.id, ref.id, 'declined', 'tools/call', { name: 'refresh' }),
  ).rejects.toThrow('declined')
  expect(s.calls()).toBe(2)
})
it('keeps the UI request alive through approval and a slow upstream tool without duplicate execution', async () => {
  const s = await setup(true, undefined, 450),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  const approve = vi.spyOn(s.runtime.services.approvals, 'request').mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return 'approve' as const
  })
  const input = {
    taskId: s.task.id,
    id: ref.id,
    requestId: 'slow',
    method: 'tools/call',
    params: { name: 'refresh' },
  }
  const connection = {
    address: `http://127.0.0.1:${s.runtime.port}`,
    token: 'test-owner-token-with-at-least-32-characters',
  }
  // Scale the client budget; 50 seconds of approval followed by a 45-second tool is valid.
  const result = await runtimeRequest(
    connection,
    connection.address,
    '/api/mcp-apps/rpc',
    input,
    mcpAppRpcResponseSchema,
    'POST',
    runtimeRequestTimeout('/api/mcp-apps/rpc', input) / 100,
  )
  expect(result.result).toMatchObject({ content: [{ type: 'text', text: 'Chart ready' }] })
  expect(approve).toHaveBeenCalledOnce()
  expect(s.calls()).toBe(2)
})
it('invalidates old capabilities and saved app actions when server configuration changes', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      resources: { ...agent.resources!, mcpServers: [{ ...s.server, enabled: false }] },
    })),
  }))
  expect(bridge.read(s.task.id, ref.id).connected).toBe(false)
  await expect(bridge.proxy(s.token, 'tools/list', {})).rejects.toThrow('no longer enabled')
  await expect(
    bridge.action(s.task.id, ref.id, 'new', 'tools/call', { name: 'refresh' }),
  ).rejects.toThrow('no longer enabled')
})

async function proxyClient(s: Awaited<ReturnType<typeof setup>>) {
  const transport = new StdioClientTransport({
    command: s.proxy.command,
    args: s.proxy.args,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      ...s.proxy.envValues,
    },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'harness-fixture', version: '1' })
  cleanups.push(() => client.close())
  await client.connect(transport)
  return client
}
it('runs the provider stdio proxy without exposing upstream credentials', async () => {
  const s = await setup()
  const client = await proxyClient(s)
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    'chart',
    'legacy',
    'dovo_app_list_tools',
    'dovo_app_call_tool',
  ])
  await client.callTool({ name: 'chart', arguments: {} })
  expect(s.calls()).toBe(1)
  expect(codexMcpServers([s.proxy]).fixture).toMatchObject({ command: process.execPath })
  expect(claudeMcpServers([s.proxy]).fixture).toMatchObject({
    type: 'stdio',
    command: process.execPath,
  })
  expect(acpMcpServers([s.proxy])[0]).toMatchObject({ command: process.execPath })
  expect(JSON.stringify(s.proxy)).not.toContain(s.server.url)
})

it('discovers all advertised capabilities through stdio for a tools-only upstream', async () => {
  const s = await setup(true, undefined, 0, 'tools-only')
  const client = await proxyClient(s)
  expect(client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} })
  expect((await client.listTools()).tools[0]?.name).toBe('chart')
  expect(await client.listResources()).toEqual({ resources: [] })
  expect(await client.listResourceTemplates()).toEqual({ resourceTemplates: [] })
  expect(await client.listPrompts()).toEqual({ prompts: [] })
})

it('preserves supported discovery pages and cursors through the stdio proxy', async () => {
  const s = await setup(true, undefined, 0, 'full')
  const client = await proxyClient(s)
  const resources = await client.listResources()
  expect(resources).toEqual({
    resources: [{ uri: 'fixture://first', name: 'Resource' }],
    nextCursor: 'next',
  })
  expect(await client.listResources({ cursor: resources.nextCursor })).toEqual({
    resources: [{ uri: 'fixture://next', name: 'Resource' }],
  })
  const templates = await client.listResourceTemplates()
  expect(templates).toEqual({
    resourceTemplates: [{ uriTemplate: 'fixture://first/{id}', name: 'Template' }],
    nextCursor: 'next',
  })
  expect(await client.listResourceTemplates({ cursor: templates.nextCursor })).toEqual({
    resourceTemplates: [{ uriTemplate: 'fixture://next/{id}', name: 'Template' }],
  })
  const prompts = await client.listPrompts()
  expect(prompts).toEqual({ prompts: [{ name: 'first' }], nextCursor: 'next' })
  expect(await client.listPrompts({ cursor: prompts.nextCursor })).toEqual({
    prompts: [{ name: 'next' }],
  })
  expect(s.discoveryRequests).toEqual([
    { method: 'resources/list', cursor: undefined },
    { method: 'resources/list', cursor: 'next' },
    { method: 'resources/templates/list', cursor: undefined },
    { method: 'resources/templates/list', cursor: 'next' },
    { method: 'prompts/list', cursor: undefined },
    { method: 'prompts/list', cursor: 'next' },
  ])
})

it.each(['resources', 'templates', 'prompts'] as const)(
  'preserves upstream %s discovery errors through stdio instead of returning an empty list',
  async (capability) => {
    const s = await setup(true, undefined, 0, 'full')
    const client = await proxyClient(s)
    const request = (cursor: string) => {
      if (capability === 'resources') return client.listResources({ cursor })
      if (capability === 'templates') return client.listResourceTemplates({ cursor })
      return client.listPrompts({ cursor })
    }
    await expect(request('error')).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Upstream catalog unavailable'),
      data: { retryable: false },
    })
    await expect(request('missing')).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
      message: expect.stringContaining('Advertised discovery method failed'),
    })
  },
)
it('cancels pending UI approvals without executing their tools', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  const action = bridge.action(s.task.id, ref.id, 'waiting', 'tools/call', { name: 'refresh' })
  const outcome = action.then(
    () => '',
    (error: unknown) => String(error),
  )
  await vi.waitFor(() => expect(s.runtime.services.approvals.list()).toHaveLength(1))
  await bridge.action(s.task.id, ref.id, 'cancel', 'ui/cancel', { requestId: 'waiting' })
  expect(await outcome).toContain('declined')
  expect(s.calls()).toBe(1)
  expect(s.runtime.services.approvals.list()).toHaveLength(0)
})
it('forwards server list changes through the existing activity sync', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const before = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  )
  // A real server notification is exercised below through the fixture's MCP connection.
  await s.notify()
  await vi.waitFor(() => {
    const after = recentTools(
      s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
    )
    expect(after).toHaveLength(before.length)
    expect(mcpAppReferences(after[0].payload)[0].revision).toBe(1)
  })
})

it('recovers saved apps and completed actions, and never replays interrupted calls', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  vi.spyOn(s.runtime.services.approvals, 'request').mockResolvedValue('approve')
  const result = await bridge.action(s.task.id, ref.id, 'durable', 'tools/call', {
    name: 'refresh',
  })
  await bridge.dispose()
  const restored = new McpApps(
    s.runtime.services.db,
    s.runtime.services.store,
    s.runtime.services.activity,
    s.runtime.services.approvals,
  )
  cleanups.push(() => restored.dispose())
  expect(restored.read(s.task.id, ref.id).connected).toBe(true)
  expect(
    await restored.action(s.task.id, ref.id, 'durable', 'tools/call', { name: 'refresh' }),
  ).toEqual(result)
  s.runtime.services.db
    .prepare('INSERT INTO mcp_app_actions VALUES (?,?,?,NULL)')
    .run(
      `${s.task.id}:${ref.id}:interrupted`,
      JSON.stringify({ method: 'tools/call', params: { name: 'refresh' } }),
      'pending',
    )
  await expect(
    restored.action(s.task.id, ref.id, 'interrupted', 'tools/call', { name: 'refresh' }),
  ).rejects.toThrow('interrupted')
  expect(s.calls()).toBe(2)
})
it.each(['permission', 'sandboxMode'] as const)(
  'rechecks device authorization after an approval and rejects %s read-only app mutations',
  async (dimension) => {
    const s = await setup(),
      bridge = s.runtime.services.mcpApps
    await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
    const ref = recentTools(
      s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
    ).flatMap((event) => mcpAppReferences(event.payload))[0]
    let revoked = false
    vi.spyOn(s.runtime.services.approvals, 'request').mockImplementation(async () => {
      revoked = true
      return 'approve' as const
    })
    await expect(
      bridge.action(s.task.id, ref.id, 'revoked', 'tools/call', { name: 'refresh' }, () => {
        if (revoked) throw new HttpError(401, 'Device revoked')
      }),
    ).rejects.toThrow('Device revoked')
    expect(s.calls()).toBe(1)
    s.runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({
        ...agent,
        ...(dimension === 'permission'
          ? { permission: 'read-only' as const }
          : { sandboxMode: 'read-only' as const }),
      })),
    }))
    await expect(
      bridge.action(s.task.id, ref.id, 'readonly', 'tools/call', { name: 'refresh' }),
    ).rejects.toThrow('read-only')
  },
)
it('stores bounded model context and delivers app messages through the normal queue', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  await bridge.action(s.task.id, ref.id, 'context', 'ui/update-model-context', {
    structuredContent: { city: 'Amsterdam' },
  })
  expect(bridge.context(s.task.id)).toContain('Amsterdam')
  const send = vi.spyOn(s.runtime.services.tasks, 'send').mockResolvedValue({ ok: true })
  await bridge.action(s.task.id, ref.id, 'message', 'ui/message', {
    role: 'user',
    content: [{ type: 'text', text: 'Use this chart' }],
  })
  expect(send).toHaveBeenCalledWith(
    s.task.id,
    expect.any(String),
    '[MCP App: chart]\nUse this chart',
    [],
    { kind: 'system', label: 'MCP app' },
  )
})

it('hosts read-only UI resources when the server has no resources/list method', async () => {
  const s = await setup(false)
  await s.runtime.services.mcpApps.proxy(s.token, 'tools/call', { name: 'chart' })
  const events = s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events
  const refs = recentTools(events).flatMap((event) => mcpAppReferences(event.payload))
  expect(refs).toHaveLength(1)
  expect(s.runtime.services.mcpApps.read(s.task.id, refs[0].id).format).toBe('apps')
})

it('validates MCP request boundaries, accepts omitted arguments and preserves tool metadata', async () => {
  const s = await setup()
  const bridge = s.runtime.services.mcpApps
  await expect(
    bridge.proxy(s.token, 'tools/call', { name: 'chart', arguments: [] }),
  ).rejects.toThrow('Invalid MCP tools/call parameters')
  await expect(
    bridge.proxy(s.token, 'tools/call', { name: 'chart', arguments: null }),
  ).rejects.toThrow('Invalid MCP tools/call parameters')
  await expect(bridge.proxy(s.token, 'tools/call', { name: 'chart', task: {} })).rejects.toThrow(
    'Task-augmented MCP calls',
  )
  await expect(
    bridge.proxy(s.token, 'prompts/get', { name: 'prompt', arguments: { value: 1 } }),
  ).rejects.toThrow('Invalid MCP prompts/get parameters')
  expect(s.calls()).toBe(0)
  await bridge.proxy(s.token, 'tools/call', {
    name: 'chart',
    _meta: { 'test/context': 'retained' },
  })
  expect(s.parameters).toEqual([
    expect.objectContaining({
      name: 'chart',
      arguments: {},
      _meta: { 'test/context': 'retained' },
    }),
  ])
})

it.each([401, 403, 405])(
  'uses the HTTP status, not error text, to decide SSE fallback for %s',
  async (status) => {
    const s = await setup(true, status)
    await expect(s.runtime.services.mcpApps.proxy(s.token, 'tools/list', {})).rejects.toThrow(
      /configuration 404|status code/i,
    )
    expect(s.requestMethods).toEqual(status === 405 ? ['POST', 'GET'] : ['POST'])
  },
)

it('routes agent calls to ticket-authenticated live app tools and removes them when the view closes', async () => {
  const { WebSocket } = await import('ws')
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]!
  const endpoint = `http://127.0.0.1:${s.runtime.port}/api/mcp-apps/ticket`
  const issue = (credential: string) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: s.task.id, id: ref.id }),
    })
  expect((await issue('invalid')).status).toBe(401)
  const response = await issue('test-owner-token-with-at-least-32-characters')
  expect(response.ok).toBe(true)
  const payload: unknown = await response.json()
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('ticket' in payload) ||
    typeof payload.ticket !== 'string'
  )
    throw new Error('No ticket')
  const socket = new WebSocket(
    `ws://127.0.0.1:${s.runtime.port}/ws/mcp-app?ticket=${encodeURIComponent(payload.ticket)}`,
  )
  cleanups.push(async () => socket.close())
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(
    JSON.stringify({
      type: 'tools',
      tools: [
        {
          name: 'selected_rows',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true },
        },
      ],
    }),
  )
  let name = ''
  await vi.waitFor(async () => {
    const list = CallToolResultSchema.parse(
      await bridge.proxy(s.token, 'tools/call', { name: 'dovo_app_list_tools' }),
    )
    const content = list.content[0]
    if (content?.type !== 'text') throw new Error('Missing tool list')
    name = ListToolsResultSchema.parse({ tools: JSON.parse(content.text) }).tools[0]?.name ?? ''
    expect(name).not.toBe('')
  })
  socket.on('message', (data) => {
    const bytes = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data)
    const request: unknown = JSON.parse(bytes.toString('utf8'))
    if (request && typeof request === 'object' && 'requestId' in request)
      socket.send(
        JSON.stringify({
          type: 'result',
          requestId: request.requestId,
          result: { content: [{ type: 'text', text: 'rows 1 and 2' }] },
        }),
      )
  })
  expect(
    await bridge.proxy(s.token, 'tools/call', { name: 'dovo_app_call_tool', arguments: { name } }),
  ).toEqual({
    content: [{ type: 'text', text: 'rows 1 and 2' }],
  })
  expect(s.calls()).toBe(1)
  socket.close()
  await vi.waitFor(async () => {
    await expect(
      bridge.proxy(s.token, 'tools/call', { name: 'dovo_app_call_tool', arguments: { name } }),
    ).rejects.toThrow('no longer available')
  })
})

it.each(['approvalPolicy', 'sandboxMode'] as const)(
  'revokes an old MCP proxy when advanced %s changes without changing the legacy mode',
  async (dimension) => {
    const s = await setup()
    await s.runtime.services.mcpApps.proxy(s.token, 'tools/list', {})
    s.runtime.services.store.updateTask(s.task.id, (task) => ({
      ...task,
      agentOverrides: {
        ...task.agentOverrides,
        ...(dimension === 'approvalPolicy'
          ? { approvalPolicy: 'never' as const }
          : { sandboxMode: 'workspace-write' as const }),
      },
    }))
    expect(() => s.runtime.services.mcpApps.authenticateProxy(s.token)).toThrow(
      'configuration changed',
    )
  },
)

it('keeps shell-named MCP App calls interactive even when a matching project command is saved', async () => {
  const s = await setup(true, undefined, 0, undefined, 'shell')
  const bridge = s.runtime.services.mcpApps
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((project) => ({
      ...project,
      approvedCommands: ['pnpm test'],
    })),
  }))
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  for (const allow of [false, true]) {
    const before = s.calls()
    const action = bridge.action(s.task.id, ref.id, 'shell-' + allow, 'tools/call', {
      name: 'shell',
      arguments: { command: 'pnpm test', deleteAll: true },
    })
    const result = action.then(
      () => 'executed',
      (error) => (error instanceof Error ? error.message : String(error)),
    )
    await vi.waitFor(() => expect(s.runtime.services.approvals.list()).toHaveLength(1))
    expect(s.calls()).toBe(before)
    const pending = s.runtime.services.approvals.list()[0]
    expect(pending.rememberRule).toBeNull()
    s.runtime.services.approvals.respond(pending.id, allow)
    await expect(result).resolves.toMatch(allow ? /^executed$/ : /declined/)
    expect(s.calls()).toBe(before + Number(allow))
  }
})

it('filters ambient runtime authority and Git routing from configured stdio servers', async () => {
  const s = await setup()
  const keys = [
    'DOVO_OWNER_TOKEN',
    'META_API_KEY',
    'meta_api_key',
    'ELECTRON_RUN_AS_NODE',
    'GH_REPO',
    'GH_HOST',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
  ]
  try {
    for (const key of keys) vi.stubEnv(key, 'ambient-secret')
    vi.stubEnv('DOVO_MCP_TEST_TOKEN', 'mapped-value')
    const script = `
      import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
      import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
      import { ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
      const server = new Server({name:'environment-fixture',version:'1'}, {capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[{name:'inspect',inputSchema:{type:'object'},description:JSON.stringify(Object.fromEntries(${JSON.stringify([...keys, 'MAPPED', 'LITERAL'])}.map(key => [key,process.env[key] ?? null])))}]}));
      await server.connect(new StdioServerTransport());
    `
    const server = decode(mcpServerSchema, {
      name: 'isolated',
      transport: 'stdio',
      enabled: true,
      command: process.execPath,
      args: ['--input-type=module', '-e', script],
      env: { MAPPED: 'DOVO_MCP_TEST_TOKEN' },
      envValues: { LITERAL: 'explicit-value' },
    })
    s.runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({
        ...agent,
        resources: { ...agent.resources!, mcpServers: [server] },
      })),
    }))
    const proxy = s.runtime.services.mcpApps.proxies(s.task.id, [server], s.f.directory, 'ask', {
      port: s.runtime.port,
      host: '127.0.0.1',
    })[0]
    const result = ListToolsResultSchema.parse(
      await s.runtime.services.mcpApps.proxy(
        proxy.envValues?.DOVO_MCP_BRIDGE_TOKEN ?? '',
        'tools/list',
        {},
      ),
    )
    const environment: unknown = JSON.parse(result.tools[0].description ?? '{}')
    expect(environment).toEqual({
      ...Object.fromEntries(keys.map((key) => [key, null])),
      MAPPED: 'mapped-value',
      LITERAL: 'explicit-value',
    })
  } finally {
    vi.unstubAllEnvs()
  }
})

const upstreamSessions = (bridge: McpApps) => [...bridge['resolved'].values()]
/** Stdio upstreams start a fresh server per connection, so retired sessions can reconnect. */
async function stdioSetup() {
  const s = await setup()
  const script = `
    import { Server } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
    import { ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/types.js'))};
    const server = new Server({name:'reconnect-fixture',version:'1'}, {capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[
      {name:'rows',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},
      {name:'refresh',inputSchema:{type:'object'},_meta:{ui:{visibility:['app']}}},
    ]}));
    await server.connect(new StdioServerTransport());
  `
  const server = decode(mcpServerSchema, {
    name: 'reconnect',
    transport: 'stdio',
    enabled: true,
    command: process.execPath,
    args: ['--input-type=module', '-e', script],
  })
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      resources: { ...agent.resources!, mcpServers: [server] },
    })),
  }))
  const token = (taskId: string) =>
    s.runtime.services.mcpApps.proxies(taskId, [server], s.f.directory, 'ask', {
      port: s.runtime.port,
      host: '127.0.0.1',
    })[0].envValues?.DOVO_MCP_BRIDGE_TOKEN ?? ''
  const thread = () => {
    const task = s.runtime.services.tasks.create({
      title: 'Another app task',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Chart',
    })
    return { task, token: token(task.id) }
  }
  return { ...s, token: token(s.task.id), thread }
}
const ageSessions = (bridge: McpApps, idle = MCP_SESSION_IDLE_MS) => {
  for (const session of upstreamSessions(bridge)) session.lastUsed = Date.now() - idle
}
it.each(['review', 'failed', 'cancelled'] as const)(
  'retires idle upstream sessions for %s threads after the threshold and reconnects with the same tools',
  async (status) => {
    const s = await stdioSetup(),
      bridge = s.runtime.services.mcpApps
    const tools = await bridge.proxy(s.token, 'tools/list', {})
    s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, status }))
    const [first] = upstreamSessions(bridge)
    ageSessions(bridge, MCP_SESSION_IDLE_MS - 5_000)
    await bridge.reconcile()
    expect(upstreamSessions(bridge)).toHaveLength(1)
    expect(first?.closed).toBe(false)
    ageSessions(bridge)
    const close = vi.spyOn(Client.prototype, 'close')
    await bridge.reconcile()
    expect(close).toHaveBeenCalledOnce()
    expect(first?.closed).toBe(true)
    expect(bridge['sessions'].size).toBe(0)
    expect(bridge['resolved'].size).toBe(0)
    expect(await bridge.proxy(s.token, 'tools/list', {})).toEqual(tools)
    const [replacement] = upstreamSessions(bridge)
    expect(replacement).toBeDefined()
    expect(replacement).not.toBe(first)
    expect(replacement?.busy).toBe(0)
  },
)
it('keeps idle-aged sessions for running threads, busy calls and attached views', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]!
  const [session] = upstreamSessions(bridge)
  if (!session) throw new Error('Missing upstream session')
  const setStatus = (status: 'running' | 'review') =>
    s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, status }))

  setStatus('running')
  ageSessions(bridge)
  await bridge.reconcile()
  expect(session.closed).toBe(false)
  expect(Date.now() - session.lastUsed).toBeLessThan(MCP_SESSION_IDLE_MS)
  setStatus('review')

  let decide: (decision: 'approve') => void = () => {}
  vi.spyOn(s.runtime.services.approvals, 'request').mockImplementation(
    () => new Promise((resolve) => (decide = resolve)),
  )
  const action = bridge.action(s.task.id, ref.id, 'busy', 'tools/call', { name: 'refresh' })
  await vi.waitFor(() => expect(session.busy).toBe(1))
  ageSessions(bridge)
  await bridge.reconcile()
  expect(session.closed).toBe(false)
  decide('approve')
  await action
  expect(session.busy).toBe(0)

  const view = bridge.attachView(
    s.task.id,
    ref.id,
    () => {},
    () => {},
    () => {},
  )
  ageSessions(bridge)
  await bridge.reconcile()
  expect(session.closed).toBe(false)
  view.close()
  // Idle time restarts when the view closes, not at the last call before it opened.
  await bridge.reconcile()
  expect(session.closed).toBe(false)
  ageSessions(bridge)
  await bridge.reconcile()
  expect(session.closed).toBe(true)
  expect(upstreamSessions(bridge)).toEqual([])
})
it('releases feed leases after catalog reads and rejected feed tools', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps,
    signal = new AbortController().signal
  expect(await bridge.feedCatalog(s.task.id, signal, () => {})).toEqual({ tools: [] })
  const [session] = upstreamSessions(bridge)
  expect(session?.busy).toBe(0)
  const query = { server: 'fixture', tool: 'chart', arguments: {}, pointer: '', seconds: 60 }
  await expect(bridge.feedRead(s.task.id, query, undefined, signal, () => {})).rejects.toThrow(
    'read-only and non-destructive',
  )
  let calls = 0
  await expect(
    bridge.feedRead(s.task.id, query, undefined, signal, () => {
      if (++calls > 1) throw new HttpError(401, 'revoked')
    }),
  ).rejects.toThrow('revoked')
  expect(upstreamSessions(bridge)).toEqual([session])
  expect(session?.busy).toBe(0)
})
it('keeps a reserved session for a waiting call instead of retiring it before use', async () => {
  const s = await stdioSetup(),
    bridge = s.runtime.services.mcpApps
  const tools = await bridge.proxy(s.token, 'tools/list', {})
  const [first] = upstreamSessions(bridge)
  s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, status: 'review' }))
  ageSessions(bridge)
  // The call holds the cached reservation, but has not resumed to mark the session busy yet.
  const leased = bridge.proxy(s.token, 'tools/list', {})
  await bridge.reconcile()
  expect(first?.closed).toBe(false)
  expect(await leased).toEqual(tools)
  expect(upstreamSessions(bridge)).toEqual([first])
  expect(first?.busy).toBe(0)
})
it('waits for a slow same-key close before reconnecting and never removes the replacement', async () => {
  const s = await stdioSetup(),
    bridge = s.runtime.services.mcpApps
  const tools = await bridge.proxy(s.token, 'tools/list', {})
  const [first] = upstreamSessions(bridge)
  s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, status: 'review' }))
  ageSessions(bridge)
  let finish = () => {}
  vi.spyOn(Client.prototype, 'close').mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  )
  const connect = vi.spyOn(Client.prototype, 'connect')
  const reconciled = bridge.reconcile()
  expect(first?.closed).toBe(true)
  const next = bridge.proxy(s.token, 'tools/list', {})
  expect(bridge['sessions'].size).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(connect).not.toHaveBeenCalled()
  finish()
  expect(await next).toEqual(tools)
  await reconciled
  expect(connect).toHaveBeenCalledOnce()
  const [replacement] = upstreamSessions(bridge)
  expect(replacement).not.toBe(first)
  // A late close callback from the retired client must not evict the replacement.
  first?.client.onclose?.()
  expect(upstreamSessions(bridge)).toEqual([replacement])
  expect(bridge['closing'].size).toBe(0)
})
it('reports failed closes, reconnects afterwards and makes disposal await slow closes', async () => {
  const s = await stdioSetup(),
    bridge = s.runtime.services.mcpApps
  const tools = await bridge.proxy(s.token, 'tools/list', {})
  s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, status: 'review' }))
  ageSessions(bridge)
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const close = vi.spyOn(Client.prototype, 'close')
  close.mockRejectedValueOnce(new Error('close failed'))
  await bridge.reconcile()
  expect(report).toHaveBeenCalledWith('MCP session close failed', 'close failed')
  expect(upstreamSessions(bridge)).toEqual([])
  expect(bridge['closing'].size).toBe(0)
  expect(await bridge.proxy(s.token, 'tools/list', {})).toEqual(tools)
  let finish = () => {}
  close.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
  let disposed = false
  const disposal = bridge.dispose().then(() => (disposed = true))
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(disposed).toBe(false)
  expect(bridge['closing'].size).toBe(1)
  finish()
  await disposal
  expect(bridge['closing'].size).toBe(0)
  expect(upstreamSessions(bridge)).toEqual([])
  await expect(bridge.proxy(s.token, 'tools/list', {})).rejects.toThrow('credential')
})
it('evicts distinct idle sessions for concurrent connects at capacity and protects active ones', async () => {
  const s = await stdioSetup(),
    bridge = s.runtime.services.mcpApps
  bridge['capacity'] = 2
  const second = s.thread()
  await bridge.proxy(s.token, 'tools/list', {})
  await bridge.proxy(second.token, 'tools/list', {})
  const evicted = upstreamSessions(bridge)
  const third = s.thread(),
    fourth = s.thread()
  const calls = [third, fourth].map((entry) => bridge.proxy(entry.token, 'tools/list', {}))
  // Both reservations are registered synchronously, each replacing a different idle session.
  expect(bridge['sessions'].size).toBe(2)
  expect(evicted.every((session) => session.closed)).toBe(true)
  await Promise.all(calls)
  expect(
    upstreamSessions(bridge)
      .map((session) => session.taskId)
      .sort(),
  ).toEqual([third.task.id, fourth.task.id].sort())
  for (const entry of [third, fourth])
    s.runtime.services.store.updateTask(entry.task.id, (task) => ({ ...task, status: 'running' }))
  await expect(bridge.proxy(s.token, 'tools/list', {})).rejects.toThrow('busy')
  expect(upstreamSessions(bridge).every((session) => !session.closed)).toBe(true)
  s.runtime.services.store.updateTask(fourth.task.id, (task) => ({ ...task, status: 'review' }))
  await bridge.proxy(s.token, 'tools/list', {})
  expect(
    upstreamSessions(bridge)
      .map((session) => session.taskId)
      .sort(),
  ).toEqual([s.task.id, third.task.id].sort())
})
