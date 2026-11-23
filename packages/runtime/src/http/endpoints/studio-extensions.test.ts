import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { appView, defineExtension, page } from '@dovo/protocol/studio-extension-sdk'
import a2uiCard from '../../../../../examples/a2ui/media-and-configuration.json'
import {
  decode,
  mcpServerSchema,
  marketplaceDetailSchema,
  marketplaceListSchema,
  studioExtensionResultSchema,
  studioExtensionsListSchema,
  snapshotSchema,
  terminalSchema,
} from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
const human = 'paired-extension-client-token-at-least-32-chars'

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME'])
    vi.stubEnv(key, join(f.directory, key))
  vi.stubEnv('DOVO_TERMINAL_HOLDER_SUPERVISOR', '')
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'state.sqlite'),
    ownerToken: 'studio-extensions-owner-token-at-least-32-chars',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.devices.add('Paired computer', human)
  const task = s.tasks.create({
    title: 'Delivery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = 'extension-author'
  s.store.updateTask(task.id, (entry) => ({
    ...entry,
    draft: 'Keep this draft',
    status: 'running',
    activeRunId: runId,
  }))
  const controller = new AbortController()
  cleanups.push(async () => controller.abort())
  const issue = (readOnly: boolean) =>
    s.runCredentials.issue(
      {
        taskId: task.id,
        runId,
        permissions: { provider: 'codex', permission: readOnly ? 'read-only' : 'ask' },
        readOnly,
        artifacts: false,
        pipelineWatching: false,
        pullRequestWatching: false,
        deviceHub: false,
        memoryScopes: [],
      },
      controller.signal,
    )
  const post = (path: string, command: unknown, token = human) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })
  const person = (command: unknown) => post('studio-extensions', command)
  const agent = (token: string, command: unknown) =>
    post('agent/studio-extensions', { command, taskId: task.id, parentRunId: runId }, token)
  const manifest = {
    id: 'example.delivery',
    version: 1,
    name: 'Delivery',
    settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
    contributions: [
      {
        id: 'status',
        title: 'Service status',
        kind: 'tool',
        taskId: task.id,
        server: 'ci',
        tool: 'status',
        inputs: { branch: 'branch' },
      },
      { id: 'terminal', title: 'Open terminals', kind: 'studio', destination: 'terminal' },
    ],
  }
  return { runtime, s, task, post, person, agent, issue, manifest }
}

it('requires component support to review and install a structured view', async () => {
  const { person, manifest } = await setup()
  const view = {
    id: 'delivery-view',
    title: 'Delivery view',
    kind: 'view',
    placement: 'settings',
    view: {
      version: 1,
      root: 'main',
      nodes: [{ id: 'main', kind: 'button', label: 'Read status', action: 'status' }],
    },
  }
  const install = { action: 'install', id: manifest.id, expectedRevision: 1 }
  expect(
    (
      await person({
        action: 'stage',
        expectedRevision: 0,
        manifest: { ...manifest, contributions: [...manifest.contributions, view] },
      })
    ).status,
  ).toBe(200)
  const legacy = await (await person({ action: 'list' })).json()
  expect(legacy).toMatchObject({
    extensions: [{ error: expect.stringContaining('Update Studio') }],
  })
  expect(decode(studioExtensionsListSchema, legacy).extensions[0]?.draft?.contributions).toEqual(
    manifest.contributions,
  )
  expect((await person(install)).status).toBe(409)
  const modern = await (await person({ action: 'list', componentVersion: 1 })).json()
  expect(
    decode(studioExtensionsListSchema, modern).extensions[0]?.draft?.contributions,
  ).toContainEqual(view)
  const installed = await person({ ...install, componentVersion: 1 })
  expect(installed.status).toBe(200)
  expect(
    decode(studioExtensionResultSchema, await installed.json()).extension.installed?.contributions,
  ).toContainEqual(view)
})

