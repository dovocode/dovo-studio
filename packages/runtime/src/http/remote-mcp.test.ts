import { createServer, type Server as HttpServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AccountStore } from '../../../../apps/connect-server/src/store.js'
import { createConnectServer } from '../../../../apps/connect-server/src/server.js'
import { fixture } from '../testing/fixture.js'
import { startRuntime } from '../index.js'
import { remoteMcpTool } from '../studio/remote-mcp.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { McpEventsClient } from '../mcp-events/client.js'
import {
  agentPresetSchema,
  decode,
  mcpServerSchema,
  questionPromptSchema,
  remoteMcpEventsVersion,
  resourceSettingsSchema,
} from '@dovo/protocol'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('links an OAuth app to Connect, starts one agent on retry, polls events, and revokes access', async () => {
  const workspace = await fixture()
  cleanup.push(workspace.cleanup)
  const accounts = new AccountStore(':memory:')
  cleanup.push(() => accounts.db.close())
  let connect: HttpServer
  let replies = 0
  const front = createServer((req, res) => {
    if (req.url === '/v1/internet/host/mcp/reply') replies++
    connect.emit('request', req, res)
  })
  front.listen(0, '127.0.0.1')
  await once(front, 'listening')
  const address = front.address()
  if (!address || typeof address === 'string') throw new Error('No broker port')
  const origin = 'http://127.0.0.1:' + address.port
  connect = createConnectServer({
    store: accounts,
    origin,
    remoteMcp: true,
    authorizationOrigin: 'https://identity.example',
    authorize: async (login) => {
      login.state = 'identity-state'
      return 'https://identity.example/authorize'
    },
    exchange: async () => ({ id: 'owner', name: 'Owner' }),
  })
  cleanup.push(() => {
    connect.close()
    front.closeAllConnections()
    return new Promise<void>((resolve, reject) =>
      front.close((error) => (error ? reject(error) : resolve())),
    )
  })
  vi.stubEnv('DOVO_CONNECT_ORIGIN', origin)
  vi.stubEnv('DOVO_REMOTE_MCP', undefined)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'remote-mcp-local-test-owner-token',
  })
  cleanup.push(runtime.close)
  const { services: s } = runtime
  s.store.update(() => workspace.workspace)
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: {
        shared: [],
        environment: {
          agents: [
            decode(agentPresetSchema, {
              ...workspace.workspace.agents[0],
              id: 'studio-profile',
              name: 'Studio profile',
            }),
          ],
          resources: decode(resourceSettingsSchema, {
            skills: [
              {
                name: 'review',
                enabled: true,
                description: 'Review changes',
                content: 'Check the diff.',
              },
            ],
          }),
        },
      },
    },
    false,
  )
  s.preferences.save({ enableStudioThreads: true, enableStudioAutomations: true })
  const ran = vi.fn<AgentAdapter['run']>(async (run) => {
    run.onText('Remote MCP answer')
    if (run.prompt.includes('One follow-up'))
      await run.ask(
        decode(questionPromptSchema, {
          title: 'Private question title',
          questions: [
            {
              id: 'choice',
              header: 'Choice',
              question: 'Private question text',
              custom: true,
              options: [],
            },
          ],
        }),
      )
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run: ran })
  const account = accounts.createLogin()
  accounts.approve(account.login, { id: 'owner', name: 'Owner' })
  const runtimeId = s.runtimeId
  await s.peers.internet.enable(account.token, runtimeId, 'Fixture computer')
  const paired = 'separately-paired-remote-mcp-test-token'
  s.devices.add('Paired phone', paired)
  const configure = (enabled: boolean) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/runtime/internet/remote-mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + paired, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, consent: true }),
    })
  const enabled = await configure(true)
  expect(enabled.status).toBe(200)
  expect(await enabled.json()).toMatchObject({
    enabled: true,
    remoteMcp: {
      enabled: true,
      serverUrl: origin + '/mcp/' + runtimeId,
      managementUrl: origin + '/mcp/manage',
    },
  })

  const request = (path: string, options?: RequestInit) =>
    fetch(new URL(path, origin), { redirect: 'manual', ...options })
  const browser = (path: string, cookie?: string, body?: URLSearchParams) =>
    request(path, {
      ...(body ? { method: 'POST', body } : {}),
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    })
  const authorizeBrowser = async (path: string) => {
    const begin = await request(path)
    expect(begin.status).toBe(303)
    const signIn = await browser(begin.headers.get('location')!)
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0]
    expect((await browser('/auth/authorize', cookie, new URLSearchParams())).status).toBe(303)
    const complete = await browser('/auth/callback?state=identity-state&code=valid', cookie)
    return { cookie, complete }
  }

  const endpoint = '/mcp/' + runtimeId
  const resource = origin + endpoint
  const management = await authorizeBrowser('/mcp/manage')
  expect(management.complete.status).toBe(303)
  await vi.waitFor(
    async () =>
      expect(await (await browser('/mcp/manage', management.cookie)).text()).toContain(resource),
    { timeout: 5000 },
  )
  const issuer = '/mcp-oauth/' + runtimeId
  const unauthenticated = await request(endpoint)
  expect(unauthenticated.status).toBe(401)
  expect(unauthenticated.headers.get('www-authenticate')).toContain('oauth-protected-resource')
  expect(
    await (await request('/.well-known/oauth-protected-resource' + endpoint)).json(),
  ).toMatchObject({
    resource,
    authorization_servers: [origin + issuer],
  })
  expect(
    await (await request('/.well-known/oauth-authorization-server' + issuer)).json(),
  ).toMatchObject({
    issuer: origin + issuer,
    code_challenge_methods_supported: ['S256'],
  })
  const callback = 'https://assistant.example/dovo/callback'
  const registration = await request(issuer + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Fixture AI',
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
    }),
  })
  expect(registration.status).toBe(201)
  const { client_id } = await registration.json()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({
    client_id,
    redirect_uri: callback,
    resource,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'external-client-state',
  })
  const { cookie, complete } = await authorizeBrowser(issuer + '/authorize?' + params.toString())
  expect(complete.status).toBe(200)
  expect(complete.headers.get('content-security-policy')).toContain(
    "form-action 'self' https://assistant.example;",
  )
  expect(await complete.text()).toContain('Fixture computer')
  const consent = await browser('/mcp/approve', cookie, new URLSearchParams({ access: 'run' }))
  expect(consent.status).toBe(303)
  const returned = new URL(consent.headers.get('location')!)
  expect(returned.searchParams.get('state')).toBe('external-client-state')
  const code = returned.searchParams.get('code')!
  const exchange = (code_verifier: string) =>
    request(issuer + '/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id,
        code,
        code_verifier,
        redirect_uri: callback,
        resource,
      }),
    })
  expect((await exchange('x'.repeat(43))).status).toBe(400)
  const token = await (await exchange(verifier)).json()
  expect(token).toMatchObject({ token_type: 'Bearer', scope: 'dovo:studio' })
  expect((await exchange(verifier)).status).toBe(400)
  expect(
    (
      await request('/mcp/different-computer', {
        headers: { Authorization: 'Bearer ' + token.access_token },
      })
    ).status,
  ).toBe(401)

  const client = new Client({ name: 'fixture-assistant', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } },
  })
  cleanup.push(() => client.close())
  await client.connect(transport)
  const { tools } = await client.listTools()
  expect(tools.map(({ name }) => name)).toEqual([
    'dovo_discover',
    'dovo_threads',
    'dovo_automations',
  ])
  const readSignIn = await authorizeBrowser(issuer + '/authorize?' + params.toString())
  const readConsent = await browser(
    '/mcp/approve',
    readSignIn.cookie,
    new URLSearchParams({ access: 'read' }),
  )
  const readCode = new URL(readConsent.headers.get('location')!).searchParams.get('code')!
  const readToken = await (
    await request(issuer + '/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id,
        code: readCode,
        code_verifier: verifier,
        redirect_uri: callback,
        resource,
      }),
    })
  ).json()
  const readClient = new Client({ name: 'read-only-assistant', version: '1' })
  cleanup.push(() => readClient.close())
  await readClient.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: 'Bearer ' + readToken.access_token } },
    }),
  )
  const readTools = (await readClient.listTools()).tools
  expect(readTools.map(({ name }) => name)).toEqual(tools.map(({ name }) => name))
  expect(JSON.stringify(readTools)).not.toMatch(/"(create|send|stop|resume|run|cancel)"/)
  expect(readTools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true)
  const nativeList = await request(resource, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + readToken.access_token,
      'Content-Type': 'application/json',
      'Mcp-Protocol-Version': remoteMcpEventsVersion,
      'Mcp-Method': 'tools/list',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': remoteMcpEventsVersion } },
    }),
  })
  expect(await nativeList.json()).toMatchObject({ result: { tools: readTools } })
  const threadGuidance = tools.find(({ name }) => name === 'dovo_threads')?.description
  expect(JSON.stringify(tools.find(({ name }) => name === 'dovo_threads')?.inputSchema)).toContain(
    '"create"',
  )
  expect(threadGuidance).toContain(
    'Use only skills enabled in Dovo Studio for the target agent and project',
  )
  expect(threadGuidance).toContain('Omit skill names and paths from the calling app')
  expect(threadGuidance).toContain('explicitly requires a skill')
  const eventsClient = (accessToken: string) =>
    new McpEventsClient(
      decode(mcpServerSchema, {
        name: 'dovo-connect',
        enabled: true,
        transport: 'http',
        headerValues: { Authorization: 'Bearer ' + accessToken },
        url: resource,
      }),
    )
  const eventSource = eventsClient(token.access_token)
  const signal = () => AbortSignal.timeout(8000)
  const catalog = await eventSource.list(signal())
  expect(catalog?.map(({ name, delivery }) => ({ name, delivery }))).toEqual([
    { name: 'thread.turn_finished', delivery: ['poll'] },
    { name: 'thread.needs_input', delivery: ['poll'] },
  ])
  const [turnFinished, needsInput] = catalog ?? []
  if (!turnFinished || !needsInput) throw new Error('Connect did not advertise both event types')
  const [turnsAtStart, inputAtStart] = await Promise.all([
    eventSource.poll(turnFinished, { name: turnFinished.name, cursor: null }, signal()),
    eventSource.poll(needsInput, { name: needsInput.name, cursor: null }, signal()),
  ])
  expect(turnsAtStart.events).toEqual([])
  expect(inputAtStart.events).toEqual([])
  const call = async (arguments_: Record<string, unknown>) => {
    const response = await client.callTool({ name: 'dovo_threads', arguments: arguments_ })
    if (response.isError) throw new Error(JSON.stringify(response.content))
    return JSON.parse((response.content as { text: string }[])[0].text)
  }
  const completed = await Promise.all(
    Array.from({ length: 4 }, async () => {
      await call({ action: 'list' })
      return performance.now()
    }),
  )
  expect(Math.max(...completed) - Math.min(...completed)).toBeLessThan(3000)

  const realNow = Date.now
  const clock = vi.spyOn(Date, 'now')
  s.peers.internet.registerRemoteMcp(async (_claim, authorize) => {
    authorize()
    clock.mockReturnValue(realNow() + 13_000)
    return { lateResult: true }
  })
  try {
    expect(await call({ action: 'list' })).toEqual({ lateResult: true })
  } finally {
    clock.mockRestore()
    s.peers.internet.registerRemoteMcp((claim, authorize) => remoteMcpTool(s, claim, authorize))
  }
  const launch = {
    action: 'create',
    title: 'External launch',
    repositoryId: 'repo',
    agentId: 'studio-profile',
    prompt: 'Read the project and respond.',
    requiredSkills: ['review'],
    requestId: 'external-launch-1',
    start: true,
  }
  const escalation = await client.callTool({
    name: 'dovo_threads',
    arguments: {
      ...launch,
      allowPermissionIncrease: true,
      agentOverrides: { permission: 'full-access' },
    },
  })
  expect(escalation.isError).toBe(true)
  expect(ran).not.toHaveBeenCalled()
  const before = s.store.get().tasks.length
  const missing = await client.callTool({
    name: 'dovo_threads',
    arguments: {
      ...launch,
      requestId: 'external-missing-skill',
      requiredSkills: ['missing-studio-skill'],
    },
  })
  expect(missing.isError).toBe(true)
  expect(JSON.stringify(missing.content)).toContain('missing-studio-skill')
  expect(s.store.get().tasks).toHaveLength(before)
  expect(ran).not.toHaveBeenCalled()
  const admitted = await call(launch)
  expect(admitted.startError).toBeUndefined()
  expect(admitted.id).toBeTruthy()
  const retried = await call(launch)
  expect(retried.id).toBe(admitted.id)
  expect(s.store.get().tasks.filter((task) => task.title === launch.title)).toHaveLength(1)
  expect(s.store.task(admitted.id).agentOverrides?.permission).toBe('ask')
  expect(s.store.task(admitted.id).messages[0]?.source).toEqual({
    kind: 'system',
    label: 'Remote MCP · Fixture AI',
  })
  expect(ran).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(await call({ action: 'read', id: admitted.id }))).toContain(
    'Remote MCP answer',
  )
  await vi.waitFor(() => expect(s.store.taskSummary(admitted.id).status).toBe('review'))
  const turnPoll = {
    name: turnFinished.name,
    cursor: turnsAtStart.cursor,
    arguments: { projectIds: ['repo'], threadIds: [admitted.id] },
  }
  const [finished, excluded] = await Promise.all([
    eventSource.poll(turnFinished, turnPoll, signal()),
    eventSource.poll(
      turnFinished,
      {
        ...turnPoll,
        arguments: { projectIds: ['different-project'], threadIds: [admitted.id] },
      },
      signal(),
    ),
  ])
  expect(finished.events).toHaveLength(1)
  expect(finished.events[0]?.data).toEqual({
    threadId: admitted.id,
    projectId: 'repo',
    turnId: s.store.taskSummary(admitted.id).history.latestTurn?.id,
    outcome: 'completed',
  })
  expect(excluded.events).toEqual([])
  expect(excluded.cursor).toBe(finished.cursor)
  await call({
    action: 'send',
    id: admitted.id,
    text: 'One follow-up',
    messageId: 'external-follow-up-1',
  })
  expect(
    s.store.task(admitted.id).messages.filter((message) => message.id === 'external-follow-up-1'),
  ).toHaveLength(1)
  await vi.waitFor(() => expect(s.questions.list()).toHaveLength(1))
  const inputPoll = {
    name: needsInput.name,
    cursor: inputAtStart.cursor,
    arguments: { threadIds: [admitted.id] },
  }
  const [input, repeated] = await Promise.all([
    eventSource.poll(needsInput, inputPoll, signal()),
    eventSource.poll(needsInput, inputPoll, signal()),
  ])
  expect(input.events).toHaveLength(1)
  expect(input.events[0]?.data).toEqual({
    threadId: admitted.id,
    projectId: 'repo',
    requestId: s.questions.list()[0]?.id,
    kind: 'question',
  })
  expect(repeated).toEqual(input)

  await call({ action: 'stop', id: admitted.id })
  await vi.waitFor(() => expect(s.store.task(admitted.id).activeRunId).toBeUndefined())
  const refresh = () =>
    request(issuer + '/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id,
        refresh_token: token.refresh_token,
        resource,
      }),
    })
  const rotated = await (await refresh()).json()
  expect(rotated.access_token).toBeTruthy()
  expect((await refresh()).status).toBe(400)
  expect(
    (await request(endpoint, { headers: { Authorization: 'Bearer ' + token.access_token } }))
      .status,
  ).toBe(401)
  const page = await (await browser('/mcp/manage', management.cookie)).text()
  expect(page).toContain(resource)
  const runForm = /<form[^>]*>[^<]*<p>[^<]*Read and run<\/p>[\s\S]*?<\/form>/.exec(page)?.[0] ?? ''
  const field = /<input[^>]+name="grant"[^>]*>/.exec(runForm)?.[0] ?? ''
  const grant = /value="([a-zA-Z0-9_-]+)"/.exec(field)?.[1]
  expect(grant).toBeTruthy()
  expect(
    (await browser('/mcp/manage/revoke', management.cookie, new URLSearchParams({ grant: grant! })))
      .status,
  ).toBe(303)
  expect(
    (await request(endpoint, { headers: { Authorization: 'Bearer ' + rotated.access_token } }))
      .status,
  ).toBe(401)
  await expect(
    eventsClient(rotated.access_token).poll(turnFinished, turnPoll, signal()),
  ).rejects.toThrow('Authorize this MCP connection')
  for (const arguments_ of [{ action: 'list' }, { action: 'read', id: admitted.id }]) {
    const result = await readClient.callTool({ name: 'dovo_threads', arguments: arguments_ })
    expect(result.isError).not.toBe(true)
  }
  expect((await readClient.callTool({ name: 'dovo_threads', arguments: launch })).isError).toBe(
    true,
  )
  const readEvents = await eventsClient(readToken.access_token).poll(
    turnFinished,
    { ...turnPoll, cursor: finished.cursor },
    signal(),
  )
  expect(readEvents.events.map(({ data }) => data)).toEqual([
    expect.objectContaining({ threadId: admitted.id, outcome: 'cancelled' }),
  ])
  let started!: () => void
  const inProgress = new Promise<void>((resolve) => {
    started = resolve
  })
  let completeRevokedCall!: () => void
  const finish = new Promise<void>((resolve) => {
    completeRevokedCall = resolve
  })
  s.peers.internet.registerRemoteMcp(async (_claim, authorize) => {
    authorize()
    started()
    await finish
    return { revokedResult: true }
  })
  const cancel = new AbortController()
  const blocked = readClient
    .callTool({ name: 'dovo_threads', arguments: { action: 'list' } }, undefined, {
      signal: cancel.signal,
      timeout: 5000,
    })
    .catch((error: unknown) => error)
  const beforeDisable = replies
  const disabled = await Promise.race([
    inProgress.then(() => configure(false)),
    blocked.then(() => {
      throw new Error('MCP call ended before reaching its handler')
    }),
  ]).finally(completeRevokedCall)
  await s.peers.internet.drain()
  cancel.abort()
  await blocked
  expect(replies).toBe(beforeDisable)
  expect(disabled.status).toBe(200)
  expect(await disabled.json()).toMatchObject({
    enabled: true,
    remoteMcp: { enabled: false, managementUrl: origin + '/mcp/manage' },
  })
  expect(s.peers.internet.status().remoteMcp).not.toHaveProperty('serverUrl')
  await s.peers.internet.disable()
  expect(
    (await request(endpoint, { headers: { Authorization: 'Bearer ' + readToken.access_token } }))
      .status,
  ).toBe(401)
}, 60000)
