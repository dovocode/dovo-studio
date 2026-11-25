import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { withCatalogRpc } from '../agents/catalogs/rpc.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  decode,
  mcpOAuthFlowSchema,
  mcpOAuthFlowStateSchema,
  mcpOAuthStatusListSchema,
  mcpServerSchema,
  type McpServer,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { simulatedOAuthProvider } from '../testing/oauth-provider.js'
import { codexMcpServers, claudeMcpServers } from '../agents/configuration/mcp-settings.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
const human = 'paired-oauth-client-token-at-least-32-characters'

async function setup(options: { accessSeconds?: number } = {}) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME'])
    vi.stubEnv(key, join(f.directory, key))
  const provider = await simulatedOAuthProvider(options)
  cleanups.push(provider.close)
  const databasePath = join(f.directory, 'state.sqlite')
  const runtime = await startRuntime({
    databasePath,
    ownerToken: 'oauth-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.devices.add('Paired phone', human)
  const server: McpServer = decode(mcpServerSchema, {
    name: 'tracker',
    transport: 'http',
    enabled: true,
    url: provider.url,
    oauth: {},
  })
  f.workspace.agents[0].resources = { mcpServers: [server], skills: [], hooks: [] }
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'OAuth task',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Read tracker',
  })
  const post = (command: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/mcp/oauth`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${human}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(command),
    })
  const command = async (body: unknown) => {
    const response = await post(body)
    const value: unknown = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(value))
    return value
  }
  const target = { name: server.name, url: server.url }
  /** The stdio command each harness launches for this server in a normal thread. */
  const proxy = s.mcpApps.proxies(task.id, [server], f.directory, 'ask', {
    port: runtime.port,
    host: '127.0.0.1',
  })[0]
  const harnessClient = async () => {
    const transport = new StdioClientTransport({
      command: proxy.command,
      args: proxy.args,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
        ...proxy.envValues,
      },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', () => {})
    const client = new Client({ name: 'harness-fixture', version: '1' })
    cleanups.push(() => client.close())
    await client.connect(transport)
    return client
  }
  return {
    runtime,
    s,
    f,
    provider,
    server,
    task,
    post,
    command,
    target,
    proxy,
    harnessClient,
    databasePath,
  }
}

const whoami = async (client: Client) => {
  const result = await client.callTool({ name: 'whoami', arguments: {} })
  return result.isError
    ? `error: ${JSON.stringify(result.content)}`
    : JSON.stringify(result.content)
}

it('signs in through the paired client endpoint and authorizes harness MCP calls with refresh and revoke', async () => {
  const t = await setup({ accessSeconds: 60 })
  const status = async () =>
    decode(mcpOAuthStatusListSchema, await t.command({ action: 'status', servers: [t.target] }))
      .statuses[0]
  expect(await status()).toMatchObject({ state: 'disconnected', refreshable: false })

  // Agent credentials cannot start a consent flow.
  const blocked = await t.post(
    { action: 'connect', server: t.target },
    { 'x-dovo-agent-access': '1' },
  )
  expect(blocked.status).toBe(403)

  // Without a sign-in, the harness sees a clear error and the provider sees no token.
  const before = await t.harnessClient()
  await expect(whoami(before)).rejects.toThrow('Sign in to the MCP server tracker again')
  expect(t.provider.bearerSeen).toEqual([])

  const flow = decode(mcpOAuthFlowSchema, await t.command({ action: 'connect', server: t.target }))
  expect(flow.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  const authorization = new URL(flow.authorizationUrl)
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorization.searchParams.get('resource')).toBe(t.provider.url)
  // The person approves; the browser on this computer follows the redirect to the loopback page.
  const callback = await t.provider.consent(flow.authorizationUrl)
  const page = await fetch(callback)
  expect(await page.text()).toContain('Signed in')
  expect(
    decode(mcpOAuthFlowStateSchema, await t.command({ action: 'flow', flowId: flow.flowId })),
  ).toEqual({ flowId: flow.flowId, state: 'connected' })
  expect(await status()).toMatchObject({
    state: 'connected',
    refreshable: true,
    scope: 'mcp:tools',
  })

  const client = await t.harnessClient()
  expect(await whoami(client)).toContain('user-of-client-1')
  const firstToken = t.provider.bearerSeen.at(-1)!
  expect(firstToken).toBeTruthy()

  // Tokens never enter the harness launch config, snapshots, settings or activity.
  const harnessConfig = JSON.stringify([
    t.proxy,
    codexMcpServers([t.proxy]),
    claudeMcpServers([t.proxy]),
  ])
  const snapshot = await (
    await fetch(`http://127.0.0.1:${t.runtime.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${human}` },
    })
  ).text()
  const activity = JSON.stringify(t.s.activity.list('', 'task-activity', 0, t.task.id))
  for (const text of [harnessConfig, snapshot, JSON.stringify(t.s.store.get()), activity])
    expect(text).not.toContain(firstToken)

  // The access token expires at the provider. The bridge refreshes it and retries the call.
  const later = Date.now() + 120_000
  t.provider.setClock(() => later)
  expect(await whoami(client)).toContain('user-of-client-1')
  expect(t.provider.events).toContain('refresh')
  expect(t.provider.bearerSeen.at(-1)).not.toBe(firstToken)

  // A different sign-in replaces the upstream session for the already-open harness.
  const reconnect = decode(
    mcpOAuthFlowSchema,
    await t.command({ action: 'connect', server: t.target }),
  )
  await fetch(await t.provider.consent(reconnect.authorizationUrl))
  expect(await whoami(client)).toContain('user-of-client-2')

  // The connection survives a runtime restart on the same computer.
  await t.runtime.close()
  const reopened = await startRuntime({
    databasePath: t.databasePath,
    ownerToken: 'oauth-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(reopened.close)
  expect(reopened.services.mcpApps.oauth.status([t.target])[0]).toMatchObject({
    state: 'connected',
  })
  const response = await fetch(`http://127.0.0.1:${reopened.port}/api/agents/mcp/oauth`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${human}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'disconnect', server: t.target }),
  })
  expect(await response.json()).toEqual({ revoked: true })
  expect(t.provider.events).toEqual(
    expect.arrayContaining(['revoke:refresh_token', 'revoke:access_token']),
  )
  expect(reopened.services.mcpApps.oauth.status([t.target])[0]).toMatchObject({
    state: 'disconnected',
  })
  expect(
    reopened.services.db.prepare('SELECT count(*) FROM mcp_oauth_credentials').pluck().get(),
  ).toBe(0)
})