it('projects custom props for older component clients and preserves them for current clients', async () => {
  const { person, manifest } = await setup()
  const component = { type: 'future-view', props: { layout: [{ title: 'Status' }] } }
  const view = {
    id: 'overview',
    kind: 'view',
    title: 'Overview',
    placement: 'settings',
    view: {
      version: 1,
      root: 'custom',
      nodes: [
        { id: 'custom', kind: 'custom', label: 'Custom', fallback: 'standard', component },
        { id: 'standard', kind: 'text', value: 'Standard content' },
      ],
    },
  }
  const staged = await person({
    action: 'stage',
    expectedRevision: 0,
    manifest: {
      ...manifest,
      contributions: [...manifest.contributions, view],
    },
  })
  expect(staged.status).toBe(200)
  const list = async (componentVersion: number) =>
    decode(
      studioExtensionsListSchema,
      await (await person({ action: 'list', componentVersion })).json(),
    ).extensions[0]
  const old = await list(1)
  expect(old?.error).toContain('Update Studio')
  expect(old?.draft?.contributions).toContainEqual({
    ...view,
    view: {
      ...view.view,
      nodes: [{ ...view.view.nodes[0], component: { type: 'future-view' } }, view.view.nodes[1]],
    },
  })
  const install = { action: 'install', id: manifest.id, expectedRevision: 1 }
  expect((await person({ ...install, componentVersion: 1 })).status).toBe(409)
  expect((await list(2))?.draft?.contributions).toContainEqual(view)
  expect((await person({ ...install, componentVersion: 2 })).status).toBe(200)
  expect((await list(1))?.installed?.contributions).not.toContainEqual(view)
  expect((await list(2))?.installed?.contributions).toContainEqual(view)
})

