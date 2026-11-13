import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  decode,
  mutableStruct,
  mcpServerSchema,
  emptyBotResources,
  defaultTaskHarness,
  agentTurnSettings,
  type ResponseAction,
  type ResponseDispatch,
  type Task,
  type ThreadAction,
} from '@dovo/protocol'
import { prepareThreadAction } from '../../agent-tools/thread-actions'
import { HttpError } from '../../errors'
import { setupBotRuntime } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

async function setup(
  action: ResponseAction,
  permission: 'read-only' | 'full-access' = 'full-access',
  bot = false,
) {
  const f = await setupBotRuntime()
  await f.runtime.services.scratch.ensure()
  const source: Task = { ...f.draft(), harness: { ...defaultTaskHarness('codex'), permission } }
  if (bot && (await f.create(source)).response.status !== 200) throw Error('Bot setup failed')
  let prepared = false
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession(randomUUID())
    if (!prepared) {
      prepared = true
      const runId = f.runtime.services.store.taskSummary(source.id).activeRunId
      if (!runId) throw Error('Expected active run')
      prepareThreadAction(
        f.runtime.services,
        {
          taskId: source.id,
          parentRunId: runId,
          command: { kind: 'response', key: 'action', title: 'Continue', action },
        },
        runId,
        input.agent,
      )
    }
    input.onText('Done')
  })
  expect(
    (
      await f.request('/api/tasks/message', {
        id: source.id,
        ...(bot ? {} : { createTask: source }),
        messageId: randomUUID(),
        text: 'Prepare action',
      })
    ).status,
  ).toBe(200)
  await waitForRuntime(() =>
    expect(f.runtime.services.store.taskSummary(source.id).status).toBe('review'),
  )
  const current = () => {
    const action = f.runtime.services.store.taskSummary(source.id).threadActions?.[0]
    if (!action) throw Error('Expected card')
    return action
  }
  const review = (dispatch?: ResponseDispatch) =>
    f.request('/api/thread-actions/review', {
      sourceTaskId: source.id,
      actionId: current().id,
      ...(dispatch ? { dispatch } : {}),
    })
  const payload = () => ({
    sourceTaskId: source.id,
    actionId: current().id,
    response: true,
    revision: current().responseReview?.revision ?? 'not-reviewed',
    messageId: randomUUID(),
  })
  return { f, source, current, review, payload }
}

it('prepares same-thread buttons through real read-only MCP, with no execution and paired-human consent', async () => {
  const f = await setupBotRuntime()
  await f.runtime.services.scratch.ensure()
  const source = f.draft()
  let finished = false
  let failure: unknown
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession(randomUUID())
    const config = input.agent.resources?.mcpServers.find((entry) => entry.name === 'dovo_task')
    if (!config) throw Error('Missing regular MCP')
    const client = new Client({ name: 'response-test', version: '1' })
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.envValues,
      stderr: 'ignore',
    })
    try {
      await client.connect(transport)
      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: 'response_prepare',
          arguments: {
            key: 'next',
            title: 'Continue',
            action: { kind: 'prompt', prompt: 'Continue here' },
          },
        }),
      )
      expect(result.isError).not.toBe(true)
      expect(f.inputs).toHaveLength(1)
      expect(f.runtime.services.store.get().tasks).toHaveLength(1)
      const credential = decode(
        mutableStruct({ token: Schema.String }),
        JSON.parse(readFileSync(config.envValues?.DOVO_TASK_CREDENTIAL_FILE ?? '', 'utf8')),
      )
      const action = f.runtime.services.store.taskSummary(source.id).threadActions?.[0]
      const denied = await f.request(
        '/api/thread-actions/review',
        { sourceTaskId: source.id, actionId: action?.id },
        'POST',
        undefined,
        credential.token,
      )
      expect(denied.status).toBe(403)
      finished = true
    } catch (error) {
      failure = error
      throw error
    } finally {
      await client.close()
      await transport.close()
    }
    input.onText('Prepared')
  })
  await f.request('/api/tasks/message', {
    id: source.id,
    createTask: source,
    messageId: randomUUID(),
    text: 'Prepare',
    turnSettings: agentTurnSettings(
      { ...defaultTaskHarness('codex'), permission: 'read-only' },
      true,
    ),
  })
  await waitForRuntime(() => {
    if (failure) throw failure
    expect(finished).toBe(true)
  })
})

