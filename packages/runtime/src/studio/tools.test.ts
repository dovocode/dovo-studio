import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { studioPeers } from './peers.js'
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
it('rejects thread and automation permission escalation before persisting changes', async () => {
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
  ).toBe(403)
  expect(s.store.get().tasks).toHaveLength(count)
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
  ).toBe(403)
  source.s.preferences.save({ enableStudioThreads: false })
  expect((await source.post('threads', { action: 'list' }, pairing.peer.id)).status).toBe(403)
})

it('rejects older paired runtimes before attempting an unscoped tool action', async () => {
  const source = await setup()
  const paths: string[] = []
  const legacy = createServer((request, response) => {
    paths.push(request.url ?? '')
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
  expect(paths).toEqual(['/api/studio/forward'])
})