it('lets agents stage an extension, then installs, edits settings and rolls back on human request', async () => {
  const { s, task, post, person, agent, issue, manifest } = await setup()
  const run = issue(false)
  const queries: unknown[] = []
  let requests = 0
  let readOnly = true
  const upstream = new Server(
    { name: 'Extension fixture', version: '1' },
    { capabilities: { tools: {} } },
  )
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'status',
        annotations: { readOnlyHint: readOnly },
        inputSchema: {
          type: 'object',
          properties: { branch: { type: 'string' } },
          required: ['branch'],
          additionalProperties: false,
        },
      },
    ],
  }))
  upstream.setRequestHandler(CallToolRequestSchema, async (request) => {
    queries.push(request.params)
    return { content: [], structuredContent: { healthy: true } }
  })
  await upstream.connect(transport)
  const http = createServer((request, response) => {
    requests++
    void transport.handleRequest(request, response)
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  cleanups.push(async () => {
    await upstream.close()
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('Missing extension server address')
  const server = decode(mcpServerSchema, {
    name: 'ci',
    transport: 'http',
    enabled: true,
    url: `http://127.0.0.1:${address.port}`,
  })
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) =>
      agent.id === 'agent'
        ? {
            ...agent,
            resources: { mcpServers: [server], hooks: [], skills: [] },
          }
        : agent,
    ),
  }))
  const edit = (action: string, expectedRevision: number) => ({
    action,
    id: manifest.id,
    expectedRevision,
  })
  const call = { ...edit('call', 1), contributionId: 'status' }

  expect((await agent(run, { action: 'catalog' })).status).toBe(200)
  expect((await agent(run, { action: 'stage', manifest, expectedRevision: 0 })).status).toBe(200)
  const read = { action: 'read', id: manifest.id }
  expect(await (await agent(run, read)).json()).toEqual({
    id: manifest.id,
    revision: 1,
    enabled: false,
    draft: manifest,
  })
  expect((await person(read)).status).toBe(403)
  expect((await agent(run, edit('install', 1))).status).toBe(403)
  expect((await person(call)).status).toBe(404)
  expect(requests).toBe(0)

  const installed = decode(
    studioExtensionResultSchema,
    await (await person(edit('install', 1))).json(),
  ).extension
  expect(installed).toMatchObject({ enabled: true, revision: 2, settings: { branch: 'main' } })
  expect(requests).toBe(0)
  expect(
    await (await person({ ...edit('open', 2), contributionId: 'terminal' })).json(),
  ).toMatchObject({
    contribution: { destination: 'terminal' },
  })
  expect((await agent(run, { ...edit('open', 2), contributionId: 'terminal' })).status).toBe(403)
  expect((await person({ ...edit('settings', 2), settings: { branch: true } })).status).toBe(400)
  expect((await person({ ...edit('settings', 2), settings: { branch: 'release' } })).status).toBe(
    200,
  )
  expect(await (await agent(run, read)).json()).toEqual({
    id: manifest.id,
    revision: 3,
    enabled: true,
    installed: manifest,
  })
  expect((await person({ ...call, expectedRevision: 2 })).status).toBe(409)
  const access = { owner: 'extension', id: manifest.id, sourceId: 'status', expectedRevision: 3 }
  expect((await person({ ...call, expectedRevision: 3 })).status).toBe(403)
  expect(
    (
      await post(
        'studio/source-policy',
        { ...access, policy: { access: 'persistent', autoLoad: true } },
        run,
      )
    ).status,
  ).toBe(403)
  expect(
    await (
      await post('studio/source-policy', {
        ...access,
        policy: { access: 'session', autoLoad: false },
      })
    ).json(),
  ).toEqual({ access: 'session', autoLoad: false })
  expect((await person({ ...call, expectedRevision: 3, automatic: true })).status).toBe(403)
  expect(await (await agent(run, { ...call, expectedRevision: 3 })).json()).toEqual({
    data: { healthy: true },
  })
  expect(queries).toEqual([
    expect.objectContaining({ name: 'status', arguments: { branch: 'release' } }),
  ])
  readOnly = false
  expect((await agent(run, { ...call, expectedRevision: 3 })).status).toBe(403)
  expect(queries).toHaveLength(1)
  readOnly = true
  expect(
    (
      await post('studio/source-policy', {
        ...access,
        policy: { access: 'persistent', autoLoad: true },
      })
    ).status,
  ).toBe(200)
  s.store.updateTask(task.id, (entry) => ({ ...entry, archivedAt: new Date().toISOString() }))
  expect((await person({ ...call, expectedRevision: 3, automatic: true })).status).toBe(200)
  s.store.updateTask(task.id, (entry) => ({ ...entry, archivedAt: undefined }))
  expect(
    (await post('studio/source-policy', { ...access, policy: { access: 'off', autoLoad: false } }))
      .status,
  ).toBe(200)
  expect((await person({ ...call, expectedRevision: 3 })).status).toBe(403)
  expect(
    (
      await person({
        action: 'stage',
        manifest: { ...manifest, name: 'Delivery v2' },
        expectedRevision: 3,
      })
    ).status,
  ).toBe(200)
  expect((await person(edit('install', 4))).status).toBe(200)
  const restored = decode(
    studioExtensionResultSchema,
    await (await person(edit('rollback', 5))).json(),
  ).extension
  expect(restored.installed?.name).toBe('Delivery')
  expect(restored.settings).toEqual({ branch: 'release' })
  expect((await person(edit('disable', 6))).status).toBe(200)
  expect((await person({ ...call, expectedRevision: 7 })).status).toBe(404)
  expect((await person(edit('enable', 7))).status).toBe(200)
  expect((await person(edit('remove', 8))).status).toBe(200)
  expect(
    decode(studioExtensionsListSchema, await (await person({ action: 'list' })).json()).extensions,
  ).toEqual([])
})