it('sends an edited prompt once into the same thread without consuming a composer draft or paused queue', async () => {
  const t = await setup({ kind: 'prompt', prompt: 'Continue here' })
  const s = t.f.runtime.services
  s.store.updateTask(t.source.id, (task) => ({
    ...task,
    draft: 'Unsent human text',
    queuePaused: true,
  }))
  expect((await t.review()).status).toBe(200)
  const payload = { ...t.payload(), text: 'Human edited prompt' }
  const [one, two] = await Promise.all([
    t.f.request('/api/thread-actions/send', payload),
    t.f.request('/api/thread-actions/send', payload),
  ])
  expect(one.status).toBe(200)
  expect(two.status).toBe(200)
  const saved = s.store.task(t.source.id)
  expect(saved.draft).toBe('Unsent human text')
  expect(saved.queuePaused).toBe(true)
  expect(saved.queue).toHaveLength(1)
  expect(saved.queue?.[0]).toMatchObject({
    id: payload.messageId,
    text: payload.text,
    source: { kind: 'system' },
  })
  expect(t.f.inputs).toHaveLength(1)
  await t.f.restart()
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.f.runtime.services.store.taskSummary(t.source.id).queue).toHaveLength(1)
})

it('retries the exact committed prompt after launch failure and never starts another queued message', async () => {
  const t = await setup({ kind: 'prompt', prompt: 'Reviewed prompt' })
  await t.review()
  const payload = t.payload()
  vi.spyOn(t.f.runtime.services.tasks, 'startEffect').mockReturnValueOnce(
    Effect.fail(new HttpError(503, 'Restarting')),
  )
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(503)
  expect(t.current().state).toBe('sent')
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  await waitForRuntime(() => expect(t.f.inputs).toHaveLength(2))
  expect(t.f.inputs[1].prompt).toContain('Reviewed prompt')
  await waitForRuntime(() =>
    expect(t.f.runtime.services.store.taskSummary(t.source.id).status).toBe('review'),
  )
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.f.inputs).toHaveLength(2)
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    archivedAt: new Date().toISOString(),
  }))
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.f.inputs).toHaveLength(2)
})

it('runs one real isolated terminal after review, and keeps its receipt after restart', async () => {
  const t = await setup({ kind: 'command', command: "printf 'response-%s\\n' button-ok" })
  const terminals = t.f.runtime.services.terminals
  const before = terminals.list().length
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(409)
  expect(terminals.list()).toHaveLength(before)
  expect((await t.review()).status).toBe(200)
  const payload = t.payload()
  const replies = await Promise.all([
    t.f.request('/api/thread-actions/send', payload),
    t.f.request('/api/thread-actions/send', payload),
  ])
  for (const reply of replies) expect(reply.status).toBe(200)
  expect(terminals.list()).toHaveLength(before + 1)
  const id = t.current().responseResult?.terminalId
  if (!id) throw Error('Expected terminal receipt')
  expect(t.current().responseResult?.status).toBe('started')
  await waitForRuntime(() => expect(terminals.get(id).buffer).toContain('response-button-ok'))
  await t.f.restart()
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.current().responseResult?.terminalId).toBe(id)
})

it('enforces the preparing turn access and rejects sandbox bypass, altered payloads and dismissed actions', async () => {
  const t = await setup({ kind: 'command', command: 'echo denied' }, 'read-only')
  expect((await t.review()).status).toBe(403)
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: { ...defaultTaskHarness('codex'), permission: 'full-access' },
  }))
  expect((await t.review()).status).toBe(403)
  const full = await setup({ kind: 'command', command: 'echo safe' })
  full.f.runtime.services.store.updateTask(full.source.id, (task) => ({
    ...task,
    harness: {
      ...defaultTaskHarness('codex'),
      permission: 'full-access',
      sandboxMode: 'workspace-write',
    },
  }))
  expect((await full.review()).status).toBe(403)
  expect(
    (
      await full.f.request('/api/thread-actions/dismiss', {
        sourceTaskId: full.source.id,
        actionId: full.current().id,
      })
    ).status,
  ).toBe(200)
  expect((await full.f.request('/api/thread-actions/send', full.payload())).status).toBe(409)
  expect(full.f.runtime.services.terminals.list()).toHaveLength(0)
})

