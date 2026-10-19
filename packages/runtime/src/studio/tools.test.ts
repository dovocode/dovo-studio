import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { studioPeers, routedStudioTool } from './peers.js'
import { ThreadWatch } from './thread-watch.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  decode,
  mutableStruct,
  noStudioTools,
  type Automation,
  type StudioTools,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { taskToolsServer } from '../agent-tools/config.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { runtimeIntegration } from '../testing/integration.js'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function setup(
  flags: StudioTools = {
    threads: true,
    automations: true,
    browsers: true,
    ui: true,
    diagnostics: true,
  },
  readOnly = false,
) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'studio-tools-test-owner-token-at-least-32-chars',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({
    enableStudioThreads: flags.threads,
    enableStudioAutomations: flags.automations,
    enableStudioBrowsers: flags.browsers,
    enableStudioUI: flags.ui,
    enableStudioDiagnostics: flags.diagnostics,
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = randomUUID()
  s.store.updateTask(parent.id, (task) => ({ ...task, activeRunId: runId, status: 'running' }))
  const token = s.runCredentials.issue(
    {
      taskId: parent.id,
      runId,
      permissions: { provider: 'codex', permission: readOnly ? 'read-only' : 'ask' },
      readOnly,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
      studioTools: flags,
    },
    new AbortController().signal,
  )
  const origin = `http://127.0.0.1:${runtime.port}`
  const raw = (path: string, input: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const post = (part: string, command: unknown, runtimeId?: string) =>
    raw('/api/studio/tools', { taskId: parent.id, parentRunId: runId, part, command, runtimeId })
  return { s, runtime, origin, parent, runId, token, post, raw, flags }
}
function flow(): Automation {
  const data = {
    kind: 'task' as const,
    label: 'Task',
    trigger: 'manual' as const,
    schedule: '',
    timezone: 'UTC',
    objective: 'Say done',
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'main' as const,
  }
  return {
    id: 'test-flow',
    name: 'Studio test',
    enabled: false,
    nodes: [
      {
        id: 'trigger',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: { ...data, kind: 'trigger' },
      },
      { id: 'task', type: 'automation', position: { x: 1, y: 0 }, data },
      {
        id: 'review',
        type: 'automation',
        position: { x: 2, y: 0 },
        data: { ...data, kind: 'review' },
      },
    ],
    edges: [
      { id: 'a', source: 'trigger', target: 'task' },
      { id: 'b', source: 'task', target: 'review' },
    ],
  }
}
it('enforces independent runtime/run toggles, exact run scope, and read-only access over HTTP', async () => {
  const { s, parent, runId, post, raw } = await setup({ ...noStudioTools(), threads: true })
  expect((await post('threads', { action: 'list' })).status).toBe(200)
  for (const part of ['automations', 'browsers', 'ui', 'diagnostics'])
    expect((await post(part, { action: 'list' })).status).toBe(403)
  s.preferences.save({ enableStudioDiagnostics: true })
  expect((await post('diagnostics', { action: 'health' })).status).toBe(403)
  expect(
    (
      await raw('/api/studio/tools', {
        taskId: 'other',
        parentRunId: runId,
        part: 'threads',
        command: { action: 'list' },
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await raw('/api/studio/tools', {
        taskId: parent.id,
        parentRunId: 'other',
        part: 'threads',
        command: { action: 'list' },
      })
    ).status,
  ).toBe(403)
  expect((await raw('/api/studio/session', { sessionId: 'forged', label: 'Agent' })).status).toBe(
    403,
  )
  s.preferences.save({ enableStudioThreads: false })
  expect((await post('threads', { action: 'list' })).status).toBe(403)
  const reader = await setup(undefined, true)
  expect((await reader.post('threads', { action: 'list' })).status).toBe(200)
  expect(
    (await reader.post('threads', { action: 'create', title: 'Forbidden', repositoryId: 'repo' }))
      .status,
  ).toBe(403)
  expect((await reader.post('browsers', { action: 'open' })).status).toBe(403)
  reader.s.runCredentials.revoke(reader.token)
  expect((await reader.post('diagnostics', { action: 'health' })).status).toBe(401)
})
it('creates, sends, waits, reads, searches and archives threads through existing task services', async () => {
  const { s, post } = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => run.onText('Studio answer'),
  })
  const created = await post('threads', {
    action: 'create',
    title: 'Tool thread',
    repositoryId: 'repo',
    agentId: 'agent',
  })
  expect(created.status).toBe(200)
  const { id } = decode(mutableStruct({ id: Schema.String }), await created.json())
  const send = { action: 'send', id, text: 'Inspect this behavior', messageId: randomUUID() }
  expect((await post('threads', send)).status).toBe(200)
  expect((await post('threads', { action: 'wait', id })).status).toBe(200)
  expect((await post('threads', send)).status).toBe(200)
  const read = await post('threads', { action: 'read', id })
  expect(read.status).toBe(200)
  expect(await read.text()).toContain('Studio answer')
  expect((await post('threads', { action: 'search', query: 'Studio answer' })).status).toBe(200)
  expect(s.store.task(id).messages.filter((message) => message.id === send.messageId)).toHaveLength(
    1,
  )
  expect((await post('threads', { action: 'archive', id })).status).toBe(200)
  expect(s.store.taskSummary(id).archivedAt).toBeTruthy()
  expect((await post('threads', { action: 'unarchive', id })).status).toBe(200)
  expect(s.store.taskSummary(id).archivedAt).toBeUndefined()
  expect((await post('diagnostics', { action: 'health' })).status).toBe(200)
  expect((await post('diagnostics', { action: 'activity', scope: id })).status).toBe(200)
}, 30000)
it('validates and manages automations and runs without admitting approval bypasses', async () => {
  const { s, post, raw } = await setup()
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => run.onText('Automation done'),
  })
  expect((await post('automations', { action: 'create', automation: flow() })).status).toBe(200)
  expect((await post('automations', { action: 'create', automation: flow() })).status).toBe(409)
  const invalid = { ...flow(), edges: [] }
  expect((await post('automations', { action: 'update', automation: invalid })).status).toBe(400)
  expect(s.store.get().automations[0].edges).toHaveLength(2)
  const changed = { ...flow(), name: 'Updated workflow' }
  expect((await post('automations', { action: 'update', automation: changed })).status).toBe(200)
  expect(
    (await post('automations', { action: 'enable', id: changed.id, enabled: true })).status,
  ).toBe(200)
  const run = { action: 'run', id: changed.id, requestId: randomUUID() }
  const result = await post('automations', run)
  expect(result.status).toBe(200)
  const { id } = decode(mutableStruct({ id: Schema.String }), await result.json())
  expect(
    decode(mutableStruct({ id: Schema.String }), await (await post('automations', run)).json()).id,
  ).toBe(id)
  expect((await post('automations', { action: 'wait', id })).status).toBe(200)
  expect(s.jobs.detail(id).status).toBe('waiting')
  expect((await post('automations', { action: 'approve', id })).status).toBe(400)
  expect((await raw('/api/jobs/review', { id, allow: true })).status).toBe(403)
  expect((await post('automations', { action: 'runs', id: changed.id })).status).toBe(200)
  expect((await post('automations', { action: 'cancel', id })).status).toBe(200)
  expect(s.jobs.detail(id).status).toBe('cancelled')
}, 30000)
it('inherits thread permissions and rejects automation permission escalation', async () => {
  const { s, post } = await setup()
  s.store.update((workspace) => ({
    ...workspace,
    agents: [
      ...workspace.agents,
      { ...workspace.agents[0], id: 'full', permission: 'full-access' },
    ],
  }))
  const count = s.store.get().tasks.length
  expect(
    (
      await post('threads', {
        action: 'create',
        title: 'Escalation',
        repositoryId: 'repo',
        agentId: 'full',
      })
    ).status,
  ).toBe(200)
  expect(s.store.get().tasks).toHaveLength(count + 1)
  expect(s.store.get().tasks.at(-1)?.agentOverrides?.permission).toBe('ask')
  const automation = flow()
  automation.nodes[1].data.agentId = 'full'
  expect((await post('automations', { action: 'create', automation })).status).toBe(403)
  expect(s.store.get().automations).toHaveLength(0)
})
it('exposes only selected tools over the actual MCP transport', async () => {
  const source = await setup({
    ...noStudioTools(),
    threads: true,
    diagnostics: true,
  })
  const { runtime, parent, runId, token, flags } = source
  const target = await setup()
  const pairing = await pairComputers(source, target)
  const config = taskToolsServer(
    parent.id,
    runtime.port,
    token,
    '127.0.0.1',
    false,
    false,
    runId,
    false,
    false,
    [],
    false,
    undefined,
    undefined,
    flags,
  )
  const client = new Client({ name: 'studio-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...config.envValues }).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  })
  cleanups.push(async () => {
    await client.close()
    await transport.close()
  })
  await client.connect(transport)
  const names = (await client.listTools()).tools
    .map((tool) => tool.name)
    .filter((name) => name.startsWith('studio_'))
  expect(names.sort()).toEqual(['studio_diagnostics', 'studio_discover', 'studio_threads'])
  expect(
    (await client.callTool({ name: 'studio_threads', arguments: { command: { action: 'list' } } }))
      .isError,
  ).not.toBe(true)
  expect((await client.callTool({ name: 'studio_discover', arguments: {} })).isError).not.toBe(true)
  const remoteCreated = await client.callTool({
    name: 'studio_threads',
    arguments: {
      runtimeId: pairing.peer.id,
      command: {
        action: 'create',
        title: 'Scoped remote MCP draft',
        repositoryId: 'repo',
        agentId: 'agent',
      },
    },
  })
  expect(remoteCreated.isError).not.toBe(true)
  expect(target.s.store.get().tasks.some((task) => task.title === 'Scoped remote MCP draft')).toBe(
    true,
  )
  expect(source.s.store.get().tasks.some((task) => task.title === 'Scoped remote MCP draft')).toBe(
    false,
  )

  expect(
    (
      await client.callTool({
        name: 'studio_automations',
        arguments: { command: { action: 'list' } },
      })
    ).isError,
  ).toBe(true)
})

it('serves external MCP clients with live toggles and revocable paired-device authentication', async () => {
  const source = await setup({ ...noStudioTools(), threads: true })
  const { s, origin } = source
  const target = await setup()
  const pairing = await pairComputers(source, target)
  const token = randomUUID()
  const device = s.devices.add('External agent', token)
  const client = new Client({ name: 'external-agent', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['apps/api/dist/server-cli.js', 'studio-tools'],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      DOVO_RUNTIME_URL: origin,
      DOVO_DEVICE_TOKEN: token,
    },
  })
  cleanups.push(() => client.close())
  await client.connect(transport)
  expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
    'studio_discover',
    'studio_threads',
  ])
  const created = await client.callTool({
    name: 'studio_threads',
    arguments: {
      command: {
        action: 'create',
        title: 'External draft',
        repositoryId: 'repo',
        agentId: 'agent',
      },
    },
  })
  expect(created.isError).not.toBe(true)
  expect(s.store.get().tasks.some((task) => task.title === 'External draft')).toBe(true)
  const remoteCreated = await client.callTool({
    name: 'studio_threads',
    arguments: {
      runtimeId: pairing.peer.id,
      command: {
        action: 'create',
        title: 'External remote MCP draft',
        repositoryId: 'repo',
        agentId: 'agent',
      },
    },
  })
  expect(remoteCreated.isError).not.toBe(true)
  expect(
    target.s.store.get().tasks.some((task) => task.title === 'External remote MCP draft'),
  ).toBe(true)
  expect(s.store.get().tasks.some((task) => task.title === 'External remote MCP draft')).toBe(false)

  s.preferences.save({ enableStudioThreads: false, enableStudioDiagnostics: true })
  expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
    'studio_diagnostics',
    'studio_discover',
  ])
  expect(
    (await client.callTool({ name: 'studio_threads', arguments: { command: { action: 'list' } } }))
      .isError,
  ).toBe(true)
  expect(
    (
      await client.callTool({
        name: 'studio_diagnostics',
        arguments: { command: { action: 'health' } },
      })
    ).isError,
  ).not.toBe(true)
  expect(
    (
      await client.callTool({
        name: 'studio_diagnostics',
        arguments: { command: { action: 'invalid' } },
      })
    ).isError,
  ).toBe(true)
  s.preferences.save({ enableStudioUI: true })
  expect((await client.listTools()).tools.some((tool) => tool.name === 'studio_ui')).toBe(true)
  s.devices.revoke(device)
  await expect(client.listTools()).rejects.toThrow(/401/)
})