it('accepts a pasted callback from another device and rejects foreign or denied sign-ins', async () => {
  const t = await setup()
  const first = decode(mcpOAuthFlowSchema, await t.command({ action: 'connect', server: t.target }))
  // Selecting Connect again replaces the earlier pending sign-in.
  const flow = decode(mcpOAuthFlowSchema, await t.command({ action: 'connect', server: t.target }))
  expect(await t.command({ action: 'flow', flowId: first.flowId })).toMatchObject({
    state: 'cancelled',
  })
  const callback = await t.provider.consent(flow.authorizationUrl)

  const foreign = new URL(callback)
  foreign.searchParams.set('state', 'another-sign-in')
  const rejected = await t.post({
    action: 'complete',
    flowId: flow.flowId,
    callbackUrl: foreign.href,
  })
  expect(rejected.status).toBe(400)
  expect(await rejected.text()).toContain('different sign-in')
  const otherHost = new URL(callback)
  otherHost.hostname = 'example.com'
  expect(
    (await t.post({ action: 'complete', flowId: flow.flowId, callbackUrl: otherHost.href })).status,
  ).toBe(400)

  // A phone cannot open the computer's loopback address, so the person pastes it instead.
  expect(
    await t.command({ action: 'complete', flowId: flow.flowId, callbackUrl: callback }),
  ).toEqual({ flowId: flow.flowId, state: 'connected' })
  // Pasting the same address again does not exchange the code twice.
  expect(
    await t.command({ action: 'complete', flowId: flow.flowId, callbackUrl: callback }),
  ).toEqual({ flowId: flow.flowId, state: 'connected' })
  expect(t.provider.events.filter((event) => event === 'token')).toHaveLength(1)

  // Test connection on the editor uses the same sign-in.
  const tested = await fetch(`http://127.0.0.1:${t.runtime.port}/api/agents/mcp/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${human}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(t.server),
  })
  expect(await tested.json()).toMatchObject({ server: 'oauth-fixture', tools: ['whoami'] })

  await t.command({ action: 'disconnect', server: t.target })
  t.provider.denyConsent(true)
  const denied = decode(
    mcpOAuthFlowSchema,
    await t.command({ action: 'connect', server: t.target }),
  )
  const denial = await t.provider.consent(denied.authorizationUrl)
  expect(
    await t.command({ action: 'complete', flowId: denied.flowId, callbackUrl: denial }),
  ).toEqual({
    flowId: denied.flowId,
    state: 'failed',
    error: 'The provider returned access_denied',
  })
  expect(t.s.mcpApps.oauth.status([t.target])[0]?.state).toBe('disconnected')
})

it('disconnect stays disconnected when an in-flight consent exchange completes late', async () => {
  const t = await setup()
  let exchanging!: () => void
  let release!: () => void
  const exchange = new Promise<void>((resolve) => {
    exchanging = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  t.provider.beforeExchange(() => {
    exchanging()
    return held
  })
  const flow = decode(mcpOAuthFlowSchema, await t.command({ action: 'connect', server: t.target }))
  const complete = t.command({
    action: 'complete',
    flowId: flow.flowId,
    callbackUrl: await t.provider.consent(flow.authorizationUrl),
  })
  try {
    await exchange
    expect(await t.command({ action: 'disconnect', server: t.target })).toEqual({ revoked: false })
  } finally {
    release()
  }
  expect(await complete).toEqual({ flowId: flow.flowId, state: 'cancelled' })
  expect(t.s.mcpApps.oauth.status([t.target])[0]?.state).toBe('disconnected')
})

it('keeps stdio and manual header servers unchanged and rejects OAuth with conflicting credentials', () => {
  expect(() =>
    decode(mcpServerSchema, {
      name: 'local',
      transport: 'stdio',
      enabled: true,
      command: 'node',
      oauth: {},
    }),
  ).toThrow('OAuth sign-in requires a remote HTTP server')
  expect(() =>
    decode(mcpServerSchema, {
      name: 'remote',
      transport: 'http',
      enabled: true,
      url: 'https://example.com/mcp',
      bearerTokenEnv: 'TOKEN',
      oauth: {},
    }),
  ).toThrow('Remove the bearer token')
  const manual = decode(mcpServerSchema, {
    name: 'remote',
    transport: 'http',
    enabled: true,
    url: 'http://192.168.1.20:8080/mcp',
    headerValues: { 'X-Api-Key': 'value' },
  })
  expect(manual.oauth).toBeUndefined()
  expect(claudeMcpServers([manual]).remote).toEqual({
    type: 'http',
    url: 'http://192.168.1.20:8080/mcp',
    headers: { 'X-Api-Key': 'value' },
  })
})

const codexAvailable = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0
it.skipIf(!codexAvailable)(
  'lets a real Codex app-server call the signed-in server through the Dovo bridge',
  async () => {
    const t = await setup()
    const flow = decode(
      mcpOAuthFlowSchema,
      await t.command({ action: 'connect', server: t.target }),
    )
    await fetch(await t.provider.consent(flow.authorizationUrl))
    // An empty CODEX_HOME: no login, no user config, no model turn.
    const home = join(t.f.directory, 'codex-home')
    mkdirSync(home)
    const text = await withCatalogRpc(
      'codex',
      ['app-server', '--listen', 'stdio://'],
      async (rpc) => {
        await rpc.sendRequest('initialize', {
          clientInfo: { name: 'dovo_studio', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        })
        await rpc.sendNotification('initialized', {})
        const started = (await rpc.sendRequest('thread/start', {
          cwd: t.f.directory,
          config: { mcp_servers: codexMcpServers([t.proxy]) },
        })) as { thread: { id: string } }
        const result = await rpc.sendRequest('mcpServer/tool/call', {
          threadId: started.thread.id,
          server: 'tracker',
          tool: 'whoami',
          arguments: {},
        })
        return JSON.stringify(result)
      },
      { CODEX_HOME: home },
    )
    expect(text).toContain('user-of-client-1')
    expect(t.provider.bearerSeen.length).toBeGreaterThan(0)
  },
)
