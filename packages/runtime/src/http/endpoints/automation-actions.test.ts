import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { Schema } from 'effect'
import {
  automationListResultSchema,
  automationListByteBudget,
  botResultSchema,
  decode,
  defaultTaskHarness,
  mutableStruct,
  noStudioTools,
  responses,
  SCRATCH_PROJECT_ID,
  automationReviewWorkflowSchema,
  resourceSettingsSchema,
  threadActionResultSchema,
  type Automation,
  type Task,
} from '@dovo/protocol'
import { setupBotRuntime, type BotRunInput } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

async function toolsFor(input: BotRunInput) {
  const config = input.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
  if (!config) throw new Error('Expected the real dovo_task bridge')
  expect(config.envValues?.DOVO_TASK_READ_ONLY).toBe('1')
  expect(JSON.parse(config.envValues?.DOVO_STUDIO_TOOLS ?? '{}')).toEqual(noStudioTools())
  const client = new Client({ name: 'automation-action-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'ignore',
  })
  await client.connect(transport)
  const credential = decode(
    mutableStruct({ token: Schema.String, runId: Schema.String }),
    JSON.parse(readFileSync(config.envValues?.DOVO_TASK_CREDENTIAL_FILE ?? '', 'utf8')),
  )
  return {
    credential,
    async list() {
      return (await client.listTools()).tools
    },
    async call(name: string, args: Record<string, unknown>) {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
      const block = result.content.find((part) => part.type === 'text')
      return { error: result.isError === true, text: block?.type === 'text' ? block.text : '' }
    },
    async close() {
      await client.close()
      await transport.close()
    },
  }
}

function flow(id = 'reviewed-flow', gate = true): Automation {
  const kinds = gate ? (['trigger', 'review', 'task'] as const) : (['trigger', 'task'] as const)
  return {
    id,
    name: id,
    nodes: kinds.map((kind, index) => ({
      id: kind,
      type: 'automation',
      position: { x: index * 100, y: 0 },
      data: {
        kind,
        label: kind,
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Do reviewed work',
        agentId: '',
        repositoryId: SCRATCH_PROJECT_ID,
        harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
        execution: 'main',
      },
    })),
    edges: kinds
      .slice(1)
      .map((kind, index) => ({ id: `edge-${index}`, source: kinds[index], target: kind })),
  }
}

async function setup(kind: 'normal' | 'automation' | 'bot' = 'normal') {
  const f = await setupBotRuntime()
  const s = () => f.runtime.services
  await s().scratch.ensure()
  let sourceId = ''
  const source: Task = {
    ...f.draft(),
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
  }
  s().store.update((w) => ({ ...w, automations: [flow()] }))
  const toolSteps: Array<(tools: Awaited<ReturnType<typeof toolsFor>>) => Promise<void>> = []
  let toolError: unknown
  const installRun = () =>
    f.runtime.run.mockImplementation(async (input) => {
      input.onSession('session')
      const step = toolSteps.shift()
      if (step) {
        const tools = await toolsFor(input)
        try {
          await step(tools)
        } catch (error) {
          toolError = error
          throw error
        } finally {
          await tools.close()
        }
      }
      input.onText('Done')
    })
  installRun()
  async function turn(step: (typeof toolSteps)[number]) {
    toolSteps.push(step)
    if (!sourceId && kind === 'automation') {
      const origin = flow('source-flow', false)
      origin.nodes[1].data.objective = 'Prepare a reviewed action'
      s().store.update((w) => ({ ...w, automations: [...w.automations, origin] }))
      const id = s().jobs.start(origin.id)
      await waitForRuntime(() => expect(s().jobs.detail(id).status).toBe('completed'))
      sourceId = s().jobs.detail(id).taskIds[0]
    } else {
      if (!sourceId && kind === 'bot') {
        sourceId = decode(botResultSchema, await (await f.create(source)).response.json()).id
      }
      const response = await f.request('/api/tasks/message', {
        id: sourceId || source.id,
        messageId: randomUUID(),
        text: 'Prepare a reviewed action',
        ...(!sourceId ? { createTask: source } : {}),
      })
      expect(response.status).toBe(200)
      sourceId ||= source.id
      await waitForRuntime(() => {
        expect(toolSteps).toHaveLength(0)
        const task = s().store.taskSummary(sourceId)
        expect(['review', 'failed']).toContain(task.status)
        if (task.status === 'failed') throw toolError ?? new Error(task.error)
      })
    }
    expect(toolSteps).toHaveLength(0)
  }
  const card = () => s().store.taskSummary(sourceId).threadActions?.[0]
  const prepare = (key = 'automation') =>
    turn(async (tools) => {
      const response = await tools.call('automation_prepare', {
        key,
        title: 'Review automation',
        automationId: 'reviewed-flow',
        prompt: 'Initial context',
      })
      expect(response.error).toBe(false)
    })
  const body = (text = 'Edited run-only context') => {
    const action = card()
    if (!action?.automation) throw new Error('Expected an automation action')
    return {
      sourceTaskId: sourceId,
      actionId: action.id,
      revision: action.automation.revision,
      text,
    }
  }
  const send = (input = body(), mutationId?: string, token?: string) =>
    f.request('/api/thread-actions/send', input, 'POST', mutationId, token)
  return {
    f,
    s,
    turn,
    prepare,
    card,
    body,
    send,
    installRun,
    get sourceId() {
      return sourceId
    },
  }
}

