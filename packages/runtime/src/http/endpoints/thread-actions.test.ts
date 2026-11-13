import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  botResultSchema,
  decode,
  defaultTaskHarness,
  mutableStruct,
  snapshotSchema,
  taskResources,
  threadActionResultSchema,
  type Task,
} from '@dovo/protocol'
import { HttpError } from '../../errors'
import { fixture } from '../../testing/fixture'
import { waitForRuntime } from '../../testing/integration'
import { botTestToken, setupBotRuntime, type BotRunInput } from '../../testing/bots'

/** Calls the real dovo_task MCP server of a running turn, as a harness would. */
async function taskTools(input: BotRunInput) {
  const config = input.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
  if (!config) throw new Error('Expected dovo_task tools')
  const client = new Client({ name: 'thread-actions-test', version: '1' })
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
    async call(name: string, args: Record<string, unknown>) {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
      const block = result.content.find((part) => part.type === 'text')
      return {
        error: result.isError === true,
        text: block?.type === 'text' ? block.text : '',
      }
    },
    close: async () => {
      await client.close()
      await transport.close()
    },
  }
}

async function setup() {
  const f = await setupBotRuntime()
  const s = () => f.runtime.services
  // The source is a Bot with private resources and memory; dispatched threads get neither.
  const source = decode(botResultSchema, await (await f.create()).response.json())
  await f.request('/api/bots/update', {
    id: source.id,
    expectedRevision: source.bot.revision,
    resources: {
      skills: [{ name: 'bot-only', description: 'Bot only', enabled: true, content: 'BOT-ONLY' }],
    },
  })
  const tool: Array<(tools: Awaited<ReturnType<typeof taskTools>>) => Promise<void>> = []
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession('provider-session')
    const step = input.prompt.includes('PREPARE') ? tool.shift() : undefined
    if (step) {
      const tools = await taskTools(input)
      try {
        await step(tools)
      } finally {
        await tools.close()
      }
    }
    input.onText('Done')
  })
  const turn = async (text: string, step: (typeof tool)[number]) => {
    tool.push(step)
    await f.request('/api/tasks/message', { id: source.id, messageId: randomUUID(), text })
    await waitForRuntime(() => {
      expect(tool).toHaveLength(0)
      expect(s().store.taskSummary(source.id).status).toBe('review')
    })
  }
  const draft = (): Task => ({ ...f.draft(), title: 'Fix flaky test' })
  const send = (
    actionId: string,
    createTask: Task,
    messageId = randomUUID(),
    mutationId?: string,
    text = 'Edited: fix the flaky test',
  ) =>
    f.request(
      '/api/thread-actions/send',
      { sourceTaskId: source.id, actionId, messageId, createTask, text },
      'POST',
      mutationId,
    )
  return { f, s, source, turn, draft, send }
}

const actions = (t: Awaited<ReturnType<typeof setup>>) =>
  t.s().store.taskSummary(t.source.id).threadActions ?? []