it('rejects unsupported manifests and read-only agent authors', async () => {
  const { manifest, person, agent, issue } = await setup()
  expect(
    (await person({ action: 'stage', manifest: { ...manifest, version: 2 }, expectedRevision: 0 }))
      .status,
  ).toBe(400)
  expect(
    (
      await person({
        action: 'stage',
        manifest: { ...manifest, activate: 'run code' },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400)
  expect(
    (await agent(issue(true), { action: 'stage', manifest, expectedRevision: 0 })).status,
  ).toBe(403)
})

it('lets writable agents install their own staged extensions only when the computer opts in', async () => {
  const { person, agent, issue, manifest } = await setup()
  const run = issue(false)
  const stage = { action: 'stage', manifest, expectedRevision: 0 }
  const install = { action: 'install', id: manifest.id, expectedRevision: 1 }
  const policy = { action: 'agent-install-policy', enabled: true }
  expect((await agent(run, stage)).status).toBe(200)
  expect((await agent(run, install)).status).toBe(403)
  expect((await agent(run, policy)).status).toBe(403)
  expect((await person(policy)).status).toBe(200)
  expect(await (await agent(run, { action: 'list' })).json()).toMatchObject({
    allowAgentInstall: true,
  })
  expect((await agent(run, { ...install, expectedRevision: 0 })).status).toBe(409)
  expect(await (await agent(run, install)).json()).toEqual({
    id: manifest.id,
    revision: 2,
    installed: true,
  })

  const humanDraft = { ...stage, manifest: { ...manifest, id: 'example.human' } }
  expect((await person(humanDraft)).status).toBe(200)
  const humanInstall = { ...install, id: humanDraft.manifest.id, expectedRevision: 3 }
  expect((await agent(run, { ...humanDraft, expectedRevision: 3 })).status).toBe(403)
  expect((await agent(run, humanInstall)).status).toBe(403)
  expect((await person(humanInstall)).status).toBe(200)
  expect((await agent(run, { ...humanDraft, expectedRevision: 4 })).status).toBe(200)
  expect((await agent(run, { ...humanInstall, expectedRevision: 5 })).status).toBe(403)

  expect((await person({ ...install, action: 'disable', expectedRevision: 2 })).status).toBe(200)
  expect((await agent(run, { ...stage, expectedRevision: 6 })).status).toBe(200)
  expect((await agent(run, { ...install, expectedRevision: 7 })).status).toBe(200)
  const list = decode(studioExtensionsListSchema, await (await person({ action: 'list' })).json())
  expect(list.extensions.find((entry) => entry.id === manifest.id)?.enabled).toBe(false)
  expect((await person({ ...policy, enabled: false })).status).toBe(200)
  expect((await agent(run, { ...stage, expectedRevision: 8 })).status).toBe(200)
  expect((await agent(run, { ...install, expectedRevision: 9 })).status).toBe(403)
})

it.skipIf(process.platform === 'win32')(
  'can disable a stalled extension while the draft and terminal remain usable',
  async () => {
    const { manifest, person, post, s, task, runtime } = await setup()
    const terminal = await post('terminals/workspace', {
      repositoryId: 'repo',
      name: 'Existing terminal',
    })
    expect(terminal.status).toBe(200)
    const { id: terminalId } = decode(terminalSchema, await terminal.json())
    let release = () => {}
    const hanging = vi.spyOn(s.mcpApps, 'feedRead').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: 'late', fingerprint: 'fixture' })
        }),
    )
    vi.spyOn(s.mcpApps, 'extensionSourceIdentity').mockReturnValue('fixture')
    cleanups.push(async () => release())
    await person({ action: 'stage', manifest, expectedRevision: 0 })
    const edit = (action: string) => ({ action, id: manifest.id, expectedRevision: 2 })
    await person({ ...edit('install'), expectedRevision: 1 })
    expect(
      (
        await post('studio/source-policy', {
          owner: 'extension',
          id: manifest.id,
          sourceId: 'status',
          expectedRevision: 2,
          policy: { access: 'session', autoLoad: false },
        })
      ).status,
    ).toBe(200)
    const tool = person({ ...edit('call'), contributionId: 'status' })
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledTimes(1))
    const snapshot = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${human}` },
    }).then((response) => response.json())
    const state = decode(snapshotSchema, snapshot)
    expect(state.studioExtensionsSupported).toBe(true)
    expect(state.studioExtensionComponentVersion).toBe(1)
    expect(state.studioExtensionsRevision).toBe(2)
    expect(state.workspace.tasks.find((entry) => entry.id === task.id)?.draft).toBe(
      'Keep this draft',
    )
    expect(state.terminals).toContainEqual(expect.objectContaining({ title: 'Existing terminal' }))
    expect((await post('terminals/summary', { id: terminalId })).status).toBe(200)
    expect((await person(edit('disable'))).status).toBe(200)
    expect((await tool).status).toBe(409)
    release()
  },
)

it('previews and stages pinned marketplace releases with local sources and records installed provenance', async () => {
  const { person, agent, issue, s, task } = await setup()
  const p = (marketplace: object) => person({ action: 'marketplace', marketplace })
  const a = (token: string, marketplace: object) =>
    agent(token, { action: 'marketplace', marketplace })
  const { packages } = decode(
    marketplaceListSchema,
    await (await p({ action: 'list', query: 'service' })).json(),
  )
  expect(packages).toHaveLength(1)
  const selected = packages[0]
  expect(selected.id).toBe('dovo.service-status')
  const { id, digest } = selected
  expect((await p({ action: 'read', id, digest: 'a'.repeat(64) })).status).toBe(404)
  const detail = decode(
    marketplaceDetailSchema,
    await (await p({ action: 'read', id, digest })).json(),
  )
  expect(detail.package.dashboard?.tiles).toEqual([
    { title: 'Service status', contributionId: 'overview' },
  ])
  const stage = { action: 'stage', id, digest, expectedRevision: 0, bindings: [] }
  expect((await p(stage)).status).toBe(400)
  expect((await a(issue(true), stage)).status).toBe(403)
  const run = issue(false)
  expect((await a(run, { action: 'sources', taskId: 'different-thread' })).status).toBe(403)
  const bind = { contributionId: 'status', taskId: task.id, source: 'health' }
  expect((await p({ ...stage, bindings: [bind] })).status).toBe(400)

  const server = decode(mcpServerSchema, {
    name: 'health',
    builtin: false,
    enabled: true,
    transport: 'http',
    url: 'http://127.0.0.1:1/mcp',
  })
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((entry) =>
      entry.id === task.agentId
        ? { ...entry, resources: { mcpServers: [server], hooks: [], skills: [] } }
        : entry,
    ),
  }))
  expect(await (await p({ action: 'sources', taskId: task.id })).json()).toMatchObject({
    servers: ['health'],
  })
  expect(
    (await a(run, { ...stage, bindings: [{ contributionId: 'status', source: 'health' }] })).status,
  ).toBe(200)
  const update = (action: string, expectedRevision: number) => ({
    action,
    id,
    expectedRevision,
    componentVersion: 2,
  })
  const read = await (await agent(run, { action: 'read', id })).json()
  expect(read).toMatchObject({
    draft: {
      contributions: expect.arrayContaining([
        { ...detail.package.manifest.contributions[0], taskId: task.id, server: 'health' },
      ]),
    },
  })
  expect((await agent(run, update('install', 1))).status).toBe(403)
  expect((await person(update('install', 1))).status).toBe(200)
  const installed = async () =>
    decode(marketplaceListSchema, await (await p({ action: 'list', query: id })).json()).packages[0]
      .installed
  expect(await installed()).toEqual({ digest, version: '1.0.0' })
  // Replacing the same installed extension with a reviewed local manifest removes provenance.
  expect(
    (await person({ action: 'stage', manifest: read.draft, expectedRevision: 2 })).status,
  ).toBe(200)
  expect((await person(update('install', 3))).status).toBe(200)
  expect(await installed()).toBeUndefined()
  expect((await p({ ...stage, expectedRevision: 4, bindings: [bind] })).status).toBe(409)
  expect((await person(update('rollback', 4))).status).toBe(200)
  expect(await installed()).toEqual({ digest, version: '1.0.0' })
})

it('loads extension API and CLI sources automatically only after paired consent', async () => {
  const { person, agent, issue, manifest, post } = await setup()
  let apiReads = 0
  const origin = createServer((_request, response) => {
    apiReads++
    response.end('{"series":[1,2,3]}')
  })
  origin.listen(0, '127.0.0.1')
  await once(origin, 'listening')
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        origin.closeAllConnections()
        origin.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const address = origin.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server')
  const sources = [
    {
      id: 'latency',
      kind: 'api',
      title: 'Latency',
      url: `http://127.0.0.1:${address.port}`,
      pointer: '/series',
      chart: 'line',
      refreshSeconds: 30,
    },
    {
      id: 'workers',
      kind: 'cli',
      title: 'Workers',
      repositoryId: 'repo',
      command: process.platform === 'win32' ? "'4'" : "printf '%s' '4'",
      pointer: '',
      chart: 'number',
    },
  ]
  const stage = await person({
    action: 'stage',
    manifest: { ...manifest, contributions: [...manifest.contributions, ...sources] },
    expectedRevision: 0,
  })
  expect(stage.status).toBe(200)
  const install = { action: 'install', id: manifest.id, expectedRevision: 1 }
  expect((await person({ ...install, componentVersion: 2 })).status).toBe(409)
  expect((await person({ ...install, componentVersion: 3 })).status).toBe(200)

  const list = async (componentVersion: number) =>
    decode(
      studioExtensionsListSchema,
      await (await person({ action: 'list', componentVersion })).json(),
    ).extensions[0]?.installed?.contributions.map(({ id }) => id)
  expect(await list(2)).toEqual(['status', 'terminal'])
  expect(await list(3)).toEqual(['status', 'terminal', 'latency', 'workers'])

  let repeatedApi: unknown
  for (const [contributionId, data] of [
    ['latency', [1, 2, 3]],
    ['workers', 4],
  ]) {
    const input = { action: 'read-data', id: manifest.id, expectedRevision: 2, contributionId }
    expect((await agent(issue(false), input)).status).toBe(403)
    expect((await person({ ...input, action: 'call' })).status).toBe(404)
    expect((await person({ ...input, expectedRevision: 1 })).status).toBe(409)
    expect((await person({ ...input, automatic: true })).status).toBe(403)
    const policy = {
      owner: 'extension',
      id: manifest.id,
      sourceId: contributionId,
      expectedRevision: 2,
    }
    expect(
      (
        await post('studio/source-policy', {
          ...policy,
          policy: { access: 'persistent', autoLoad: true },
        })
      ).status,
    ).toBe(200)
    const response = await person({ ...input, automatic: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data, updatedAt: expect.any(Number) })
    if (contributionId === 'latency') {
      const repeated = await person({ ...input, automatic: true })
      repeatedApi = await repeated.json()
    }
    expect(
      (
        await post('studio/source-policy', {
          ...policy,
          policy: { access: 'off', autoLoad: false },
        })
      ).status,
    ).toBe(200)
    expect((await person({ ...input, automatic: true })).status).toBe(403)
  }
  expect(repeatedApi).toMatchObject({ data: [1, 2, 3], refreshAfterMs: expect.any(Number) })
  expect(apiReads).toBe(1)
})