async function pairComputers(
  source: Awaited<ReturnType<typeof setup>>,
  target: Awaited<ReturnType<typeof setup>>,
) {
  const token = randomUUID()
  const deviceId = target.s.devices.add('Paired Studio', token)
  const sessionId = randomUUID()
  const register = (peers: unknown[]) =>
    fetch(source.origin + '/api/studio/peers', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer studio-tools-test-owner-token-at-least-32-chars',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, peers }),
    })
  const peer = {
    id: 'other-computer',
    name: 'Other computer',
    connection: { address: target.origin, token },
  }
  expect((await register([peer])).status).toBe(200)
  return { register, peer, deviceId, token }
}
it('routes non-UI tools to a selected paired runtime over HTTP without exposing credentials', async () => {
  const source = await setup()
  const target = await setup()
  target.s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({ ...repo, name: 'Remote project' })),
  }))
  const pairing = await pairComputers(source, target)
  const discovery = await source.post('discover', {})
  const listed = await discovery.text()
  expect(listed).toContain('other-computer')
  expect(listed).not.toContain(pairing.token)
  expect(listed).not.toContain(target.origin)
  const remote = await source.post('discover', {}, pairing.peer.id)
  expect(await remote.text()).toContain('Remote project')
  const created = await source.post(
    'threads',
    { action: 'create', title: 'Remote draft', repositoryId: 'repo', agentId: 'agent' },
    pairing.peer.id,
  )
  expect(created.status).toBe(200)
  expect(target.s.store.get().tasks.some((task) => task.title === 'Remote draft')).toBe(true)
  expect(source.s.store.get().tasks.some((task) => task.title === 'Remote draft')).toBe(false)
  expect((await source.post('automations', { action: 'list' }, pairing.peer.id)).status).toBe(200)
  expect((await source.post('browsers', { action: 'list' }, pairing.peer.id)).status).toBe(200)
  expect((await source.post('diagnostics', { action: 'health' }, pairing.peer.id)).status).toBe(200)
  expect((await source.post('ui', { action: 'list' }, pairing.peer.id)).status).toBe(403)
  expect((await source.post('threads', { action: 'list' }, 'unknown')).status).toBe(404)
  target.s.preferences.save({ enableStudioThreads: false })
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(403)
  target.s.preferences.save({ enableStudioThreads: true })
  target.s.devices.revoke(pairing.deviceId)
  const revoked = await source.post('threads', { action: 'list' }, pairing.peer.id)
  expect(revoked.status).toBe(401)
  expect(await revoked.text()).not.toContain(pairing.token)
  expect((await pairing.register([])).status).toBe(200)
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(404)
})
it('preserves run read-only access and permission ceilings across paired computers', async () => {
  const reader = await setup(undefined, true)
  const target = await setup()
  const pairing = await pairComputers(reader, target)
  expect((await reader.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(200)
  expect(
    (
      await reader.post(
        'threads',
        { action: 'create', title: 'Forbidden', repositoryId: 'repo', agentId: 'agent' },
        pairing.peer.id,
      )
    ).status,
  ).toBe(403)
  expect((await reader.post('browsers', { action: 'open' }, pairing.peer.id)).status).toBe(403)
  expect((await reader.raw('/api/studio/peers', { sessionId: 'forged', peers: [] })).status).toBe(
    403,
  )
  expect(
    (
      await reader.raw('/api/studio/forward', {
        taskId: reader.parent.id,
        part: 'threads',
        command: { action: 'list' },
      })
    ).status,
  ).toBe(403)
  const source = await setup()
  await pairComputers(source, target)
  target.s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'full-access' })),
  }))
  expect(
    (
      await source.post(
        'threads',
        { action: 'create', title: 'Too powerful', repositoryId: 'repo', agentId: 'agent' },
        pairing.peer.id,
      )
    ).status,
  ).toBe(200)
  expect(target.s.store.get().tasks.at(-1)?.agentOverrides?.permission).toBe('ask')
  source.s.preferences.save({ enableStudioThreads: false })
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(403)
})