it('lets an agent prepare cards that start nothing and only a person can send', async () => {
  const t = await setup()
  const threads = t.s().store.get().tasks.length
  let prepared = ''
  await t.turn('PREPARE cards', async (tools) => {
    const first = await tools.call('thread_prepare', {
      key: 'flaky',
      title: 'Fix flaky test',
      prompt: 'Fix the flaky test',
      provider: 'codex',
      model: 'gpt-5.5',
    })
    expect(first.error).toBe(false)
    prepared = JSON.parse(first.text).id
    // Same key replaces the unsent card.
    await tools.call('thread_prepare', {
      key: 'flaky',
      title: 'Fix flaky test',
      prompt: 'Fix the flaky test in CI',
    })
    await tools.call('thread_prepare', { key: 'docs', title: 'Docs', prompt: 'Write docs' })
    await tools.call('thread_prepare', { key: 'wide', title: 'Wide', prompt: 'Needs access' })
    const unknown = await tools.call('thread_prepare', {
      key: 'bad',
      title: 'Bad',
      prompt: 'x',
      agentId: 'missing-agent',
    })
    expect(unknown.error).toBe(true)
    // Raw HTTP is bound to this run and thread; humans and other threads cannot prepare.
    const prepare = (token: string, body: unknown) =>
      fetch(`http://127.0.0.1:${t.f.runtime.port}/api/agent/thread-prepare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const command = { key: 'raw', title: 'Raw', prompt: 'Raw' }
    expect(
      (
        await prepare(tools.credential.token, {
          taskId: 'other',
          parentRunId: tools.credential.runId,
          command,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await prepare(botTestToken, {
          taskId: t.source.id,
          parentRunId: tools.credential.runId,
          command,
        })
      ).status,
    ).toBe(403)
    // A run token cannot send or dismiss.
    const human = await fetch(`http://127.0.0.1:${t.f.runtime.port}/api/thread-actions/dismiss`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tools.credential.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sourceTaskId: t.source.id, actionId: prepared }),
    })
    expect([401, 403]).toContain(human.status)
  })
  expect(t.s().store.get().tasks).toHaveLength(threads)
  expect(actions(t).map((item) => [item.key, item.state, item.prompt])).toEqual([
    ['flaky', 'prepared', 'Fix the flaky test in CI'],
    ['docs', 'prepared', 'Write docs'],
    ['wide', 'prepared', 'Needs access'],
  ])
  // The card anchors to the turn that prepared it.
  const history = t.s().store.task(t.source.id)
  const anchor = actions(t)[0].runId
  expect(history.messages.some((message) => message.turnId === anchor)).toBe(true)
  const snapshot = decode(
    snapshotSchema,
    await (await t.f.request('/api/snapshot', undefined, 'GET')).json(),
  )
  expect(snapshot.threadActionsSupported).toBe(true)
  // Generic workspace edits cannot add or change actions.
  const patch = await t.f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: t.source.id,
      changes: { threadActions: { before: actions(t), after: [] } },
    },
    'PATCH',
  )
  expect(patch.status).toBe(400)

  // Dismissed is a final human decision, also after the agent prepares the same key again.
  const docs = actions(t)[1].id
  const dismissed = await t.f.request('/api/thread-actions/dismiss', {
    sourceTaskId: t.source.id,
    actionId: docs,
  })
  expect(decode(threadActionResultSchema, await dismissed.json()).action.state).toBe('dismissed')
  await t.turn('PREPARE again', async (tools) => {
    const again = await tools.call('thread_prepare', {
      key: 'docs',
      title: 'Docs',
      prompt: 'Write docs now',
    })
    expect(JSON.parse(again.text).state).toBe('dismissed')
  })
  expect(actions(t)[1]).toMatchObject({ state: 'dismissed', prompt: 'Write docs' })
  expect((await t.send(docs, t.draft())).status).toBe(409)

  // Scope and access checks keep a rejected card editable.
  const wide = actions(t)[2].id
  expect((await t.send(wide, { ...t.draft(), repositoryId: 'another-project' })).status).toBe(409)
  const narrowSource = await t.f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: t.source.id,
      changes: {
        harness: {
          before: t.s().store.taskSummary(t.source.id).harness ?? null,
          after: { ...defaultTaskHarness('codex'), permission: 'read-only' },
        },
      },
    },
    'PATCH',
  )
  expect(narrowSource.status).toBe(200)
  const broader = await t.send(wide, {
    ...t.draft(),
    harness: { ...defaultTaskHarness('codex'), permission: 'full-access' },
  })
  expect(broader.status).toBe(403)
  expect(actions(t)[2].state).toBe('prepared')
  // A first-turn harness override cannot widen access either.
  const override = await t.f.request('/api/thread-actions/send', {
    sourceTaskId: t.source.id,
    actionId: wide,
    messageId: randomUUID(),
    createTask: {
      ...t.draft(),
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    },
    text: 'Override',
    turnSettings: {
      provider: 'codex',
      model: defaultTaskHarness('codex').model,
      reasoning: '',
      harness: { ...defaultTaskHarness('codex'), permission: 'full-access' },
    },
  })
  expect(override.status).toBe(403)
  const narrow = await t.send(wide, {
    ...t.draft(),
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
  })
  expect(narrow.status).toBe(200)
  expect(t.s().store.get().tasks).toHaveLength(threads + 1)
})