it('pins installed pages for paired clients and removes the shortcut while disabled', async () => {
  const { s, person, agent, issue, manifest, runtime } = await setup()
  const page = {
    id: 'overview',
    kind: 'view',
    title: 'Delivery overview',
    placement: 'page',
    view: { version: 1, root: 'title', nodes: [{ id: 'title', kind: 'text', value: 'Delivery' }] },
  }
  expect(
    (
      await person({
        action: 'stage',
        manifest: { ...manifest, contributions: [...manifest.contributions, page] },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  const install = { action: 'install', id: manifest.id, expectedRevision: 1 }
  expect((await person({ ...install, componentVersion: 2 })).status).toBe(409)
  expect((await person({ ...install, componentVersion: 3 })).status).toBe(200)
  const getPins = async () =>
    decode(
      snapshotSchema,
      await (
        await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
          headers: { Authorization: `Bearer ${human}` },
        })
      ).json(),
    ).studioExtensionPinnedPages
  expect(await getPins()).toEqual([])
  const pin = {
    action: 'pin-page',
    id: manifest.id,
    expectedRevision: 2,
    contributionId: page.id,
    pinned: true,
  }
  expect((await agent(issue(false), pin)).status).toBe(403)
  expect((await person({ ...pin, expectedRevision: 1 })).status).toBe(409)
  expect((await person(pin)).status).toBe(200)
  expect(await getPins()).toEqual([
    { extensionId: manifest.id, pageId: page.id, title: page.title },
  ])
  expect(s.studioExtensions.pinnedPages()).toHaveLength(1)
  const edit = { id: manifest.id, expectedRevision: 2 }
  expect((await person({ ...edit, action: 'disable' })).status).toBe(200)
  expect(await getPins()).toEqual([])
  expect((await person({ ...edit, expectedRevision: 3, action: 'enable' })).status).toBe(200)
  expect(await getPins()).toHaveLength(1)
  expect((await person({ ...pin, expectedRevision: 4, pinned: false })).status).toBe(200)
  expect(await getPins()).toEqual([])
})

it('embeds a saved A2UI card in an extension page with existing app grants', async () => {
  const { s, task, person, post } = await setup()
  const { id: appId } = s.mcpApps.a2uiCommand(task.id, 'extension-author', a2uiCard) as {
    id: string
  }
  const source = { id: 'setup', kind: 'app', title: 'Playback', taskId: task.id, appId } as const
  const view = page({
    id: 'playback',
    title: 'Playback settings',
    root: appView('card', source.id),
  })
  expect(() =>
    defineExtension({ id: 'example.media', name: 'Media', contributions: [view] }),
  ).toThrow(/Unknown MCP App/)
  const manifest = defineExtension({
    id: 'example.media',
    name: 'Media',
    contributions: [source, view],
  })
  const { id } = manifest
  expect((await person({ action: 'stage', expectedRevision: 0, manifest })).status).toBe(200)
  const install = { action: 'install', id, expectedRevision: 1 }
  expect((await person({ ...install, componentVersion: 3 })).status).toBe(409)
  expect((await person({ ...install, componentVersion: 4 })).status).toBe(200)
  const legacy = decode(
    studioExtensionsListSchema,
    await (await person({ action: 'list', componentVersion: 3 })).json(),
  )
  expect(legacy.extensions[0].installed?.contributions).toEqual([source])
  const open = { action: 'open', id, expectedRevision: 2, contributionId: view.id }
  expect((await person({ ...open, componentVersion: 3 })).status).toBe(409)
  expect(await (await person({ ...open, componentVersion: 4 })).json()).toEqual({
    contribution: view,
  })

  const read = (requestId: string) =>
    post('mcp-apps/rpc', {
      requestId,
      id: appId,
      taskId: task.id,
      method: 'tools/call',
      params: { name: 'a2ui_read', arguments: {} },
      extension: { id, contributionId: source.id },
    })
  expect((await read('before-grant')).status).toBe(403)
  const policy = { owner: 'extension', id, sourceId: source.id, expectedRevision: 2 }
  expect(
    (
      await post('studio/source-policy', {
        ...policy,
        policy: { access: 'session', autoLoad: false },
      })
    ).status,
  ).toBe(200)
  expect(await (await read('after-grant')).json()).toMatchObject({
    result: { structuredContent: { revision: 1, messages: a2uiCard.messages } },
  })
  expect(
    (await post('studio/source-policy', { ...policy, policy: { access: 'off', autoLoad: false } }))
      .status,
  ).toBe(200)
  expect((await read('after-revoke')).status).toBe(403)
})
