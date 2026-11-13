import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  botResultSchema,
  decode,
  defaultTaskHarness,
  snapshotSchema,
  taskResources,
  type BotResources,
  type McpServer,
} from '@dovo/protocol'
import { waitForRuntime } from '../../testing/integration'
import { setupBotRuntime, type BotRunInput } from '../../testing/bots'

const SECRET = 'literal-bot-header-secret-7f3a'
const ENV_SECRET = 'literal-bot-env-secret-91c2'

/** A real streamable-HTTP MCP server that reports only whether the Bot's header arrived. */
async function upstream(cleanups: Array<() => Promise<void>>) {
  const headers: Array<string | undefined> = []
  const server = new Server({ name: 'bot-fixture', version: '1' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'whoami', inputSchema: { type: 'object' } }],
  }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [
      { type: 'text', text: headers.at(-1) === `Bearer ${SECRET}` ? 'authorized' : 'anonymous' },
    ],
  }))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  await server.connect(transport)
  const http = createServer((request, response) => {
    headers.push(request.headers.authorization)
    void transport.handleRequest(request, response)
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    await server.close()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const address = http.address()
  if (!address || typeof address === 'string') throw new Error('No upstream port')
  return `http://127.0.0.1:${address.port}/mcp`
}

const stdio = (name: string, extra: Partial<McpServer> = {}): McpServer => ({
  name,
  enabled: true,
  transport: 'stdio',
  command: 'node',
  args: [],
  url: '',
  env: {},
  bearerTokenEnv: '',
  headerEnv: {},
  ...extra,
})
const skill = (name: string, content: string) => ({
  name,
  description: `${name} skill`,
  enabled: true,
  content,
})

async function bots() {
  const f = await setupBotRuntime()
  const cleanups: Array<() => Promise<void>> = []
  const url = await upstream(cleanups)
  const s = () => f.runtime.services
  // Inherited for every thread on this computer.
  s().defaults.save({
    ...s().defaults.get(),
    scopedSettings: {
      environment: {
        resources: {
          mcpServers: [stdio('shared-docs')],
          skills: [skill('shared-review', 'SHARED-REVIEW-BODY')],
        },
      },
      shared: [],
    },
  })
  const a = decode(botResultSchema, await (await f.create()).response.json())
  const b = decode(botResultSchema, await (await f.create()).response.json())
  const own: BotResources = {
    mcpServers: [
      {
        ...stdio('a-http'),
        transport: 'http',
        command: '',
        url,
        headerValues: { Authorization: `Bearer ${SECRET}` },
      },
      stdio('a-env', { envValues: { API_KEY: ENV_SECRET } }),
    ],
    skills: [skill('a-skill', 'A-SKILL-BODY')],
    disabledMcpServers: ['shared-docs'],
    disabledSkills: [],
  }
  return { f, s, a, b, own, cleanups }
}

const lastRun = (inputs: BotRunInput[], prompt: string) =>
  inputs.filter((input) => input.prompt.includes(prompt)).at(-1)

it('stores Bot resources per Bot, keeps credentials host-side and applies them to turns', async () => {
  const t = await bots()
  const { f, s, a, b } = t
  try {
    const mutationId = randomUUID()
    const saved = await f.request(
      '/api/bots/update',
      { id: a.id, expectedRevision: a.bot.revision, resources: t.own },
      'POST',
      mutationId,
    )
    expect(saved.status).toBe(200)
    const text = await saved.text()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(ENV_SECRET)
    const result = decode(botResultSchema, JSON.parse(text))
    const header = result.bot.resources?.mcpServers[0]?.headerValues?.Authorization
    expect(header).toMatch(/^dovo-stored-secret:/)
    // The host keeps the literal value.
    expect(
      s().store.taskSummary(a.id).bot?.resources?.mcpServers[0]?.headerValues?.Authorization,
    ).toBe(`Bearer ${SECRET}`)

    // Receipt replay, snapshot, activity and the receipt table never hold literals.
    const replay = await f.request(
      '/api/bots/update',
      { id: a.id, expectedRevision: a.bot.revision, resources: t.own },
      'POST',
      mutationId,
    )
    expect(replay.status).toBe(200)
    expect(await replay.text()).not.toContain(SECRET)
    const snapshotText = await (await f.request('/api/snapshot', undefined, 'GET')).text()
    expect(snapshotText).not.toContain(SECRET)
    expect(snapshotText).not.toContain(ENV_SECRET)
    expect(decode(snapshotSchema, JSON.parse(snapshotText)).botResourcesSupported).toBe(true)
    const receipts = JSON.stringify(s().db.prepare('SELECT * FROM mutation_receipts').all())
    expect(receipts).not.toContain(SECRET)
    expect(receipts).not.toContain(ENV_SECRET)
    expect(JSON.stringify(s().activity.list('', '', 0))).not.toContain(SECRET)

    // Saving the public form back (with references) keeps the stored values.
    const roundTrip = await f.request('/api/bots/update', {
      id: a.id,
      expectedRevision: result.bot.revision,
      role: 'Release captain',
      resources: result.bot.resources,
    })
    expect(roundTrip.status).toBe(200)
    const kept = s().store.taskSummary(a.id).bot?.resources
    expect(kept?.mcpServers[0]?.headerValues?.Authorization).toBe(`Bearer ${SECRET}`)
    expect(kept?.mcpServers[1]?.envValues?.API_KEY).toBe(ENV_SECRET)
    // An unknown reference is rejected instead of saved.
    const forged = await f.request('/api/bots/update', {
      id: a.id,
      expectedRevision: s().store.taskSummary(a.id).bot?.revision,
      resources: {
        ...t.own,
        mcpServers: [
          stdio('a-env', { envValues: { API_KEY: `dovo-stored-secret:${'0'.repeat(64)}` } }),
        ],
      },
    })
    expect(forged.status).toBe(409)

    // Effective resources: Bot A's own servers, shared-docs off; Bot B unchanged.
    const workspace = s().store.get()
    const effective = (id: string) =>
      taskResources(s().store.taskSummary(id), workspace, s().defaults.get())
    expect(effective(a.id).mcpServers.map((item) => [item.name, item.enabled])).toEqual([
      ['shared-docs', false],
      ['a-http', true],
      ['a-env', true],
    ])
    expect(effective(b.id).mcpServers.map((item) => [item.name, item.enabled])).toEqual([
      ['shared-docs', true],
    ])
    expect(effective(b.id).skills.map((item) => item.name)).toEqual(['shared-review'])
    // Bots skip project-scoped resources, also when an older Bot still has a project.
    const legacy = { ...s().store.taskSummary(b.id), repositoryId: 'repo' }
    const withProject = {
      ...workspace,
      repositories: [
        {
          id: 'repo',
          name: 'Repo',
          path: '/tmp/repo',
          branch: 'main',
          resources: { mcpServers: [stdio('project-only')], skills: [] },
        },
      ],
    }
    expect(
      taskResources(legacy, withProject, s().defaults.get()).mcpServers.map((item) => item.name),
    ).not.toContain('project-only')
    expect(
      taskResources({ ...legacy, bot: undefined }, withProject, s().defaults.get()).mcpServers.map(
        (item) => item.name,
      ),
    ).toContain('project-only')

    // Turns receive the effective resources, and the Bot's MCP server is reachable through
    // the Dovo bridge with its stored credential.
    let answer = ''
    f.runtime.run.mockImplementation(async (input) => {
      input.onSession('provider-session')
      const proxied = input.agent.resources?.mcpServers.find((item) => item.name === 'a-http')
      const token = proxied?.envValues?.DOVO_MCP_BRIDGE_TOKEN
      if (token) {
        const called = await s().mcpApps.proxy(token, 'tools/call', { name: 'whoami' })
        answer = JSON.stringify(called)
      }
      input.onText('Done')
    })
    await f.request('/api/tasks/message', {
      id: a.id,
      messageId: randomUUID(),
      text: 'A-TURN use $a-skill',
    })
    await waitForRuntime(() => expect(s().store.taskSummary(a.id).status).toBe('review'))
    const runA = lastRun(f.inputs, 'A-TURN')
    expect(
      runA?.agent.resources?.mcpServers.filter((item) => item.enabled).map((item) => item.name),
    ).toEqual(expect.arrayContaining(['a-http', 'a-env']))
    expect(
      runA?.agent.resources?.mcpServers.find((item) => item.name === 'shared-docs')?.enabled,
    ).toBe(false)
    expect(runA?.agent.resources?.skills.map((item) => item.name)).toEqual(
      expect.arrayContaining(['shared-review', 'a-skill']),
    )
    expect(answer).toContain('authorized')
    // Credentials never reach the conversation.
    expect(JSON.stringify(s().store.task(a.id).messages)).not.toContain(SECRET)

    await f.request('/api/tasks/message', { id: b.id, messageId: randomUUID(), text: 'B-TURN' })
    await waitForRuntime(() => expect(s().store.taskSummary(b.id).status).toBe('review'))
    const runB = lastRun(f.inputs, 'B-TURN')
    expect(runB?.agent.resources?.mcpServers.map((item) => item.name)).not.toContain('a-http')
    expect(runB?.agent.resources?.skills.map((item) => item.name)).not.toContain('a-skill')

    // Switching Bot A's harness keeps its own resources and the Bot itself.
    const handoff = await f.request('/api/tasks/continue-harness', {
      id: a.id,
      requestId: randomUUID(),
      harness: defaultTaskHarness('claude'),
      stop: false,
    })
    expect(handoff.status).toBe(200)
    expect(s().store.taskSummary(a.id).harness?.provider).toBe('claude')
    expect(
      s()
        .store.taskSummary(a.id)
        .bot?.resources?.skills.map((item) => item.name),
    ).toEqual(['a-skill'])

    // Removing a Bot server revokes bridge access granted for an earlier turn.
    const token = runA?.agent.resources?.mcpServers.find((item) => item.name === 'a-http')
      ?.envValues?.DOVO_MCP_BRIDGE_TOKEN
    expect(token).toBeDefined()
    const cleared = await f.request('/api/bots/update', {
      id: a.id,
      expectedRevision: s().store.taskSummary(a.id).bot?.revision,
      resources: {},
    })
    expect(cleared.status).toBe(200)
    expect(s().store.taskSummary(a.id).bot?.resources).toBeUndefined()
    await expect(s().mcpApps.proxy(token ?? '', 'tools/list', {})).rejects.toThrow(
      'no longer enabled',
    )
  } finally {
    for (const cleanup of t.cleanups) await cleanup()
  }
})

it('rejects Bot resource edits from agents and stale revisions', async () => {
  const t = await bots()
  try {
    const agent = await fetch(`http://127.0.0.1:${t.f.runtime.port}/api/bots/update`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bots-owner-token-at-least-32-characters-long',
        'Content-Type': 'application/json',
        'x-dovo-agent-access': '1',
      },
      body: JSON.stringify({ id: t.a.id, expectedRevision: t.a.bot.revision, resources: t.own }),
    })
    expect(agent.status).toBe(403)
    const first = await t.f.request('/api/bots/update', {
      id: t.a.id,
      expectedRevision: t.a.bot.revision,
      role: 'Changed elsewhere',
    })
    expect(first.status).toBe(200)
    const stale = await t.f.request('/api/bots/update', {
      id: t.a.id,
      expectedRevision: t.a.bot.revision,
      resources: t.own,
    })
    expect(stale.status).toBe(409)
    expect(t.s().store.taskSummary(t.a.id).bot?.resources).toBeUndefined()
  } finally {
    for (const cleanup of t.cleanups) await cleanup()
  }
})