it('rejects older paired runtimes before attempting an unscoped tool action', async () => {
  const source = await setup()
  const paths: string[] = []
  const legacy = createServer((request, response) => {
    paths.push(request.url ?? '')
    // This older runtime supports forwarding but would silently drop the new creation fields.
    if (request.url === '/api/studio/forward') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: 'unexpected-legacy-draft', status: 'draft' }))
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Endpoint not found' }))
  })
  legacy.listen(0, '127.0.0.1')
  await once(legacy, 'listening')
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        legacy.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = legacy.address()
  if (!address || typeof address === 'string') throw new Error('Missing legacy runtime address')
  studioPeers(source.s).register(
    'owner',
    {
      sessionId: 'legacy',
      peers: [
        {
          id: 'legacy',
          name: 'Legacy',
          connection: {
            address: `http://127.0.0.1:${address.port}`,
            token: 'legacy-pairing-token-at-least-32-chars',
          },
        },
      ],
    },
    () => {},
  )
  const response = await source.post(
    'threads',
    { action: 'create', title: 'Must not execute', repositoryId: 'repo', agentId: 'agent' },
    'legacy',
  )
  expect(response.status).toBe(404)
  expect(await response.text()).toContain('Update this paired runtime')
  expect(paths).toEqual(['/api/studio/forward-v2'])
})

