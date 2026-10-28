import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer, type Server as HttpServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  AccountClient,
  artifactPublicationInput,
  decode,
  mcpServerSchema,
  artifactFeedPreviewResultSchema,
  type ArtifactFeedCredential,
  type ArtifactFeedQuery,
} from '@dovo/protocol'
import { AccountStore } from '../../../../apps/connect-server/src/store.js'
import { createConnectServer } from '../../../../apps/connect-server/src/server.js'
import { ArtifactStore } from '../../../../apps/artifact-server/src/store.js'
import { createArtifactServer } from '../../../../apps/artifact-server/src/server.js'
import { startRuntime } from '../index.js'
import { fixture as workspaceFixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const cleanup: Array<() => unknown> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
async function listen(server: HttpServer) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Missing port')
  return 'http://127.0.0.1:' + addr.port
}
async function setup() {
  const f = await workspaceFixture()
  cleanup.push(f.cleanup)
  const accounts = new AccountStore(':memory:'),
    hosted = new ArtifactStore(':memory:')
  cleanup.push(
    () => accounts.db.close(),
    () => hosted.db.close(),
  )
  let broker: HttpServer, host: HttpServer
  const connectOrigin = await listen(createServer((req, res) => broker.emit('request', req, res)))
  const origin = await listen(createServer((req, res) => host.emit('request', req, res)))
  const serviceKey = randomBytes(32).toString('base64url')
  broker = createConnectServer({
    store: accounts,
    origin: connectOrigin,
    sharingRecoverySecret: randomBytes(32),
    artifacts: { origin, key: serviceKey },
    authorizationOrigin: 'https://sso.test',
    authorize: async () => 'https://sso.test',
    exchange: async () => ({ id: 'owner', name: 'Owner' }),
  })
  host = createArtifactServer({
    store: hosted,
    origin,
    connectOrigin,
    serviceKey,
    viewerScript: '',
  }).server
  vi.stubEnv('DOVO_CONNECT_ORIGIN', connectOrigin)
  const login = accounts.createLogin()
  accounts.approve(login.login, { id: 'owner', name: 'Owner' })
  let sharingKey: string | null = null
  const client = new AccountClient(
    {
      read: async () => login.token,
      write: async () => {},
      readSharingKey: async () => sharingKey,
      writeSharingKey: async (key) => {
        sharingKey = key
      },
    },
    async () => {},
    connectOrigin,
  )
  await client.load()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'artifact-feed-owner-token-at-least-32-characters',
  })
  cleanup.push(() => runtime.close())
  runtime.services.preferences.save({ enableArtifacts: true })
  const parameters: unknown[] = []
  let readOnly = true,
    toolVersion = '1',
    afterRead: (() => void | Promise<void>) | undefined
  const upstream = new Server(
    { name: 'feed-fixture', version: '1' },
    { capabilities: { tools: {} } },
  )
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'report',
        description: toolVersion,
        inputSchema: {
          type: 'object',
          properties: { team: { type: 'string' } },
          required: ['team'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: readOnly },
      },
      {
        name: 'delete',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, destructiveHint: true },
      },
      { name: 'unknown', inputSchema: { type: 'object' } },
    ],
  }))
  upstream.setRequestHandler(CallToolRequestSchema, async (request) => {
    parameters.push(request.params)
    await afterRead?.()
    return {
      content: [],
      structuredContent: { summary: { count: parameters.length }, secret: 'must-never-upload' },
      _meta: { secret: 'private-meta' },
    }
  })
  await upstream.connect(transport)
  const mcpOrigin = await listen(
    createServer((req, res) => {
      void transport.handleRequest(req, res)
    }),
  )
  cleanup.push(() => upstream.close())
  const server = decode(mcpServerSchema, {
    name: 'fixture',
    transport: 'http',
    enabled: true,
    url: mcpOrigin,
  })
  f.workspace.agents[0]!.resources = { mcpServers: [server], skills: [], hooks: [] }
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Dashboard',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Report',
  })
  const metadata = await runtime.services.artifacts.write(
    { taskId: task.id, title: 'Report', format: 'html', content: '<p>Report</p>' },
    false,
  )
  const artifact = runtime.services.artifacts.read(task.id, metadata.id, metadata.revision)
  const ref = { taskId: task.id, id: artifact.id, revision: artifact.revision }
  const query: ArtifactFeedQuery = {
    server: 'fixture',
    tool: 'report',
    arguments: { team: 'approved' },
    pointer: '/summary',
    seconds: 60,
  }
  const device = runtime.services.devices.add('Publisher', 'publisher-device-token')
  const post = (
    action: string,
    body: unknown,
    token = 'publisher-device-token',
    headers?: Record<string, string>,
  ) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/feed/${action}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const publication = await client.publishArtifact(artifact, origin)
  const feeds = runtime.services.artifactFeeds
  const preview = () => feeds.preview(ref, query, device)
  let credential: ArtifactFeedCredential | undefined
  const enable = async () => {
    const plan = await preview()
    await client.enableArtifactFeed(
      publication.publicationId,
      origin,
      query.seconds,
      plan.data,
      async (value) => {
        credential = value
        await feeds.enable(plan.previewId, value, device)
      },
    )
  }
  const refresh = async () => {
    runtime.services.db.prepare('UPDATE artifact_feeds SET next=0').run()
    feeds.tick()
    await vi.waitFor(() =>
      expect(
        runtime.services.db.prepare('SELECT next FROM artifact_feeds').get(),
      ).not.toMatchObject({ next: 0 }),
    )
  }
  return {
    runtime,
    artifact,
    accounts,
    hosted,
    client,
    login,
    feeds,
    ref,
    query,
    device,
    post,
    preview,
    enable,
    refresh,
    parameters,
    publicationId: publication.publicationId,
    origin,
    credential: () => credential!,
    changeTool: () => {
      toolVersion = '2'
    },
    writable: () => {
      readOnly = false
    },
    afterRead: (fn: () => void | Promise<void>) => {
      afterRead = fn
    },
  }
}