for (const kind of ['normal', 'automation', 'bot'] as const) {
  it(`prepares through real read-only MCP in a ${kind} thread and starts only from paired HTTP`, async () => {
    const t = await setup(kind)
    const paused = flow('paused-flow')
    paused.enabled = false
    paused.nodes[2].data.objective = 'CATALOG-PRIVATE-INSTRUCTIONS'
    paused.nodes[2].data.harness = {
      ...defaultTaskHarness('codex'),
      instructions: 'CATALOG-PRIVATE-CONFIG',
    }
    t.s().store.update((w) => ({ ...w, automations: [...w.automations, paused] }))
    let runToken = ''
    await t.turn(async (tools) => {
      runToken = tools.credential.token
      const before = t.s().jobs.list().length
      const threads = t.s().store.get().tasks.length
      const available = await tools.list()
      expect(available.some((tool) => tool.name === 'automation_list')).toBe(true)
      expect(available.some((tool) => tool.name === 'automation_prepare')).toBe(true)
      const listed = await tools.call('automation_list', {})
      expect(listed.error).toBe(false)
      const catalog: unknown = JSON.parse(listed.text)
      expect(catalog).toEqual({
        automations: t
          .s()
          .store.get()
          .automations.slice()
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((item) => ({
            id: item.id,
            name: item.name,
            enabled: item.enabled !== false,
          })),
      })
      expect(listed.text).not.toContain('CATALOG-PRIVATE')
      expect(t.s().store.get().tasks).toHaveLength(threads)
      expect(t.s().jobs.list()).toHaveLength(before)
      const humanList = await t.f.request('/api/agent/thread-prepare', {
        taskId: t
          .s()
          .store.get()
          .tasks.find((task) => task.status === 'running')?.id,
        parentRunId: tools.credential.runId,
        command: { kind: 'list-automations' },
      })
      expect(humanList.status).toBe(403)
      const otherSource = await t.f.request(
        '/api/agent/thread-prepare',
        {
          taskId: 'another-thread',
          parentRunId: tools.credential.runId,
          command: { kind: 'list-automations' },
        },
        'POST',
        undefined,
        tools.credential.token,
      )
      expect(otherSource.status).toBe(403)
      const proposed = await tools.call('automation_prepare', {
        key: 'automation',
        title: 'Review',
        automationId: 'reviewed-flow',
        prompt: 'Initial context',
      })
      expect(proposed.error).toBe(false)
      expect(t.s().jobs.list()).toHaveLength(before)
      const action = t
        .s()
        .store.get()
        .tasks.find((task) =>
          task.threadActions?.some(
            (card) =>
              card.id ===
              decode(mutableStruct({ id: Schema.String }), JSON.parse(proposed.text)).id,
          ),
        )?.threadActions?.[0]
      expect(action?.automation?.workflow).toEqual(decode(automationReviewWorkflowSchema, flow()))
      for (const path of ['send', 'review', 'dismiss']) {
        const response = await t.f.request(
          `/api/thread-actions/${path}`,
          {
            sourceTaskId: sourceIdForAction(t, action?.id),
            actionId: action?.id,
            revision: action?.automation?.revision,
            text: 'Try from run',
          },
          'POST',
          undefined,
          runToken,
        )
        expect([401, 403]).toContain(response.status)
      }
    })
    const unauthenticated = await fetch(
      `http://127.0.0.1:${t.f.runtime.port}/api/thread-actions/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t.body()),
      },
    )
    expect(unauthenticated.status).toBe(401)
    // Claim a real paired device. The owner token remains only on the runtime.
    const code = t.s().pairing.createCode()
    const pending = decode(
      responses.pairRequest,
      await (
        await t.f.request('/api/pair/request', {
          protocolVersion: 2,
          code: code.code,
          name: 'Review phone',
        })
      ).json(),
    )
    t.s().pairing.approve(pending.id, true)
    const claimed = decode(
      responses.pairClaim,
      await (await t.f.request('/api/pair/claim', pending)).json(),
    )
    if (!claimed.token) throw new Error('Expected paired device token')
    const sent = await t.send(t.body(), randomUUID(), claimed.token)
    expect(sent.status).toBe(200)
    const accepted = decode(threadActionResultSchema, await sent.json()).action
    expect(accepted.sent).toBeUndefined()
    expect(accepted.automationSent?.runId).toBeTruthy()
    const detail = t.s().jobs.detail(accepted.automationSent!.runId)
    const stored = decode(
      mutableStruct({ value: Schema.String }),
      t.s().db.prepare('SELECT value FROM job_runs WHERE id=?').get(detail.id),
    )
    expect(
      decode(mutableStruct({ triggerPayload: Schema.Unknown }), JSON.parse(stored.value))
        .triggerPayload,
    ).toEqual({
      kind: 'reviewed-action',
      sourceTaskId: t.sourceId,
      actionId: accepted.id,
      externalUserInput: { text: 'Edited run-only context' },
    })
    await waitForRuntime(() => expect(t.s().jobs.detail(detail.id).status).toBe('waiting'))
    t.s().jobs.approve(detail.id, true)
    await waitForRuntime(() => expect(t.s().jobs.detail(detail.id).status).toBe('completed'))
    expect(
      t.f.inputs.some(
        (input) =>
          input.prompt.includes('Edited run-only context') &&
          input.prompt.includes('External trigger data'),
      ),
    ).toBe(true)
    expect(
      t
        .s()
        .store.get()
        .automations.find((item) => item.id === 'reviewed-flow'),
    ).toEqual(flow())
  })
}

function sourceIdForAction(t: Awaited<ReturnType<typeof setup>>, actionId?: string) {
  return t
    .s()
    .store.get()
    .tasks.find((task) => task.threadActions?.some((action) => action.id === actionId))?.id
}

it('rejects changed workflow, refreshes review, and preserves the run-only edited input', async () => {
  const t = await setup()
  await t.prepare()
  const original = t.body('Keep my edit')
  t.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((item) => ({ ...item, name: 'Changed' })),
  }))
  const stale = await t.send(original)
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ mutationRejected: true })
  expect(t.s().jobs.list()).toHaveLength(0)
  const refreshed = await t.f.request('/api/thread-actions/review', {
    sourceTaskId: t.sourceId,
    actionId: original.actionId,
  })
  expect(refreshed.status).toBe(200)
  expect(
    decode(threadActionResultSchema, await refreshed.json()).action.automation?.revision,
  ).not.toBe(original.revision)
  expect((await t.send(t.body(original.text))).status).toBe(200)
})

it('guards every effective step, including Bot overrides, defaults, resources, pause and deletion', async () => {
  const t = await setup()
  const bot = decode(
    botResultSchema,
    await (
      await t.f.create({
        ...t.f.draft(),
        harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
      })
    ).response.json(),
  )
  const target = flow()
  target.nodes[2].data.botId = bot.id
  // Dormant full-access settings must not override the Bot's read-only settings.
  target.nodes[2].data.harness = defaultTaskHarness('codex')
  t.s().store.update((w) => ({ ...w, automations: [target] }))
  await t.prepare()
  expect(t.card()?.automation?.resources[0]).toMatchObject({
    botId: bot.id,
    agent: { permission: 'read-only' },
  })
  const saved = t.body()
  t.s().store.updateTask(bot.id, (task) => ({ ...task, harness: defaultTaskHarness('codex') }))
  const stale = await t.send(saved)
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ mutationRejected: true })
  await t.f.request('/api/thread-actions/review', {
    sourceTaskId: t.sourceId,
    actionId: saved.actionId,
  })
  const wide = await t.send()
  expect(wide.status).toBe(403)
  expect(await wide.json()).toMatchObject({ mutationRejected: true })
  t.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((item) => ({ ...item, enabled: false })),
  }))
  expect((await t.send()).status).toBe(409)
  t.s().store.update((w) => ({ ...w, automations: [] }))
  expect((await t.send()).status).toBe(409)
  expect(t.s().jobs.list()).toHaveLength(0)
})

it('commits one durable receipt with its run, survives restart, eviction and later deletion', async () => {
  const t = await setup()
  await t.prepare()
  const input = t.body()
  const responses = await Promise.all([t.send(input), t.send(input)])
  expect(responses.map((response) => response.status)).toEqual([200, 200])
  const [first, second] = await Promise.all(
    responses.map(async (response) => decode(threadActionResultSchema, await response.json())),
  )
  expect(first.action.automationSent).toEqual(second.action.automationSent)
  expect(t.s().jobs.list()).toHaveLength(1)
  await waitForRuntime(() => expect(t.s().jobs.list()[0].status).toBe('waiting'))
  t.s().store.updateTask(t.sourceId, (task) => ({ ...task, threadActions: [] }))
  t.s().store.update((w) => ({ ...w, automations: [] }))
  await t.f.restart()
  const retry = await t.send(input)
  expect(retry.status).toBe(200)
  expect(decode(threadActionResultSchema, await retry.json()).action).toEqual(first.action)
  const dismissed = await t.f.request('/api/thread-actions/dismiss', {
    sourceTaskId: t.sourceId,
    actionId: input.actionId,
  })
  expect(decode(threadActionResultSchema, await dismissed.json()).action.state).toBe('sent')
  expect(t.s().jobs.list()).toHaveLength(1)
})

it('rolls back the run, delivery, receipt and live snapshot if the atomic receipt write fails', async () => {
  const t = await setup()
  await t.prepare()
  const before = t.s().store.taskSummary(t.sourceId)
  const sql = `CREATE TRIGGER fail_action_receipt BEFORE INSERT ON documents WHEN NEW.id LIKE 'thread-action-final:%'
    BEGIN SELECT RAISE(ABORT, 'receipt write failed'); END`
  t.s().db.exec(sql)
  expect((await t.send()).status).toBe(500)
  expect(t.s().jobs.list()).toHaveLength(0)
  expect(t.s().db.prepare('SELECT * FROM job_runs').all()).toHaveLength(0)
  expect(t.s().db.prepare('SELECT * FROM deliveries').all()).toHaveLength(0)
  expect(t.s().store.taskSummary(t.sourceId)).toEqual(before)
  t.s().db.exec('DROP TRIGGER fail_action_receipt')
  expect((await t.send()).status).toBe(200)
})

it('does not revive a dismissed decision or accept oversized workflow reviews', async () => {
  const t = await setup()
  await t.prepare()
  const input = t.body()
  await t.f.request('/api/thread-actions/dismiss', {
    sourceTaskId: t.sourceId,
    actionId: input.actionId,
  })
  await t.prepare()
  expect(t.card()?.state).toBe('dismissed')
  expect((await t.send(input)).status).toBe(409)
  const big = flow()
  big.nodes[2].data.objective = 'x'.repeat(150000)
  t.s().store.update((w) => ({ ...w, automations: [big] }))
  await t.turn(async (tools) => {
    const proposed = await tools.call('automation_prepare', {
      key: 'large',
      title: 'Too large',
      automationId: big.id,
      prompt: 'x',
    })
    expect(proposed.error).toBe(true)
  })
  expect(t.s().jobs.list()).toHaveLength(0)
})

it('invalidates review for effective agent, project resources and runtime defaults changes', async () => {
  const t = await setup()
  const selected = {
    id: 'review-agent',
    name: 'Review agent',
    ...defaultTaskHarness('codex'),
    permission: 'read-only' as const,
  }
  const target = flow()
  target.nodes[2].data.harness = undefined
  target.nodes[2].data.agentId = selected.id
  t.s().store.update((w) => ({ ...w, agents: [...w.agents, selected], automations: [target] }))
  const changes = [
    () =>
      t.s().store.update((w) => ({
        ...w,
        agents: w.agents.map((agent) =>
          agent.id === selected.id ? { ...agent, model: 'changed-model' } : agent,
        ),
      })),
    () =>
      t.s().store.update((w) => ({
        ...w,
        repositories: w.repositories.map((repository) => ({
          ...repository,
          resources: decode(resourceSettingsSchema, {
            skills: [
              {
                name: 'new-skill',
                description: 'New skill',
                enabled: true,
                content: 'New instructions',
              },
            ],
          }),
        })),
      })),
    () => {
      const defaults = t.s().defaults.get()
      return t.s().defaults.save({
        ...defaults,
        scopedSettings: {
          environment: {
            ...defaults.scopedSettings?.environment,
            resources: {
              skills: [
                {
                  name: 'global-skill',
                  description: 'Global skill',
                  enabled: true,
                  content: 'Global instructions',
                },
              ],
            },
          },
          shared: defaults.scopedSettings?.shared ?? [],
        },
      })
    },
  ]
  for (const change of changes) {
    await t.prepare()
    const input = t.body()
    change()
    const rejected = await t.send(input)
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ mutationRejected: true })
    expect(t.s().jobs.list()).toHaveLength(0)
  }
})

it('rolls back live card memory and every durable row when receipt callback fails after writing', async () => {
  const t = await setup()
  await t.prepare()
  const source = t.s().store.taskSummary(t.sourceId)
  const update = t.s().store.updateTask.bind(t.s().store)
  const failure = vi.spyOn(t.s().store, 'updateTask').mockImplementation((id, fn) => {
    const result = update(id, fn)
    if (id === t.sourceId && t.s().store.taskSummary(id).threadActions?.[0]?.state === 'sent')
      throw new Error('Failure after receipt and live card update')
    return result
  })
  expect((await t.send()).status).toBe(500)
  expect(t.s().store.taskSummary(t.sourceId)).toEqual(source)
  expect(t.s().jobs.list()).toHaveLength(0)
  expect(t.s().db.prepare('SELECT * FROM job_runs').all()).toHaveLength(0)
  expect(t.s().db.prepare('SELECT * FROM deliveries').all()).toHaveLength(0)
  expect(
    t.s().db.prepare("SELECT * FROM documents WHERE id LIKE 'thread-action-final:%'").all(),
  ).toHaveLength(0)
  failure.mockRestore()
  expect((await t.send()).status).toBe(200)
})

it('keeps the original preparing-run ceiling after the source later gains broader access', async () => {
  const t = await setup()
  await t.prepare()
  t.s().store.updateTask(t.sourceId, (task) => ({ ...task, harness: defaultTaskHarness('codex') }))
  t.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((item) => ({
      ...item,
      nodes: item.nodes.map((node) =>
        node.data.kind === 'task'
          ? { ...node, data: { ...node.data, harness: defaultTaskHarness('codex') } }
          : node,
      ),
    })),
  }))
  const refreshed = await t.f.request('/api/thread-actions/review', {
    sourceTaskId: t.sourceId,
    actionId: t.body().actionId,
  })
  expect(refreshed.status).toBe(200)
  const response = await t.send()
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ mutationRejected: true })
  expect(t.s().jobs.list()).toHaveLength(0)
})

it('never copies private Bot instructions, secrets or dormant harness settings into a review', async () => {
  const t = await setup()
  const bot = decode(botResultSchema, await (await t.f.create()).response.json())
  t.s().store.updateTask(bot.id, (task) => ({ ...task, execution: undefined }))
  const update = await t.f.request('/api/bots/update', {
    id: bot.id,
    expectedRevision: bot.bot.revision,
    responsibilities: 'PRIVATE-BOT-INSTRUCTIONS',
    resources: {
      mcpServers: [
        {
          name: 'private',
          enabled: false,
          transport: 'stdio',
          command: 'node',
          envValues: { TOKEN: 'PRIVATE-MCP-SECRET' },
        },
      ],
    },
  })
  expect(update.status).toBe(200)
  const target = flow()
  target.nodes[2].data.botId = bot.id
  target.nodes[2].data.harness = {
    ...defaultTaskHarness('codex'),
    instructions: 'DORMANT-HARNESS-INSTRUCTIONS',
  }
  t.s().store.update((w) => ({ ...w, automations: [target] }))
  await t.prepare()
  const refreshed = await t.f.request('/api/thread-actions/review', {
    sourceTaskId: t.sourceId,
    actionId: t.body().actionId,
  })
  expect(refreshed.status).toBe(200)
  const reviewText = await refreshed.text()
  for (const privateValue of [
    'PRIVATE-BOT-INSTRUCTIONS',
    'PRIVATE-MCP-SECRET',
    'DORMANT-HARNESS-INSTRUCTIONS',
  ]) {
    expect(reviewText).not.toContain(privateValue)
    expect(JSON.stringify(t.card())).not.toContain(privateValue)
  }
  expect(t.card()?.automation?.resources[0].execution).toBe('main')
  const input = t.body()
  const current = t.s().store.taskSummary(bot.id).bot
  if (!current) throw new Error('Expected Bot')
  expect(
    (
      await t.f.request('/api/bots/update', {
        id: bot.id,
        expectedRevision: current.revision,
        responsibilities: 'CHANGED-PRIVATE-BOT-INSTRUCTIONS',
      })
    ).status,
  ).toBe(200)
  const stale = await t.send(input)
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ mutationRejected: true })
})

it('rejects refresh above the combined card budget and retains the previous review and prompt', async () => {
  const t = await setup()
  await t.turn(async (tools) => {
    const prepared = await tools.call('automation_prepare', {
      key: 'automation',
      title: 'Review',
      automationId: 'reviewed-flow',
      prompt: 'p'.repeat(20000),
    })
    expect(prepared.error).toBe(false)
  })
  const before = t.card()
  t.s().store.update((w) => ({
    ...w,
    automations: w.automations.map((item) => ({
      ...item,
      nodes: item.nodes.map((node) =>
        node.data.kind === 'task'
          ? { ...node, data: { ...node.data, objective: 'x'.repeat(46000) } }
          : node,
      ),
    })),
  }))
  const response = await t.f.request('/api/thread-actions/review', {
    sourceTaskId: t.sourceId,
    actionId: t.body().actionId,
  })
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ mutationRejected: true })
  expect(t.card()).toEqual(before)
  expect(t.s().jobs.list()).toHaveLength(0)
})

it('reviews the pending project selector and clears it for explicit node harnesses and agents', async () => {
  const t = await setup()
  const defaults = t.s().defaults.get()
  t.s().defaults.save({
    ...defaults,
    scopedSettings: {
      ...defaults.scopedSettings,
      environment: {
        ...defaults.scopedSettings?.environment,
        taskDefaults: {
          modelSelection: 'smart',
          permission: 'read-only',
          harness: { ...defaultTaskHarness('codex'), model: 'project-default-model' },
        },
      },
      shared: defaults.scopedSettings?.shared ?? [],
    },
  })
  expect(t.s().store.taskDefaults(SCRATCH_PROJECT_ID).modelSelection).toBe('smart')
  const selected = {
    ...defaultTaskHarness('codex'),
    id: 'explicit',
    name: 'Explicit',
    model: 'explicit-model',
    permission: 'read-only' as const,
  }
  for (const mode of ['default', 'harness', 'agent'] as const) {
    const target = flow()
    const node = target.nodes[2].data
    node.harness = mode === 'harness' ? selected : undefined
    node.agentId = mode === 'agent' ? selected.id : ''
    t.s().store.update((w) => ({ ...w, agents: [selected], automations: [target] }))
    // Compare the review against real Tasks.create persistence, without executing the task.
    const created = t.s().tasks.create({
      title: 'Persistence comparison',
      repositoryId: node.repositoryId,
      agentId: node.agentId,
      harness: node.harness,
      objective: node.objective,
    })
    await t.prepare()
    const response = await t.f.request('/api/thread-actions/review', {
      sourceTaskId: t.sourceId,
      actionId: t.body().actionId,
    })
    expect(response.status).toBe(200)
    const review = decode(threadActionResultSchema, await response.json()).action.automation
    expect(review?.resources[0].agent.modelSelection).toBe(created.modelSelection)
    expect(review?.resources[0].agent.modelSelection).toBe(mode === 'default' ? 'smart' : undefined)
    expect(review?.resources[0].agent.permission).toBe('read-only')
    expect(review?.resources[0].agent.model).toBe(
      mode === 'default' ? 'project-default-model' : 'explicit-model',
    )
    expect(t.s().jobs.list()).toHaveLength(0)
  }
  // The same default-only workflow must also pass real Jobs.start validation.
  const defaultFlow = flow()
  defaultFlow.nodes[2].data.harness = undefined
  t.s().store.update((w) => ({ ...w, automations: [defaultFlow] }))
  await t.prepare()
  const started = await t.send()
  expect(started.status).toBe(200)
  const receipt = decode(threadActionResultSchema, await started.json()).action
  expect(receipt.automation?.resources[0].agent.modelSelection).toBe('smart')
  await waitForRuntime(() =>
    expect(t.s().jobs.detail(receipt.automationSent!.runId).status).toBe('waiting'),
  )
})

it('reviews Bot first-turn modes but keeps a started Bot on its persisted concrete model', async () => {
  const t = await setup()
  const bot = decode(
    botResultSchema,
    await (
      await t.f.create({
        ...t.f.draft(),
        modelSelection: 'auto',
        harness: {
          ...defaultTaskHarness('codex'),
          model: 'saved-bot-model',
          permission: 'read-only',
        },
      })
    ).response.json(),
  )
  const target = flow()
  target.nodes[2].data.botId = bot.id
  t.s().store.update((w) => ({ ...w, automations: [target] }))
  for (const mode of ['auto', 'smart', 'inherit'] as const) {
    t.s().store.updateTask(bot.id, (task) => ({ ...task, modelSelection: mode }))
    await t.prepare()
    expect(t.card()?.automation?.resources[0].agent).toMatchObject({
      modelSelection: mode,
      permission: 'read-only',
    })
  }
  const firstReview = t.body()
  // Simulate selection's persisted result, then run a real first turn through the scripted provider.
  t.s().store.updateTask(bot.id, (task) => ({ ...task, modelSelection: undefined }))
  expect(
    (
      await t.f.request('/api/tasks/message', {
        id: bot.id,
        messageId: randomUUID(),
        text: 'First Bot turn',
      })
    ).status,
  ).toBe(200)
  await waitForRuntime(() => expect(t.s().store.taskSummary(bot.id).status).toBe('review'))
  expect(t.s().store.taskSummary(bot.id).history?.turns).toBe(1)
  expect((await t.send(firstReview)).status).toBe(409)
  // Old saved selector metadata must not turn a resumed Bot into a fresh selection.
  t.s().store.updateTask(bot.id, (task) => ({ ...task, modelSelection: 'auto' }))
  await t.prepare()
  expect(t.card()?.automation?.resources[0].agent.modelSelection).toBeUndefined()
  expect(t.card()?.automation?.resources[0].agent.model).toBe('saved-bot-model')
  const fresh = decode(botResultSchema, await (await t.f.create()).response.json())
  t.s().store.updateTask(fresh.id, (task) => ({
    ...task,
    modelSelection: 'smart',
    sessionId: 'existing-session',
  }))
  target.nodes[2].data.botId = fresh.id
  t.s().store.update((w) => ({ ...w, automations: [target] }))
  await t.prepare()
  expect(t.card()?.automation?.resources[0].agent.modelSelection).toBeUndefined()
})

it('pages the complete safe workflow catalog within count and UTF-8 response budgets', async () => {
  const t = await setup()
  const catalog = Array.from({ length: 107 }, (_, index) => ({
    ...flow(`flow-${String(index).padStart(3, '0')}`),
    name: `Workflow ${index}`,
    enabled: index % 2 === 0,
  }))
  // Store in reverse order to verify stable ID ordering across pages.
  t.s().store.update((w) => ({ ...w, automations: [...catalog].reverse() }))
  await t.turn(async (tools) => {
    const first = await tools.call('automation_list', {})
    expect(first.error).toBe(false)
    const page = decode(automationListResultSchema, JSON.parse(first.text))
    expect(page.automations).toHaveLength(100)
    expect(page.nextCursor).toBeTruthy()
    const last = await tools.call('automation_list', { cursor: page.nextCursor })
    const rest = decode(automationListResultSchema, JSON.parse(last.text))
    expect(rest.automations).toHaveLength(7)
    expect(rest.nextCursor).toBeUndefined()
    expect([...page.automations, ...rest.automations]).toEqual(
      catalog.map(({ id, name, enabled }) => ({ id, name, enabled })),
    )
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: 'invalid' }]) {
      expect((await tools.call('automation_list', args)).error).toBe(true)
    }
    const small = await tools.call('automation_list', { limit: 3 })
    expect(decode(automationListResultSchema, JSON.parse(small.text)).automations).toHaveLength(3)
    // Renames invalidate a cursor instead of silently skipping or repeating workflows.
    t.s().store.update((w) => ({
      ...w,
      automations: w.automations.map((item) => ({ ...item, name: 'Renamed' })),
    }))
    const stale = await tools.call('automation_list', { cursor: page.nextCursor })
    expect(stale.error).toBe(true)
    expect(stale.text).toContain('catalog changed')
    // Escaped control characters force the byte limit before the 100-row limit.
    t.s().store.update((w) => ({
      ...w,
      automations: w.automations.map((item) => ({ ...item, name: '\u0001'.repeat(5000) })),
    }))
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const result = await tools.call('automation_list', cursor ? { cursor } : {})
      expect(result.error).toBe(false)
      expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(automationListByteBudget)
      const current = decode(automationListResultSchema, JSON.parse(result.text))
      expect(current.automations.length).toBeGreaterThan(0)
      expect(current.automations.length).toBeLessThan(100)
      for (const summary of current.automations) {
        expect(Object.keys(summary).sort()).toEqual(['enabled', 'id', 'name'])
        expect(summary.name.length).toBeLessThanOrEqual(200)
      }
      ids.push(...current.automations.map((item) => item.id))
      cursor = current.nextCursor
    } while (cursor)
    expect(ids).toEqual(catalog.map((item) => item.id))
    expect(t.s().jobs.list()).toHaveLength(0)
  })
})