it('durably monitors remote children, preserves offline facts and delivers each attention/completion once', async () => {
  const source = await setup()
  const target = await setup()
  const pairing = await pairComputers(source, target)
  source.s.store.updateTask(source.parent.id, (task) => ({ ...task, queuePaused: true }))
  const response = await source.post(
    'threads',
    { action: 'create', title: 'Remote child', repositoryId: 'repo', agentId: 'agent' },
    pairing.peer.id,
  )
  expect(response.status).toBe(200)
  const child = decode(mutableStruct({ id: Schema.String }), await response.json())
  expect(source.s.threadWatch.list(source.parent.id)).toMatchObject([
    { runtimeId: pairing.peer.id, threadId: child.id, relation: 'spawned' },
  ])
  await source.s.threadWatch.tick()
  expect(source.s.threadWatch.list(source.parent.id)[0]?.snapshot?.phase).toBe('draft')
  const prepare = vi.spyOn(source.s.db, 'prepare')
  for (let index = 0; index < 10; index++)
    source.s.store.updateTask(source.parent.id, (task) => ({
      ...task,
      activity: `Streaming ${index}`,
    }))
  expect(
    prepare.mock.calls.filter(([sql]) => sql === 'SELECT value FROM task_thread_watches'),
  ).toHaveLength(0)
  prepare.mockRestore()
  target.s.store.updateTask(child.id, (task) => ({ ...task, status: 'review', queuePaused: true }))
  source.s.db.exec(
    `CREATE TRIGGER reject_thread_snapshot BEFORE INSERT ON task_thread_watches WHEN json_extract(NEW.value, '$.snapshot.phase') = 'completed' BEGIN SELECT RAISE(ABORT, 'Rejected snapshot'); END`,
  )
  const deliveryError = vi.spyOn(console, 'error').mockImplementation(() => {})
  await source.s.threadWatch.tick()
  expect(deliveryError).toHaveBeenCalledWith(
    'Thread watch delivery failed',
    expect.any(String),
    expect.any(String),
    expect.any(String),
    expect.objectContaining({ message: 'Rejected snapshot' }),
  )
  deliveryError.mockRestore()
  expect(source.s.store.taskSummary(source.parent.id).queue ?? []).toHaveLength(0)
  source.s.db.exec('DROP TRIGGER reject_thread_snapshot')
  await source.s.threadWatch.tick()
  const messages = () => source.s.store.taskSummary(source.parent.id).queue?.length ?? 0
  expect(messages()).toBe(1)
  await source.s.threadWatch.tick()
  expect(messages()).toBe(1)
  const persisted = new ThreadWatch(
    source.s.db,
    source.s,
    (parentId, runtimeId, threadId, policy) =>
      routedStudioTool(
        source.s,
        parentId,
        'threads',
        { action: 'snapshot', id: threadId },
        runtimeId,
        () => {},
        policy,
      ),
  )
  await persisted.tick()
  expect(messages()).toBe(1)
  expect((await source.post('threads', { action: 'watches' })).status).toBe(200)
  expect(persisted.list(source.parent.id)[0]?.status).toBe('completed')
  // A completed spawn is retained without polling. Explicit watching resumes observation.
  persisted.watch(source.parent.id, pairing.peer.id, child.id, 'Server')
  const last = persisted.list(source.parent.id)[0]?.lastSuccessAt
  expect((await pairing.register([])).status).toBe(200)
  await persisted.tick()
  expect(persisted.list(source.parent.id)[0]).toMatchObject({
    offline: true,
    lastSuccessAt: last,
    snapshot: { phase: 'completed' },
  })
  expect(messages()).toBe(1)
  expect((await pairing.register([pairing.peer])).status).toBe(200)
  const controller = new AbortController()
  cleanups.push(async () => controller.abort())
  void target.s.questions.request(
    child.id,
    {
      title: 'Review contact',
      questions: [
        {
          id: 'contact',
          header: 'Contact',
          question: 'Which review contact?',
          options: [],
          multiple: false,
          custom: true,
          secret: false,
          required: true,
          inputType: 'text',
        },
      ],
    },
    controller.signal,
  )
  await persisted.tick()
  expect(persisted.list(source.parent.id)[0]).toMatchObject({
    offline: false,
    snapshot: { phase: 'needs-input' },
  })
  expect(messages()).toBe(2)
  await persisted.tick()
  expect(messages()).toBe(2)
  const secondController = new AbortController()
  cleanups.push(async () => secondController.abort())
  void target.s.questions.request(
    child.id,
    {
      title: 'Second question',
      questions: [
        {
          id: 'second',
          header: 'Second',
          question: 'Another detail?',
          options: [],
          multiple: false,
          custom: true,
          secret: false,
          required: true,
          inputType: 'text',
        },
      ],
    },
    secondController.signal,
  )
  await persisted.tick()
  expect(messages()).toBe(3)
  controller.abort()
  await persisted.tick()
  expect(messages()).toBe(3)
  secondController.abort()
  await persisted.tick()
  expect(messages()).toBe(3)
  source.s.store.updateTask(source.parent.id, (task) => ({ ...task, archived: true }))
  expect(persisted.list(source.parent.id)[0]?.status).toBe('completed')
  await persisted.tick()
  expect(messages()).toBe(3)
})