it('requires human consent, previews only selected fields, then refreshes fixed approved arguments without overlapping reads', async () => {
  const s = await setup()
  const tools = await s.feeds.tools(s.ref, s.device)
  expect(tools.tools.map((tool) => tool.tool)).toEqual(['report'])
  expect((await s.post('preview', { ...s.ref, query: s.query })).status).toBe(400)
  expect(
    (await s.post('tools', s.ref, 'publisher-device-token', { 'x-dovo-agent-access': '1' })).status,
  ).toBe(403)
  expect(s.parameters).toHaveLength(0)
  const response = await s.post('preview', { ...s.ref, query: s.query, consent: true })
  const preview = decode(artifactFeedPreviewResultSchema, await response.json())
  expect(preview.data).toEqual({ count: 1 })
  expect(s.hosted.feedData(s.publicationId).data).toBeNull()
  await s.enable()
  expect(s.parameters).toHaveLength(2)
  expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 2 })
  let release!: () => void
  s.afterRead(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  s.runtime.services.db.prepare('UPDATE artifact_feeds SET next=0').run()
  s.feeds.tick()
  s.feeds.tick()
  await vi.waitFor(() => expect(s.parameters).toHaveLength(3))
  s.feeds.tick()
  expect(s.parameters).toHaveLength(3)
  release()
  await vi.waitFor(() => expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 3 }))
  expect(s.parameters).toEqual(
    Array.from({ length: 3 }, () => ({ name: 'report', arguments: { team: 'approved' } })),
  )
  expect(JSON.stringify(s.hosted.feedData(s.publicationId))).not.toContain('secret')
  expect(s.feeds.stop(s.ref, s.publicationId, s.device).enabled).toBe(false)
})
it('validates arguments and read-only declarations before calling upstream tools', async () => {
  const s = await setup()
  await expect(s.feeds.preview(s.ref, { ...s.query, arguments: {} }, s.device)).rejects.toThrow(
    'input schema',
  )
  await expect(s.feeds.preview(s.ref, { ...s.query, tool: 'delete' }, s.device)).rejects.toThrow(
    'read-only',
  )
  s.writable()
  await expect(s.preview()).rejects.toThrow('read-only')
  expect(s.parameters).toHaveLength(0)
})
it('rejects a writer from another Connect origin before sending its grant anywhere', async () => {
  const s = await setup()
  await s.enable()
  const plan = await s.preview()
  const requests = vi.spyOn(globalThis, 'fetch')
  try {
    await expect(
      s.feeds.enable(
        plan.previewId,
        { ...s.credential(), connectOrigin: 'https://other-connect.test' },
        s.device,
      ),
    ).rejects.toThrow('different Connect URL')
    expect(requests).not.toHaveBeenCalled()
  } finally {
    requests.mockRestore()
  }
})
it.each([
  'device',
  'account',
  'tool',
  'thread',
  'disabled',
  'deleted',
  'readonly',
  'broker',
] as const)(
  'stops background reads after %s revocation while retaining cached selected data',
  async (kind) => {
    const s = await setup()
    await s.enable()
    if (kind === 'broker')
      s.runtime.services.db
        .prepare('UPDATE account_service_settings SET origin=?')
        .run('https://other-connect.test')
    if (kind === 'deleted')
      s.runtime.services.artifacts.delete(s.ref.taskId, s.ref.id, s.ref.revision)
    if (kind === 'readonly')
      s.runtime.services.store.update((workspace) => ({
        ...workspace,
        agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
      }))
    if (kind === 'device') s.runtime.services.devices.revoke(s.device)
    if (kind === 'account') s.accounts.revoke(s.login.token)
    if (kind === 'tool') s.changeTool()
    if (kind === 'thread')
      s.runtime.services.store.updateTask(s.ref.taskId, (task) => ({ ...task, archived: true }))
    if (kind === 'disabled') s.runtime.services.preferences.save({ enableArtifacts: false })
    await s.refresh()
    expect(s.parameters).toHaveLength(1)
    expect(s.runtime.services.db.prepare('SELECT config FROM artifact_feeds').get()).toMatchObject({
      config: null,
    })
    expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 1 })
  },
)
it('rejects a changed server destination before connecting to it', async () => {
  const s = await setup()
  await s.enable()
  let connections = 0
  const destination = await listen(
    createServer((req, res) => {
      connections++
      res.end()
    }),
  )
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({
      ...agent,
      resources: {
        skills: [],
        hooks: [],
        mcpServers: [
          decode(mcpServerSchema, {
            name: 'fixture',
            enabled: true,
            transport: 'http',
            url: destination,
          }),
        ],
      },
    })),
  }))
  await s.refresh()
  expect(connections).toBe(0)
  expect(s.parameters).toHaveLength(1)
})
it('rejects forged host credentials and device-switched previews before sending data', async () => {
  const s = await setup(),
    preview = await s.preview()
  const writer = s.accounts.artifactGrant(s.login.token, s.origin, s.publicationId)!
  const credential = { ...writer, publicationId: s.publicationId, generation: randomUUID() }
  await expect(s.feeds.enable(preview.previewId, credential, 'owner')).rejects.toThrow(
    'another device',
  )
  let connections = 0
  const destination = await listen(
    createServer((req, res) => {
      connections++
      res.end()
    }),
  )
  await expect(
    s.feeds.enable(preview.previewId, { ...credential, origin: destination }, s.device),
  ).rejects.toThrow('destination')
  expect(connections).toBe(0)
})
it('rechecks device consent after an in-flight MCP read and never uploads the revoked result', async () => {
  const s = await setup()
  await s.enable()
  s.afterRead(() => {
    s.runtime.services.devices.revoke(s.device)
  })
  await s.refresh()
  expect(s.parameters).toHaveLength(2)
  expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 1 })
  expect(s.runtime.services.db.prepare('SELECT config FROM artifact_feeds').get()).toMatchObject({
    config: null,
  })
})