it('dispatches validated native form values and binds approval to the exact resolved action', async () => {
  const t = await setup({
    kind: 'form',
    description: 'Choose a follow-up',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      {
        id: 'target',
        label: 'Target',
        type: 'choice',
        options: [{ value: 'beta', label: 'Beta' }],
        value: 'beta',
      },
    ],
    actions: [
      {
        id: 'plan',
        title: 'Plan',
        action: { kind: 'prompt', prompt: 'Plan {{name}} for {{target}}' },
      },
    ],
  })
  expect((await t.review({ actionId: 'plan', values: {} })).status).toBe(400)
  expect(
    (await t.review({ actionId: 'plan', values: { name: 'Launch', target: 'invalid' } })).status,
  ).toBe(400)
  expect((await t.review({ actionId: 'plan', values: { name: 'Launch' } })).status).toBe(200)
  expect(t.current().responseReview?.resolved).toEqual({
    kind: 'prompt',
    prompt: 'Plan Launch for beta',
  })
  const stale = t.payload()
  await t.review({ actionId: 'plan', values: { name: 'Release' } })
  expect((await t.f.request('/api/thread-actions/send', stale)).status).toBe(409)
  expect(
    (await t.f.request('/api/thread-actions/send', { ...t.payload(), command: 'unreviewed' }))
      .status,
  ).toBe(400)
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(200)
  await waitForRuntime(() => expect(t.f.inputs).toHaveLength(2))
  expect(t.f.inputs[1].prompt).toContain('Plan Release for beta')
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function mcpFixture() {
  let calls = 0
  let description = 'Publish the selected release'
  let fail = false
  let onCall: (() => void) | undefined
  const upstream = new Server(
    { name: 'response-upstream', version: '1' },
    { capabilities: { tools: {} } },
  )
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'publish',
        description,
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    ],
  }))
  upstream.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    calls++
    onCall?.()
    return {
      isError: fail,
      content: [{ type: 'text', text: `Published ${String(params.arguments?.name)}` }],
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
  if (!address || typeof address === 'string') throw Error('No MCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls: () => calls,
    onCall: (work: () => void) => {
      onCall = work
    },
    change: () => {
      description = 'Changed tool'
    },
    fail: () => {
      fail = true
    },
  }
}

it('reviews and calls a real scoped MCP tool exactly once, and rejects stale tool declarations', async () => {
  const mcp = await mcpFixture()
  const t = await setup({
    kind: 'mcp',
    server: 'release',
    tool: 'publish',
    arguments: { name: 'beta' },
  })
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: {
      ...defaultTaskHarness('codex'),
      permission: 'full-access',
      resources: {
        mcpServers: [
          decode(mcpServerSchema, {
            name: 'release',
            transport: 'http',
            enabled: true,
            url: mcp.url,
          }),
        ],
        skills: [],
        hooks: [],
      },
    },
  }))
  expect((await t.review()).status).toBe(200)
  expect(mcp.calls()).toBe(0)
  const stale = t.payload()
  mcp.change()
  expect((await t.f.request('/api/thread-actions/send', stale)).status).toBe(409)
  expect(mcp.calls()).toBe(0)
  expect((await t.review()).status).toBe(200)
  const payload = t.payload()
  const replies = await Promise.all([
    t.f.request('/api/thread-actions/send', payload),
    t.f.request('/api/thread-actions/send', payload),
  ])
  for (const reply of replies) expect(reply.status).toBe(200)
  expect(mcp.calls()).toBe(1)
  expect(t.current().responseResult).toMatchObject({
    status: 'completed',
    output: 'Published beta',
  })
  await t.f.restart()
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(mcp.calls()).toBe(1)
})

it('rejects invalid MCP arguments and disabled servers without executing, and retains a failed tool receipt', async () => {
  const mcp = await mcpFixture()
  const invalid = await setup({
    kind: 'mcp',
    server: 'release',
    tool: 'publish',
    arguments: { name: 42 },
  })
  const resources = {
    mcpServers: [
      decode(mcpServerSchema, { name: 'release', transport: 'http', enabled: true, url: mcp.url }),
    ],
    skills: [],
    hooks: [],
  }
  invalid.f.runtime.services.store.updateTask(invalid.source.id, (task) => ({
    ...task,
    harness: { ...defaultTaskHarness('codex'), permission: 'full-access', resources },
  }))
  expect((await invalid.review()).status).toBe(400)
  expect(mcp.calls()).toBe(0)
  const second = await mcpFixture()
  const enabledResources = {
    ...resources,
    mcpServers: [{ ...resources.mcpServers[0], url: second.url }],
  }
  const t = await setup({
    kind: 'mcp',
    server: 'release',
    tool: 'publish',
    arguments: { name: 'beta' },
  })
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: {
      ...defaultTaskHarness('codex'),
      permission: 'full-access',
      resources: enabledResources,
    },
  }))
  expect((await t.review()).status).toBe(200)
  const payload = t.payload()
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: { ...defaultTaskHarness('codex'), permission: 'full-access' },
  }))
  const denied = await t.f.request('/api/thread-actions/send', payload)
  expect(denied.status).toBe(403)
  expect(await denied.json()).toMatchObject({ mutationRejected: true })
  expect(t.current().state).toBe('prepared')
  expect(second.calls()).toBe(0)
  t.f.runtime.services.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: {
      ...defaultTaskHarness('codex'),
      permission: 'full-access',
      resources: enabledResources,
    },
  }))
  second.fail()
  expect((await t.review()).status).toBe(200)
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(200)
  expect(t.current().responseResult?.status).toBe('failed')
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(200)
  expect(second.calls()).toBe(1)
})