it('links existing remote threads without calling them spawned and respects read-only runs', async () => {
  const source = await setup()
  const target = await setup()
  const pairing = await pairComputers(source, target)
  const response = await source.post(
    'threads',
    { action: 'watch', id: target.parent.id },
    pairing.peer.id,
  )
  expect(response.status).toBe(200)
  expect(source.s.threadWatch.list(source.parent.id)[0]?.relation).toBe('linked')
  expect(
    (await source.post('threads', { action: 'unwatch', id: target.parent.id }, pairing.peer.id))
      .status,
  ).toBe(200)
  expect(source.s.threadWatch.list(source.parent.id)[0]?.status).toBe('stopped')
  const readonly = await setup(undefined, true)
  const readonlyPairing = await pairComputers(readonly, target)
  expect(
    (
      await readonly.post(
        'threads',
        { action: 'watch', id: target.parent.id },
        readonlyPairing.peer.id,
      )
    ).status,
  ).toBe(403)
})

it('retains durable thread control after the desktop lease expires and removes it when pairing is forgotten', async () => {
  const source = await setup()
  const target = await setup()
  const pairing = await pairComputers(source, target)
  expect(
    (await source.post('threads', { action: 'watch', id: target.parent.id }, pairing.peer.id))
      .status,
  ).toBe(200)
  source.s.retrievalPeers.register('owner', { sessionId: 'durable', peers: [pairing.peer] })
  // Simulate a disconnected desktop, rather than explicitly forgetting its saved pairings.
  studioPeers(source.s).register('owner', { sessionId: 'disconnected', peers: [] }, () => {})
  await source.s.threadWatch.tick()
  expect(source.s.threadWatch.list(source.parent.id)[0]).toMatchObject({
    offline: false,
    snapshot: { phase: 'running' },
  })
  expect(
    (
      await source.post(
        'threads',
        { action: 'create', title: 'Durable child', repositoryId: 'repo' },
        pairing.peer.id,
      )
    ).status,
  ).toBe(200)
  expect((await pairing.register([])).status).toBe(200)
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(404)
  // Retrieval-only registration still supports read-only watch snapshots.
  source.s.retrievalPeers.register('owner', { sessionId: 'retrieval', peers: [pairing.peer] })
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(404)
  expect(JSON.stringify(source.s.store.taskSummary(source.parent.id).threadWatches)).not.toContain(
    pairing.token,
  )
  target.s.devices.revoke(pairing.deviceId)
  await source.s.threadWatch.tick()
  expect(source.s.threadWatch.list(source.parent.id)[0]).toMatchObject({
    offline: true,
    snapshot: { phase: 'running' },
  })
})

