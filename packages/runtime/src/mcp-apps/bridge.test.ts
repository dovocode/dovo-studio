import { McpApps } from './bridge'
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
import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { decode, mcpServerSchema, recentTools, mcpAppReferences } from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(resourceCsp = true) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'test-owner-token-with-at-least-32-characters',
  })
  cleanups.push(() => runtime.close())
  let calls = 0,
    resources = 0
  const upstream = new Server(
    { name: 'apps-fixture', version: '1' },
    { capabilities: { tools: {}, resources: {} } },
  )
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'chart',
        inputSchema: { type: 'object' },
        _meta: { ui: { resourceUri: 'ui://chart' } },
      },
      { name: 'refresh', inputSchema: { type: 'object' }, _meta: { ui: { visibility: ['app'] } } },
      { name: 'legacy', inputSchema: { type: 'object' } },
    ],
  }))
  upstream.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls++
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
  const http = createServer((request, response) => {
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
    resources: () => resources,
    notify: () => upstream.sendToolListChanged(),
  }
}
it('captures MCP Apps and legacy resources once without putting HTML in sync', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  const listed = await bridge.proxy(s.token, 'tools/list', {})
  expect(listed).toMatchObject({ tools: [{ name: 'chart' }, { name: 'legacy' }] })
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
  const approve = vi.spyOn(s.runtime.services.approvals, 'request').mockResolvedValue(true)
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
  approve.mockResolvedValue(false)
  await expect(
    bridge.action(s.task.id, ref.id, 'declined', 'tools/call', { name: 'refresh' }),
  ).rejects.toThrow('declined')
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

it('runs the provider stdio proxy without exposing upstream credentials', async () => {
  const s = await setup()
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
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['chart', 'legacy'])
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
  vi.spyOn(s.runtime.services.approvals, 'request').mockResolvedValue(true)
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
it('rechecks device authorization after an approval and rejects read-only app mutations', async () => {
  const s = await setup(),
    bridge = s.runtime.services.mcpApps
  await bridge.proxy(s.token, 'tools/call', { name: 'chart' })
  const ref = recentTools(
    s.runtime.services.activity.list('', 'task-activity', 0, s.task.id).events,
  ).flatMap((event) => mcpAppReferences(event.payload))[0]
  let revoked = false
  vi.spyOn(s.runtime.services.approvals, 'request').mockImplementation(async () => {
    revoked = true
    return true
  })
  await expect(
    bridge.action(s.task.id, ref.id, 'revoked', 'tools/call', { name: 'refresh' }, () => {
      if (revoked) throw new HttpError(401, 'Device revoked')
    }),
  ).rejects.toThrow('Device revoked')
  expect(s.calls()).toBe(1)
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  await expect(
    bridge.action(s.task.id, ref.id, 'readonly', 'tools/call', { name: 'refresh' }),
  ).rejects.toThrow('read-only')
})
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