it('sends once across lost acknowledgements, double taps, interrupted delivery and restart', async () => {
  const t = await setup()
  await t.turn('PREPARE one', async (tools) => {
    await tools.call('thread_prepare', {
      key: 'flaky',
      title: 'Fix flaky test',
      prompt: 'Fix the flaky test',
    })
  })
  const action = actions(t)[0].id
  const threads = t.s().store.get().tasks.length
  const createTask = t.draft()
  const messageId = randomUUID()

  // The thread, its queued first message and the sent state commit together; then starting
  // the turn fails. The reviewed message is never lost.
  vi.spyOn(t.s().tasks, 'startEffect').mockReturnValueOnce(
    Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.')),
  )
  const interrupted = await t.send(action, createTask, messageId, randomUUID())
  expect(interrupted.status).toBe(503)
  expect(actions(t)[0]).toMatchObject({ state: 'sent', sent: { taskId: createTask.id } })
  expect(
    t
      .s()
      .store.taskSummary(createTask.id)
      .queue?.map((item) => item.id),
  ).toEqual([messageId])

  // A retry with the same body starts it once.
  const mutationId = randomUUID()
  const retried = await t.send(action, createTask, messageId, mutationId)
  expect(retried.status).toBe(200)
  const result = decode(threadActionResultSchema, await retried.json())
  expect(result.action.sent).toMatchObject({ taskId: createTask.id, messageId })
  await waitForRuntime(() => expect(t.s().store.taskSummary(createTask.id).status).toBe('review'))
  expect(t.f.inputs.some((input) => input.prompt.includes('Edited: fix the flaky test'))).toBe(true)
  // The dispatched worker gets ordinary resources and no Bot memory or Bot identity.
  const worker = t.s().store.taskSummary(createTask.id)
  expect(worker.bot).toBeUndefined()
  expect(
    taskResources(worker, t.s().store.get(), t.s().defaults.get()).skills.map((item) => item.name),
  ).not.toContain('bot-only')
  expect(t.s().memory.availableScopes(createTask.id)).not.toContain('bot')
  const workerRun = t.f.inputs.find((input) => input.prompt.includes('Edited: fix the flaky'))
  expect(workerRun?.agent.resources?.skills.map((item) => item.name)).not.toContain('bot-only')

  // Lost acknowledgement, double tap from another device, and a restart: no second thread.
  expect((await t.send(action, createTask, messageId, mutationId)).status).toBe(200)
  const other = await t.send(action, t.draft())
  expect(decode(threadActionResultSchema, await other.json()).action.sent?.taskId).toBe(
    createTask.id,
  )
  await t.f.restart()
  const afterRestart = await t.send(action, t.draft())
  expect(decode(threadActionResultSchema, await afterRestart.json()).action).toMatchObject({
    state: 'sent',
    sent: { taskId: createTask.id },
  })
  // Dismiss leaves a sent action sent.
  const dismiss = await t.f.request('/api/thread-actions/dismiss', {
    sourceTaskId: t.source.id,
    actionId: action,
  })
  expect(decode(threadActionResultSchema, await dismiss.json()).action.state).toBe('sent')
  expect(t.f.runtime.services.store.get().tasks).toHaveLength(threads + 1)
  expect(
    t.f.runtime.services.store
      .task(createTask.id)
      .messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1)
})

it('starts exactly one thread when two sends race', async () => {
  const t = await setup()
  await t.turn('PREPARE one', async (tools) => {
    await tools.call('thread_prepare', { key: 'race', title: 'Race', prompt: 'Race' })
  })
  const action = actions(t)[0].id
  const threads = t.s().store.get().tasks.length
  const [one, two] = await Promise.all([t.send(action, t.draft()), t.send(action, t.draft())])
  const ids = await Promise.all(
    [one, two].map(async (response) => {
      expect(response.status).toBe(200)
      return decode(threadActionResultSchema, await response.json()).action.sent?.taskId
    }),
  )
  expect(ids[0]).toBe(ids[1])
  expect(t.s().store.get().tasks).toHaveLength(threads + 1)
})

it('keeps a committed first message queued across a restart', async () => {
  const t = await setup()
  await t.turn('PREPARE one', async (tools) => {
    await tools.call('thread_prepare', { key: 'boot', title: 'Boot', prompt: 'Boot' })
  })
  const action = actions(t)[0].id
  const createTask = t.draft()
  vi.spyOn(t.s().tasks, 'startEffect').mockReturnValueOnce(
    Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.')),
  )
  expect((await t.send(action, createTask)).status).toBe(503)
  await t.f.restart()
  // Like any queued input after a restart, it waits visibly for the person to resume it.
  const held = t.s().store.taskSummary(createTask.id)
  expect(held.queue?.map((item) => item.text)).toEqual(['Edited: fix the flaky test'])
  expect(actions(t)[0].sent?.taskId).toBe(createTask.id)
  await t.f.request('/api/tasks/queue', { id: createTask.id, action: 'resume' })
  await waitForRuntime(() => expect(t.s().store.taskSummary(createTask.id).status).toBe('review'))
  expect(
    t
      .s()
      .store.task(createTask.id)
      .messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1)
})