it('keeps an uncertain direct result final and reports an interrupted receipt after restart', async () => {
  const t = await setup({ kind: 'command', command: 'echo once' })
  await t.review()
  const run = vi.spyOn(t.f.runtime.services.terminals, 'input').mockImplementationOnce(() => {
    throw Error('Transport lost after input')
  })
  const payload = t.payload()
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.current().responseResult?.status).toBe('uncertain')
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(run).toHaveBeenCalledTimes(1)
  // Model the durable boundary of a process exit before it can write its completion receipt.
  const s = t.f.runtime.services
  const interrupted: ThreadAction = {
    ...t.current(),
    responseResult: { status: 'running', output: 'Pending' },
  }
  s.db
    .prepare('UPDATE documents SET value=? WHERE id=?')
    .run(JSON.stringify(interrupted), `thread-action-final:${t.source.id}:${interrupted.id}`)
  s.store.updateTask(t.source.id, (task) => ({ ...task, threadActions: [interrupted] }))
  await t.f.restart()
  expect((await t.review()).status).toBe(200)
  expect(t.current().responseResult?.status).toBe('uncertain')
  expect((await t.f.request('/api/thread-actions/send', payload)).status).toBe(200)
  expect(t.f.runtime.services.terminals.list()).toHaveLength(0)
})

it('uses a Bot-only MCP server and prevents a paused Bot from dispatching', async () => {
  const mcp = await mcpFixture()
  const t = await setup(
    { kind: 'mcp', server: 'release', tool: 'publish', arguments: { name: 'bot-beta' } },
    'full-access',
    true,
  )
  t.f.runtime.services.store.updateTask(t.source.id, (task) => {
    if (!task.bot) throw Error('Expected Bot')
    return {
      ...task,
      bot: {
        ...task.bot,
        resources: {
          ...emptyBotResources(),
          mcpServers: [
            decode(mcpServerSchema, {
              name: 'release',
              transport: 'http',
              enabled: true,
              url: mcp.url,
            }),
          ],
        },
      },
    }
  })
  expect((await t.review()).status).toBe(200)
  t.f.runtime.services.store.updateTask(t.source.id, (task) => {
    if (!task.bot) throw Error('Expected Bot')
    return { ...task, bot: { ...task.bot, state: 'paused' } }
  })
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(409)
  expect(mcp.calls()).toBe(0)
  t.f.runtime.services.store.updateTask(t.source.id, (task) => {
    if (!task.bot) throw Error('Expected Bot')
    return { ...task, bot: { ...task.bot, state: 'active' } }
  })
  expect((await t.f.request('/api/thread-actions/send', t.payload())).status).toBe(200)
  expect(t.current().responseResult).toMatchObject({
    status: 'completed',
    output: 'Published bot-beta',
  })
})

it('keeps a completed receipt but withholds the result from a device revoked during the tool call', async () => {
  const mcp = await mcpFixture()
  const t = await setup({
    kind: 'mcp',
    server: 'release',
    tool: 'publish',
    arguments: { name: 'beta' },
  })
  const s = t.f.runtime.services
  s.store.updateTask(t.source.id, (task) => ({
    ...task,
    harness: {
      ...defaultTaskHarness('codex'),
      permission: 'full-access',
      resources: {
        mcpServers: [
          decode(mcpServerSchema, {
            name: 'release',
            transport: 'http',
            enabled: true,
            url: mcp.url,
          }),
        ],
        skills: [],
        hooks: [],
      },
    },
  }))
  expect((await t.review()).status).toBe(200)
  const token = 'paired-device-token-at-least-32-characters'
  const deviceId = s.devices.add('Human phone', token)
  mcp.onCall(() => s.devices.revoke(deviceId))
  const payload = t.payload()
  const revoked = await t.f.request('/api/thread-actions/send', payload, 'POST', undefined, token)
  expect(revoked.status).toBe(401)
  expect(t.current().responseResult?.status).toBe('completed')
  const receipt = await t.f.request('/api/thread-actions/send', payload)
  expect(receipt.status).toBe(200)
  expect(mcp.calls()).toBe(1)
})