it('retains cached data on transient read failures, hides upstream errors and recovers at the approved interval', async () => {
  const s = await setup()
  await s.enable()
  s.afterRead(() => {
    throw new Error('sensitive upstream detail')
  })
  await s.refresh()
  expect(s.feeds.status(s.ref, s.publicationId, s.device)).toMatchObject({
    enabled: true,
    error: 'Refresh failed; the last successful value is kept',
  })
  expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 1 })
  s.afterRead(() => {})
  await s.refresh()
  expect(s.feeds.status(s.ref, s.publicationId, s.device)).toMatchObject({
    enabled: true,
    error: '',
  })
  expect(s.hosted.feedData(s.publicationId).data).toEqual({ count: 3 })
})

it.each(['artifact', 'interval'] as const)(
  'rejects a hosted lease whose %s differs from the approved preview',
  async (mismatch) => {
    const s = await setup(),
      plan = await s.preview()
    const publication =
      mismatch === 'interval'
        ? { id: s.publicationId }
        : s.hosted.publish('owner', {
            sourceId: randomUUID(),
            revision: s.ref.revision,
            title: 'Other',
            format: 'html',
            content: '<p>Other</p>',
          })
    const writer = s.accounts.artifactGrant(s.login.token, s.origin, publication.id)!
    const { generation } = s.hosted.feedSetup(
      publication.id,
      'owner',
      writer.token,
      writer.expiresAt,
      mismatch === 'interval' ? 300 : 60,
      plan.data,
    )
    await expect(
      s.feeds.enable(
        plan.previewId,
        { ...writer, publicationId: publication.id, generation },
        s.device,
      ),
    ).rejects.toThrow('no longer matches')
    expect(s.feeds.status(s.ref, publication.id, s.device).enabled).toBe(false)
    expect(s.parameters).toHaveLength(1)
  },
)
it('bounds in-flight preview reads as well as saved previews', async () => {
  const s = await setup()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  s.afterRead(() => gate)
  const pending = Array.from({ length: 32 }, () => s.preview())
  await vi.waitFor(() => expect(s.parameters).toHaveLength(32))
  await expect(s.preview()).rejects.toThrow('Too many pending feed previews')
  release()
  expect(await Promise.all(pending)).toHaveLength(32)
})