it('keeps decisions after cards are evicted and bounds unsent prompt bytes', async () => {
  const t = await setup()
  await t.turn('PREPARE first', async (tools) => {
    await tools.call('thread_prepare', { key: 'old-dismissed', title: 'Old', prompt: 'Old' })
    await tools.call('thread_prepare', { key: 'old-sent', title: 'Sent', prompt: 'Sent' })
  })
  const [dismissedId, sentId] = actions(t).map((item) => item.id)
  await t.f.request('/api/thread-actions/dismiss', {
    sourceTaskId: t.source.id,
    actionId: dismissedId,
  })
  const sentTask = t.draft()
  expect((await t.send(sentId, sentTask)).status).toBe(200)
  await t.turn('PREPARE many', async (tools) => {
    for (let index = 0; index < 20; index++) {
      const prepared = await tools.call('thread_prepare', {
        key: `card-${index}`,
        title: `Card ${index}`,
        prompt: `Prompt ${index}`,
      })
      expect(prepared.error).toBe(false)
    }
    // All 20 cards are unsent now; a 21st is refused rather than dropping one.
    expect(
      (await tools.call('thread_prepare', { key: 'overflow', title: 'Over', prompt: 'x' })).error,
    ).toBe(true)
    // Evicted decisions stay final for the same key.
    const again = await tools.call('thread_prepare', {
      key: 'old-dismissed',
      title: 'Old',
      prompt: 'Old again',
    })
    expect(JSON.parse(again.text).state).toBe('dismissed')
    const sentAgain = await tools.call('thread_prepare', {
      key: 'old-sent',
      title: 'Sent',
      prompt: 'Sent again',
    })
    expect(JSON.parse(sentAgain.text)).toMatchObject({
      state: 'sent',
      sent: { taskId: sentTask.id },
    })
  })
  expect(actions(t).map((item) => item.id)).not.toContain(dismissedId)
  expect(actions(t)).toHaveLength(20)
  // An evicted sent action still answers Send with its thread, also after a restart.
  await t.f.restart()
  const replay = await t.send(sentId, t.draft())
  expect(decode(threadActionResultSchema, await replay.json()).action.sent?.taskId).toBe(
    sentTask.id,
  )

  const budget = await setup()
  await budget.turn('PREPARE large', async (tools) => {
    const large = 'é'.repeat(9000) // 18 KB in UTF-8
    for (const key of ['a', 'b', 'c'])
      expect((await tools.call('thread_prepare', { key, title: key, prompt: large })).error).toBe(
        false,
      )
    const over = await tools.call('thread_prepare', { key: 'd', title: 'd', prompt: large })
    expect(over.error).toBe(true)
    expect(over.text).toContain('64 KB')
  })
  expect(actions(budget)).toHaveLength(3)
  // Finished cards also count toward the thread's prompt bytes; the oldest leave first.
  for (const item of actions(budget))
    await budget.f.request('/api/thread-actions/dismiss', {
      sourceTaskId: budget.source.id,
      actionId: item.id,
    })
  await budget.turn('PREPARE more', async (tools) => {
    for (const key of ['e', 'f', 'g'])
      expect(
        (await tools.call('thread_prepare', { key, title: key, prompt: 'ü'.repeat(9000) })).error,
      ).toBe(false)
    expect(
      JSON.parse((await tools.call('thread_prepare', { key: 'a', title: 'a', prompt: 'x' })).text)
        .state,
    ).toBe('dismissed')
  })
  expect(actions(budget).map((item) => item.key)).toEqual(['e', 'f', 'g'])
  const summary = JSON.stringify(budget.s().store.taskSummary(budget.source.id).threadActions)
  expect(Buffer.byteLength(summary, 'utf8')).toBeLessThan(64 * 1024 + 4096)
  // Deleting the source thread removes its retained decisions.
  await t.f.request('/api/tasks/lifecycle', { id: t.source.id, action: 'delete' })
  expect(
    t
      .s()
      .db.prepare("SELECT COUNT(*) AS n FROM documents WHERE id LIKE 'thread-action-final:%'")
      .get(),
  ).toEqual({ n: 0 })
})