it('deduplicates remote creation and supports an explicitly authorized permission increase', async () => {
  const source = await setup()
  const target = await setup()
  const pairing = await pairComputers(source, target)
  const command = {
    action: 'create',
    title: 'Explicit full-access child',
    repositoryId: 'repo',
    harness: {
      provider: 'codex',
      model: '',
      reasoning: '',
      instructions: '',
      endpoint: '',
      permission: 'full-access',
    },
    allowPermissionIncrease: true,
    requestId: 'durable-child-request',
    prompt: 'Do the task',
  }
  const responses = await Promise.all([
    source.post('threads', command, pairing.peer.id),
    source.post('threads', command, pairing.peer.id),
  ])
  const values = await Promise.all(
    responses.map(async (response) => {
      expect(response.status).toBe(200)
      return decode(mutableStruct({ id: Schema.String }), await response.json())
    }),
  )
  expect(values[0]?.id).toBe(values[1]?.id)
  const child = target.s.store.task(values[0]!.id)
  expect(child.agentOverrides?.permission).toBe('full-access')
  expect(target.s.store.get().tasks.filter((task) => task.title === command.title)).toHaveLength(1)
  expect(
    (await source.post('threads', { ...command, title: 'Changed request' }, pairing.peer.id))
      .status,
  ).toBe(409)
  expect(
    (await source.post('threads', { action: 'resume', id: child.id }, pairing.peer.id)).status,
  ).toBe(403)
  const run = vi.fn<AgentAdapter['run']>().mockResolvedValue(undefined)
  vi.spyOn(target.s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run,
  })
  expect(
    (
      await source.post(
        'threads',
        { action: 'resume', id: child.id, allowPermissionIncrease: true },
        pairing.peer.id,
      )
    ).status,
  ).toBe(200)
  await target.post('threads', { action: 'wait', id: child.id })
  expect(run).toHaveBeenCalledOnce()
})

it('creates and starts once, and preserves a created ID when startup fails', async () => {
  const { s, post } = await setup()
  const run = vi.fn<AgentAdapter['run']>().mockResolvedValue(undefined)
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run,
  })
  const command = {
    action: 'create',
    title: 'Start together',
    repositoryId: 'repo',
    agentId: 'agent',
    prompt: 'Work',
    start: true,
    requestId: 'create-start',
  }
  const response = await post('threads', command)
  expect(response.status).toBe(200)
  const first = decode(mutableStruct({ id: Schema.String }), await response.json())
  await post('threads', { action: 'wait', id: first.id })
  const retry = await post('threads', command)
  expect(decode(mutableStruct({ id: Schema.String }), await retry.json()).id).toBe(first.id)
  expect(run).toHaveBeenCalledOnce()
  const start = vi
    .spyOn(s.tasks, 'start')
    .mockRejectedValueOnce(new Error('Signing session unavailable'))
  const failed = await post('threads', { ...command, requestId: 'failing-start' })
  const outcome = decode(
    mutableStruct({ id: Schema.String, startError: Schema.String }),
    await failed.json(),
  )
  expect(outcome.startError).toContain('Signing session unavailable')
  expect(s.store.task(outcome.id).status).toBe('draft')
  expect(start).toHaveBeenCalledOnce()
})