it('encrypts approved live artifact data and stops MCP reads when its hosted writer is revoked', async () => {
  const s = await setup()
  await s.client.sharing.recoveryKey(true)
  const shared = await s.client.sharing.publish(s.origin, s.artifact.id, {
    kind: 'artifact',
    artifact: artifactPublicationInput(s.artifact),
  })
  const result = await s.client.sharing.setPaused(s.origin, shared, false)
  if (!result.writer) throw new Error('Missing test writer')
  const plan = await s.preview()
  expect(plan.data).toEqual({ count: 1 })
  const writer = s.runtime.services.sharedThreads
  await writer.enableFeed(
    plan.previewId,
    {
      taskId: s.ref.taskId,
      id: shared.record.id,
      origin: s.origin,
      writerSecret: result.writer,
      contentKey: result.share.vault.contentKey,
      signingSeed: result.share.vault.signingSeed,
      generation: result.share.record.packet.generation,
    },
    s.device,
  )
  await vi.waitFor(async () => {
    const opened = await s.client.sharing.refresh(s.origin, shared.record.id)
    expect(opened.content).toMatchObject({ kind: 'artifact', feed: { data: { count: 2 } } })
  })
  const raw = JSON.stringify(s.hosted.db.prepare('SELECT * FROM encrypted_shares').all())
  for (const secret of [
    'must-never-upload',
    'private-meta',
    '<p>Report</p>',
    result.share.vault.contentKey,
    result.writer,
  ])
    expect(raw).not.toContain(secret)
  expect(s.parameters).toEqual(
    Array.from({ length: 2 }, () => ({ name: 'report', arguments: { team: 'approved' } })),
  )
  await s.client.sharing.setPaused(s.origin, result.share, true)
  s.runtime.services.db.prepare('UPDATE shared_thread_writers SET fingerprint=?').run('0')
  await writer.tick()
  expect(s.parameters).toHaveLength(2)
  expect(writer.status(s.ref.taskId, shared.record.id)).toMatchObject({
    enabled: false,
    error: expect.stringMatching(/paused|revoked/),
  })
})