it('lets a standalone Bot start a thread in a project on this computer', async () => {
  const t = await setup()
  const project = await fixture()
  t.s().store.update((workspace) => ({
    ...workspace,
    repositories: [...workspace.repositories, ...project.workspace.repositories],
  }))
  await t.turn('PREPARE project', async (tools) => {
    await tools.call('thread_prepare', { key: 'proj', title: 'Fix in repo', prompt: 'Fix it' })
  })
  const createTask = { ...t.draft(), repositoryId: 'repo' }
  const sent = await t.send(actions(t)[0].id, createTask)
  expect(sent.status).toBe(200)
  await waitForRuntime(() => expect(t.s().store.taskSummary(createTask.id).status).toBe('review'))
  expect(t.s().store.taskSummary(createTask.id)).toMatchObject({ repositoryId: 'repo' })
  expect(t.s().store.taskSummary(createTask.id).bot).toBeUndefined()
  await project.cleanup()
})

it('starts exactly the reviewed message on retry when a person queued input ahead of it', async () => {
  const t = await setup()
  await t.turn('PREPARE one', async (tools) => {
    await tools.call('thread_prepare', { key: 'exact', title: 'Exact', prompt: 'Exact' })
  })
  const action = actions(t)[0].id
  const createTask = t.draft()
  const messageId = randomUUID()
  // The commit succeeds, but the turn does not start and the acknowledgement is lost.
  vi.spyOn(t.s().tasks, 'startEffect').mockReturnValueOnce(
    Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.')),
  )
  expect((await t.send(action, createTask, messageId)).status).toBe(503)
  // Meanwhile a person queues another message and moves it ahead.
  const person = randomUUID()
  await t.f.request('/api/tasks/message', {
    id: createTask.id,
    messageId: person,
    text: 'PERSON queued first',
    queueOnly: true,
  })
  const moved = await t.f.request('/api/tasks/queue', {
    id: createTask.id,
    action: 'move',
    messageId: person,
    beforeMessageId: messageId,
  })
  expect(moved.status).toBe(200)
  expect(
    t
      .s()
      .store.taskSummary(createTask.id)
      .queue?.map((item) => item.id),
  ).toEqual([person, messageId])
  // Staging paused the queue, so a retry leaves it with the person.
  expect(t.s().store.taskSummary(createTask.id).queuePaused).toBe(true)
  const held = t.f.inputs.length
  expect((await t.send(action, createTask, messageId)).status).toBe(200)
  expect(t.f.inputs.length).toBe(held)
  // With the queue idle and not paused, the other input is still ahead (any path that leaves
  // it there must not let a retry run it instead of the reviewed message).
  t.s().store.updateTask(createTask.id, (task) => ({ ...task, queuePaused: false }))
  const calls = t.f.inputs.length
  // Retrying the same Send starts the reviewed message, not the person's.
  expect((await t.send(action, createTask, messageId)).status).toBe(200)
  await waitForRuntime(() =>
    expect(t.s().store.taskSummary(createTask.id).status).not.toBe('running'),
  )
  await waitForRuntime(() => expect(t.f.inputs.length).toBe(calls + 1))
  expect(t.f.inputs.at(-1)?.prompt).toContain('Edited: fix the flaky test')
  expect(t.f.inputs.at(-1)?.prompt).not.toContain('PERSON queued first')
  const target = t.s().store.taskSummary(createTask.id)
  expect(target.queue?.map((item) => item.id)).toEqual([person])
  expect(target.queuePaused).toBe(true)
  // A further retry starts nothing.
  expect((await t.send(action, createTask, messageId)).status).toBe(200)
  expect(t.f.inputs.length).toBe(calls + 1)
})

it('leaves a paused target queue with the person on retry', async () => {
  const t = await setup()
  await t.turn('PREPARE one', async (tools) => {
    await tools.call('thread_prepare', { key: 'held', title: 'Held', prompt: 'Held' })
  })
  const action = actions(t)[0].id
  const createTask = t.draft()
  const messageId = randomUUID()
  vi.spyOn(t.s().tasks, 'startEffect').mockReturnValueOnce(
    Effect.fail(new HttpError(503, 'Runtime is restarting. Try again shortly.')),
  )
  expect((await t.send(action, createTask, messageId)).status).toBe(503)
  await t.f.request('/api/tasks/queue', { id: createTask.id, action: 'pause' })
  const calls = t.f.inputs.length
  expect((await t.send(action, createTask, messageId)).status).toBe(200)
  expect(t.f.inputs.length).toBe(calls)
  expect(
    t
      .s()
      .store.taskSummary(createTask.id)
      .queue?.map((item) => item.id),
  ).toEqual([messageId])
})