it('isolates a full parent queue and retries delivery after capacity returns', async () => {
  const f = await setup()
  const other = f.s.tasks.create({
    title: 'Healthy parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  for (const id of [f.parent.id, other.id])
    f.s.store.updateTask(id, (task) => ({
      ...task,
      status: 'review',
      activeRunId: undefined,
      queuePaused: true,
    }))
  for (let i = 0; i < 50; i++) f.s.tasks.queue.add(f.parent.id, `full-${i}`, 'queued')
  const read = vi.fn<() => Promise<unknown>>(async () => ({
    title: 'Finished child',
    phase: 'completed',
    revision: '1',
    attention: [],
    watches: { pipelines: 0, pullRequests: 0, failures: 0 },
  }))
  const watch = new ThreadWatch(f.s.db, f.s, read)
  watch.watch(f.parent.id, 'remote', 'blocked', 'Server', undefined, 'spawned')
  watch.watch(other.id, 'remote', 'healthy', 'Server', undefined, 'spawned')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  await watch.tick()
  expect(read).toHaveBeenCalledTimes(2)
  expect(f.s.store.taskSummary(other.id).queue).toHaveLength(1)
  expect(watch.list(f.parent.id)[0]?.snapshot).toBeUndefined()
  expect(watch.list(f.parent.id)[0]?.status).toBe('watching')
  f.s.store.updateTask(f.parent.id, (task) => ({ ...task, queue: [] }))
  await watch.tick()
  await watch.tick()
  expect(f.s.store.taskSummary(f.parent.id).queue).toHaveLength(1)
  expect(f.s.store.taskSummary(other.id).queue).toHaveLength(1)
  expect(error).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(3)
})

it('limits active watches, bounds stopped history and enforces the limit when reactivating', async () => {
  const f = await setup()
  for (let i = 0; i < 45; i++) {
    f.s.threadWatch.watch(f.parent.id, 'remote', `old-${i}`, 'Server')
    f.s.threadWatch.stop(f.parent.id, 'remote', `old-${i}`)
  }
  expect(f.s.threadWatch.list(f.parent.id)).toHaveLength(40)
  const stopped = f.s.threadWatch.list(f.parent.id)[0]!
  for (let i = 0; i < 40; i++) f.s.threadWatch.watch(f.parent.id, 'remote', `active-${i}`, 'Server')
  expect(() => f.s.threadWatch.watch(f.parent.id, 'remote', 'overflow', 'Server')).toThrow(
    'At most 40',
  )
  expect(() => f.s.threadWatch.watch(f.parent.id, 'remote', stopped.threadId, 'Server')).toThrow(
    'At most 40',
  )
  expect(() => f.s.threadWatch.watch(f.parent.id, 'remote', 'active-0', 'Server')).not.toThrow()
  f.s.threadWatch.stop(f.parent.id, 'remote', 'active-0')
  f.s.threadWatch.watch(f.parent.id, 'remote', stopped.threadId, 'Server')
  const history = f.s.threadWatch.list(f.parent.id)
  expect(history.filter((w) => w.status === 'watching')).toHaveLength(40)
  expect(history.filter((w) => w.status === 'stopped').length).toBeLessThanOrEqual(40)
  f.s.store.updateTask(f.parent.id, (task) => ({ ...task, archived: true }))
  expect(f.s.threadWatch.list(f.parent.id)).toHaveLength(40)
  expect(f.s.store.taskSummary(f.parent.id).threadWatches).toHaveLength(40)
})

it('aggregates descendant attention and watch counts on the owning runtime over paired HTTP', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pairComputers(source, target)
  source.s.store.updateTask(source.parent.id, (task) => ({ ...task, queuePaused: true }))
  const child = target.s.tasks.create({
    title: 'Nested child',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  target.s.store.updateTask(child.id, (task) => ({
    ...task,
    status: 'review',
    queuePaused: true,
    delegation: {
      parentTaskId: target.parent.id,
      parentRunId: target.runId,
      key: 'nested',
      completion: 'read',
    },
  }))
  target.s.preferences.save({ enablePipelineWatching: true })
  vi.spyOn(target.s.forgeWork, 'request').mockResolvedValue({
    run: {
      id: '7',
      title: 'Build',
      url: 'https://github.com/team/project/actions/runs/7',
      ref: 'main',
      sha: 'a'.repeat(40),
      actor: 'author',
      status: 'in_progress',
      createdAt: '2026-10-19',
      updatedAt: '2026-10-19',
    },
    jobs: [],
    cachedAt: new Date().toISOString(),
  })
  await target.s.pipelineWatch.command({ taskId: child.id, action: 'watch', runIds: ['7'] })
  const controller = new AbortController()
  cleanups.push(async () => controller.abort())
  void target.s.questions.request(
    child.id,
    {
      title: 'Nested input',
      questions: [
        {
          id: 'nested',
          header: 'Nested',
          question: 'Continue?',
          options: [],
          multiple: false,
          custom: true,
          secret: false,
          required: true,
          inputType: 'text',
        },
      ],
    },
    controller.signal,
  )
  expect(
    (await source.post('threads', { action: 'watch', id: target.parent.id }, pairing.peer.id))
      .status,
  ).toBe(200)
  await source.s.threadWatch.tick()
  const snapshot = source.s.threadWatch.list(source.parent.id)[0]?.snapshot
  expect(snapshot).toMatchObject({
    phase: 'needs-input',
    watches: { pipelines: 1, pullRequests: 0, failures: 0 },
  })
  expect(snapshot?.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        runtimeId: target.s.runtimeId,
        threadId: child.id,
        phase: 'needs-input',
        watches: { pipelines: 1, pullRequests: 0, failures: 0 },
      }),
    ]),
  )
  expect(source.s.store.taskSummary(source.parent.id).watchCounts?.pipelines).toBe(1)
  const count = source.s.store.taskSummary(source.parent.id).queue?.length
  await source.s.threadWatch.tick()
  expect(source.s.store.taskSummary(source.parent.id).queue).toHaveLength(count!)
  controller.abort()
  await source.s.threadWatch.tick()
  expect(source.s.threadWatch.list(source.parent.id)[0]?.snapshot?.attention).toHaveLength(0)
})

it('retires completed spawned watches after durable delivery, preserves bounded results and frees active capacity', async () => {
  const f = await setup()
  f.s.store.updateTask(f.parent.id, (task) => ({
    ...task,
    status: 'review',
    activeRunId: undefined,
    queuePaused: true,
  }))
  const read = vi.fn<() => Promise<unknown>>(async () => ({
    title: 'Done',
    phase: 'completed',
    revision: 'finished',
    attention: [],
    watches: { pipelines: 0, pullRequests: 0, failures: 0 },
    result: 'Saved answer',
  }))
  const watch = new ThreadWatch(f.s.db, f.s, read)
  for (let i = 0; i < 40; i++)
    watch.watch(f.parent.id, 'remote', String(i), 'Server', undefined, 'spawned', true)
  await watch.tick()
  expect(watch.list(f.parent.id).filter((w) => w.status === 'completed')).toHaveLength(40)
  expect(read).toHaveBeenCalledTimes(40)
  await watch.tick()
  const reconstructed = new ThreadWatch(f.s.db, f.s, read)
  await reconstructed.tick()
  expect(read).toHaveBeenCalledTimes(40)
  expect(f.s.store.taskSummary(f.parent.id).queue).toHaveLength(40)
  reconstructed.watch(f.parent.id, 'remote', '40', 'Server', undefined, 'spawned', true)
  await reconstructed.tick()
  expect(reconstructed.list(f.parent.id)).toHaveLength(41)
  for (const completed of reconstructed.list(f.parent.id))
    reconstructed.acknowledgeChild(
      f.parent.id,
      completed.runtimeId,
      completed.threadId,
      completed.snapshot!,
    )
  const history = reconstructed.list(f.parent.id)
  expect(history).toHaveLength(40)
  expect(history.find((w) => w.threadId === '40')).toMatchObject({
    status: 'completed',
    snapshot: { result: 'Saved answer' },
  })
  // Legacy completed snapshots with durable receipts migrate without reading the remote child.
  f.s.db.exec(
    `UPDATE task_thread_watches SET value=json_remove(json_set(value, '$.status', 'watching'), '$.startedAt')`,
  )
  const migrated = new ThreadWatch(f.s.db, f.s, read)
  expect(migrated.list(f.parent.id).every((w) => w.status === 'completed')).toBe(true)
  await migrated.tick()
  expect(read).toHaveBeenCalledTimes(41)
  // Explicitly resuming monitoring consumes capacity again, without discarding the saved result.
  reconstructed.watch(f.parent.id, 'remote', '40', 'Server')
  expect(reconstructed.list(f.parent.id).find((w) => w.threadId === '40')).toMatchObject({
    status: 'watching',
    snapshot: { result: 'Saved answer' },
  })
})

it('keeps unacknowledged failed completed children beyond disposable history', async () => {
  const f = await setup()
  f.s.store.updateTask(f.parent.id, (task) => ({
    ...task,
    status: 'review',
    activeRunId: undefined,
    queuePaused: true,
  }))
  const read = vi.fn<() => Promise<unknown>>(async () => ({
    runtimeId: 'remote',
    title: 'Failed child',
    phase: 'completed',
    status: 'failed',
    failureVersion: 'attempt',
    revision: 'done',
    attention: [],
    watches: { pipelines: 0, pullRequests: 0, failures: 0 },
  }))
  const watch = new ThreadWatch(f.s.db, f.s, read)
  for (let i = 0; i < 41; i++) {
    watch.watch(f.parent.id, 'remote', String(i), 'Server', undefined, 'spawned')
    await watch.tick()
  }
  expect(watch.list(f.parent.id)).toHaveLength(41)
  expect(watch.list(f.parent.id).every((entry) => entry.status === 'completed')).toBe(true)
  expect(read).toHaveBeenCalledTimes(41)
  await watch.tick()
  expect(read).toHaveBeenCalledTimes(41)
})

it('rearms a completed child for a new message and rejects pre-message snapshots in flight', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pairComputers(source, target)
  const child = target.s.tasks.create({
    title: 'Repeatable child',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  target.s.store.updateTask(child.id, (task) => ({ ...task, status: 'review', queuePaused: true }))
  source.s.store.updateTask(source.parent.id, (task) => ({ ...task, queuePaused: true }))
  source.s.threadWatch.watch(
    source.parent.id,
    pairing.peer.id,
    child.id,
    'Server',
    undefined,
    'spawned',
    true,
  )
  await source.s.threadWatch.tick()
  expect(source.s.threadWatch.list(source.parent.id)[0].status).toBe('completed')
  let release: (value: unknown) => void = () => {
    throw new Error('Read did not start')
  }
  const read = vi.fn<() => Promise<unknown>>(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const observer = new ThreadWatch(source.s.db, source.s, read)
  const oldSnapshot = source.s.threadWatch.list(source.parent.id)[0].snapshot!
  const originalSend = target.s.tasks.sendEffect.bind(target.s.tasks)
  let pending: Promise<void> | undefined
  vi.spyOn(target.s.tasks, 'sendEffect').mockImplementation((...args) => {
    // Begin reading the old completion after capacity is reserved, before send is accepted.
    pending = observer.tick()
    return originalSend(...args)
  })
  const response = await source.post(
    'threads',
    { action: 'send', id: child.id, text: 'New work', messageId: 'new-work' },
    pairing.peer.id,
  )
  expect(response.status).toBe(200)
  expect(read).toHaveBeenCalledOnce()
  release(oldSnapshot)
  await pending
  expect(source.s.threadWatch.list(source.parent.id)[0].status).toBe('watching')
})
