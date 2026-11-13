import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import {
  botPausedMessage,
  botResultSchema,
  decode,
  defaultTaskHarness,
  memoryListSchema,
  snapshotSchema,
  type Automation,
  type AutomationData,
} from '@dovo/protocol'
import { waitForRuntime } from '../../testing/integration'
import { botTestToken, setupBotRuntime } from '../../testing/bots'
import { inactiveTaskIds } from '../../agents/tasks/housekeeping'

const token = botTestToken
const setup = setupBotRuntime

it('creates one Bot thread idempotently and keeps it across restart', async () => {
  const f = await setup()
  const snapshot = decode(
    snapshotSchema,
    await (await f.request('/api/snapshot', undefined, 'GET')).json(),
  )
  expect(snapshot.botsSupported).toBe(true)

  const first = await f.create()
  expect(first.response.status).toBe(200)
  const created = decode(botResultSchema, await first.response.json())
  expect(created.id).toBe(first.task.id)
  expect(created.bot).toMatchObject({ role: 'Release manager', state: 'active' })

  // Same request again (lost response): same Bot, no second thread.
  const again = await f.create(first.task, first.requestId)
  expect(again.response.status).toBe(200)
  expect(decode(botResultSchema, await again.response.json()).bot).toEqual(created.bot)
  // Another body for the same thread is rejected and preserves the original.
  const conflicting = await f.request('/api/bots/create', {
    requestId: first.requestId,
    createTask: first.task,
    role: 'Someone else',
    responsibilities: '',
  })
  expect(conflicting.status).toBe(409)
  expect(f.runtime.services.store.get().tasks.filter((task) => task.bot)).toHaveLength(1)

  await f.restart()
  expect(f.runtime.services.store.taskSummary(created.id).bot).toEqual(created.bot)
  // The idempotent replay still holds after restart.
  const replay = await f.create(first.task, first.requestId)
  expect(replay.response.status).toBe(200)
})

it('replays durable receipts for Bot mutations', async () => {
  const f = await setup()
  const mutationId = randomUUID()
  const first = await f.create(f.draft(), randomUUID(), mutationId)
  const created = decode(botResultSchema, await first.response.json())
  const replay = await f.create(first.task, first.requestId, mutationId)
  expect(decode(botResultSchema, await replay.response.json()).bot).toEqual(created.bot)

  const updateId = randomUUID()
  const update = {
    id: created.id,
    expectedRevision: created.bot.revision,
    responsibilities: 'Watch releases and report blockers.',
  }
  const updated = decode(
    botResultSchema,
    await (await f.request('/api/bots/update', update, 'POST', updateId)).json(),
  )
  const repeated = await f.request('/api/bots/update', update, 'POST', updateId)
  expect(decode(botResultSchema, await repeated.json()).bot).toEqual(updated.bot)
})

it('keeps Bot identity runtime-owned and rejects stale or agent edits', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())

  // Workspace edits cannot create or change Bot identity.
  const patch = await f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: created.id,
      changes: { bot: { before: created.bot, after: { ...created.bot, role: 'Admin' } } },
    },
    'PATCH',
  )
  expect(patch.status).toBe(400)
  const forged = { ...f.draft(), bot: created.bot }
  const create = await f.request(
    '/api/workspace',
    { collection: 'tasks', id: forged.id, create: forged, changes: {} },
    'PATCH',
  )
  expect(create.status).toBe(400)
  // An ordinary edit from an older client leaves the Bot intact.
  const rename = await f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: created.id,
      changes: { title: { before: 'Release helper', after: 'Releases' } },
    },
    'PATCH',
  )
  expect(rename.status).toBe(200)
  expect(f.runtime.services.store.taskSummary(created.id).bot).toEqual(created.bot)

  const update = (expectedRevision: string, role: string) =>
    f.request('/api/bots/update', { id: created.id, expectedRevision, role })
  const changed = await update(created.bot.revision, 'Release captain')
  expect(changed.status).toBe(200)
  const stale = await update(created.bot.revision, 'Release lead')
  expect(stale.status).toBe(409)
  // A stale request whose outcome already holds is a successful replay.
  expect((await update(created.bot.revision, 'Release captain')).status).toBe(200)

  const agent = await fetch(`http://127.0.0.1:${f.runtime.port}/api/bots/update`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-dovo-agent-access': '1',
    },
    body: JSON.stringify({ id: created.id, expectedRevision: created.bot.revision, role: 'x' }),
  })
  expect(agent.status).toBe(403)
  const runToken = f.runtime.services.runCredentials.issue(
    {
      taskId: created.id,
      runId: randomUUID(),
      permissions: { provider: 'codex', permission: 'read-only' },
      readOnly: true,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: ['bot'],
    },
    new AbortController().signal,
  )
  const run = await fetch(`http://127.0.0.1:${f.runtime.port}/api/bots/lifecycle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${runToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.id, action: 'resume' }),
  })
  expect([401, 403]).toContain(run.status)
})

it('holds new turns while paused and releases them on resume', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const paused = await f.request('/api/bots/lifecycle', {
    id: created.id,
    action: 'pause',
    expectedRevision: created.bot.revision,
  })
  const pausedBot = decode(botResultSchema, await paused.json()).bot
  expect(pausedBot.state).toBe('paused')
  // Replaying the same action is safe.
  expect((await f.request('/api/bots/lifecycle', { id: created.id, action: 'pause' })).status).toBe(
    200,
  )
  // A stale lifecycle change is rejected.
  expect(
    (
      await f.request('/api/bots/lifecycle', {
        id: created.id,
        action: 'resume',
        expectedRevision: created.bot.revision,
      })
    ).status,
  ).toBe(409)

  const messageId = randomUUID()
  const sent = await f.request('/api/tasks/message', {
    id: created.id,
    messageId,
    text: 'Check the release',
  })
  expect(sent.status).toBe(200)
  const held = f.runtime.services.store.taskSummary(created.id)
  expect(held.queue?.map((message) => message.id)).toEqual([messageId])
  expect(held.status).not.toBe('running')
  expect(held.error).toBeUndefined()
  expect(f.runtime.run).not.toHaveBeenCalled()
  const resumeDirect = await f.request('/api/tasks/run', { id: created.id })
  expect(resumeDirect.status).toBe(409)
  expect(await resumeDirect.text()).toContain(botPausedMessage)

  // Pause survives restart.
  await f.restart()
  expect(f.runtime.services.store.taskSummary(created.id).bot?.state).toBe('paused')
  expect(f.runtime.services.store.taskSummary(created.id).queue).toHaveLength(1)

  const resumed = await f.request('/api/bots/lifecycle', {
    id: created.id,
    action: 'resume',
    expectedRevision: pausedBot.revision,
  })
  expect(resumed.status).toBe(200)
  await waitForRuntime(() => {
    expect(f.runtime.services.store.task(created.id).messages.map((m) => m.id)).toContain(messageId)
    expect(f.runtime.services.store.taskSummary(created.id).status).toBe('review')
  })
  expect(f.runtime.run).toHaveBeenCalledTimes(1)
  expect(f.prompts.at(-1)).toContain('You are a persistent Dovo Bot')
  expect(f.prompts.at(-1)).toContain('Watch releases.')
  // A Bot's name is not replaced by generated titles.
  expect(f.runtime.services.store.taskSummary(created.id).title).toBe('Release helper')
})

it('scopes private Bot memory to its coordinator thread and deletes it with the Bot', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const other = f.draft()
  await f.request(
    '/api/workspace',
    { collection: 'tasks', id: other.id, create: other, changes: {} },
    'PATCH',
  )
  const memory = f.runtime.services.memory
  expect(memory.availableScopes(created.id)).toEqual(['bot'])
  expect(memory.availableScopes(other.id)).toEqual([])
  expect(memory.agentScope(created.id, 'bot')).toEqual({ scope: 'bot', botId: created.id })
  expect(() => memory.agentScope(other.id, 'bot')).toThrow(/disabled or unavailable/)

  const write = await f.request('/api/memory/write', {
    scope: 'bot',
    botId: created.id,
    key: 'release cadence',
    content: 'Weekly on Tuesday',
  })
  expect(write.status).toBe(200)
  expect(
    (
      await f.request('/api/memory/write', {
        scope: 'bot',
        botId: other.id,
        key: 'k',
        content: 'v',
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await f.request('/api/memory/settings/save', {
        scope: 'bot',
        botId: created.id,
        enabled: false,
      })
    ).status,
  ).toBe(400)
  const listed = decode(
    memoryListSchema,
    await (await f.request('/api/memory/list', { scope: 'bot', botId: created.id })).json(),
  )
  expect(listed.entries).toMatchObject([{ key: 'release cadence', botId: created.id }])
  // Other scopes never see Bot notes.
  memory.configure({ scope: 'projectless', enabled: true })
  expect(memory.list({ scope: 'projectless' }).total).toBe(0)

  await f.restart()
  expect(f.runtime.services.memory.list({ scope: 'bot', botId: created.id }).total).toBe(1)
  const flow = routine(created.id)
  f.runtime.services.store.update((workspace) => ({ ...workspace, automations: [flow] }))
  const deletion = { id: created.id, action: 'delete', removeWorktrees: false }
  expect((await f.request('/api/tasks/lifecycle', deletion)).status).toBe(200)
  expect(f.runtime.services.memory.list({ scope: 'bot', botId: created.id }).total).toBe(0)
  expect(f.runtime.services.store.get().tasks.some((task) => task.id === created.id)).toBe(false)
  expect(f.runtime.services.store.get().tasks.some((task) => task.id === other.id)).toBe(true)
  expect(f.runtime.services.store.get().automations).toEqual([flow])
  expect(() => f.runtime.services.jobs.start(flow.id)).toThrow(/Choose an available Bot/)
  // Deletion is safe to retry after a lost response, also across restart.
  await f.restart()
  expect((await f.request('/api/tasks/lifecycle', deletion)).status).toBe(200)
})

it('never selects Bots for inactivity settling or archiving', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const tasks = f.runtime.services.store.get().tasks
  const later = Date.now() + 400 * 86_400_000
  expect(inactiveTaskIds(tasks, 1, later, () => false)).not.toContain(created.id)
})

function routine(botId: string): Automation {
  const base: AutomationData = {
    kind: 'trigger',
    label: 'Daily check',
    trigger: 'manual',
    schedule: '',
    timezone: 'UTC',
    objective: 'Run the daily release check',
    agentId: '',
    repositoryId: '',
  }
  return {
    id: 'routine',
    name: 'Daily check',
    nodes: [
      { id: 'trigger', type: 'automation', position: { x: 0, y: 0 }, data: base },
      {
        id: 'task',
        type: 'automation',
        position: { x: 100, y: 0 },
        data: { ...base, kind: 'task', botId },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
}

it('runs a routine in the Bot thread with the Bot settings', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, automations: [routine(created.id)] }))
  const threads = s.store.get().tasks.length
  const id = s.jobs.start('routine')
  await waitForRuntime(() => expect(s.jobs.detail(id).status).toBe('completed'))
  expect(s.store.get().tasks).toHaveLength(threads)
  expect(s.jobs.detail(id).steps?.find((step) => step.nodeId === 'task')?.taskId).toBe(created.id)
  const message = s.store
    .task(created.id)
    .messages.find((item) => item.text === 'Run the daily release check')
  expect(message?.source).toMatchObject({ kind: 'automation', automationId: 'routine', runId: id })
  expect(f.prompts.at(-1)).toContain('You are a persistent Dovo Bot')

  // A retry of a completed step never sends the routine message twice.
  expect(
    s.store.task(created.id).messages.filter((item) => item.text === 'Run the daily release check'),
  ).toHaveLength(1)
})

it('fails a routine for a paused Bot without queueing work, and rejects missing Bots', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  await f.request('/api/bots/lifecycle', { id: created.id, action: 'pause' })
  s.store.update((workspace) => ({ ...workspace, automations: [routine(created.id)] }))
  const id = s.jobs.start('routine')
  await waitForRuntime(() => expect(s.jobs.detail(id).status).toBe('failed'))
  expect(s.jobs.detail(id).error).toBe(botPausedMessage)
  expect(s.store.taskSummary(created.id).queue ?? []).toHaveLength(0)
  expect(f.runtime.run).not.toHaveBeenCalled()

  // Resume, then Retry runs the routine once.
  await f.request('/api/bots/lifecycle', { id: created.id, action: 'resume' })
  s.jobs.retry(id)
  await waitForRuntime(() => expect(s.jobs.detail(id).status).toBe('completed'))
  expect(f.runtime.run).toHaveBeenCalledTimes(1)

  s.store.update((workspace) => ({ ...workspace, automations: [routine(randomUUID())] }))
  expect(() => s.jobs.start('routine')).toThrow(/Choose an available Bot/)
})

it('sends a routine again on Retry after its Bot turn failed', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  s.store.update((workspace) => ({ ...workspace, automations: [routine(created.id)] }))
  f.runtime.run.mockImplementationOnce(async () => {
    throw new Error('Provider unavailable')
  })
  const id = s.jobs.start('routine')
  await waitForRuntime(() => expect(s.jobs.detail(id).status).toBe('failed'))
  s.jobs.retry(id)
  await waitForRuntime(() => expect(s.jobs.detail(id).status).toBe('completed'))
  expect(
    s.store.task(created.id).messages.filter((item) => item.text === 'Run the daily release check'),
  ).toHaveLength(2)
  expect(f.runtime.run).toHaveBeenCalledTimes(2)
})

it('keeps generic client paths from creating Bots or starting a paused Bot', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services

  // A thread start cannot carry Bot identity.
  const forged = { ...f.draft(), bot: created.bot }
  const start = await f.request('/api/tasks/message', {
    id: forged.id,
    messageId: randomUUID(),
    text: 'Hello',
    createTask: forged,
  })
  expect(start.status).toBe(400)
  expect(s.store.get().tasks.some((task) => task.id === forged.id)).toBe(false)

  // Generic edits keep working without touching Bot identity.
  const harness = { ...defaultTaskHarness('codex'), permission: 'read-only' as const }
  const edit = await f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: created.id,
      changes: {
        harness: { before: s.store.taskSummary(created.id).harness ?? null, after: harness },
      },
    },
    'PATCH',
  )
  expect(edit.status).toBe(200)
  expect(s.store.taskSummary(created.id).harness?.permission).toBe('read-only')
  expect(s.store.taskSummary(created.id).bot).toEqual(created.bot)

  // One completed turn, then pause.
  await f.request('/api/tasks/message', { id: created.id, messageId: randomUUID(), text: 'Hi' })
  await waitForRuntime(() => expect(s.store.taskSummary(created.id).status).toBe('review'))
  await f.request('/api/bots/lifecycle', { id: created.id, action: 'pause' })
  const calls = f.runtime.run.mock.calls.length

  const turnId = s.store.task(created.id).turns?.at(-1)?.id
  const retry = await f.request('/api/tasks/retry', { id: created.id, turnId })
  expect(retry.status).toBe(409)
  expect(await retry.text()).toContain(botPausedMessage)

  const queued = randomUUID()
  await f.request('/api/tasks/message', { id: created.id, messageId: queued, text: 'Later' })
  const resume = await f.request('/api/tasks/queue', { id: created.id, action: 'resume' })
  expect(resume.status).toBe(409)
  expect(await resume.text()).toContain(botPausedMessage)
  expect((await f.request('/api/tasks/run', { id: created.id })).status).toBe(409)

  // Scheduled messages wait while paused.
  s.store.updateTask(created.id, (task) => ({
    ...task,
    scheduledMessages: [{ id: randomUUID(), text: 'Scheduled', at: new Date(0).toISOString() }],
  }))
  await s.tasks.runScheduled()
  expect(s.store.taskSummary(created.id).scheduledMessages).toHaveLength(1)
  expect(s.store.taskSummary(created.id).scheduledMessages?.[0]?.failed).toBeUndefined()
  expect(f.runtime.run.mock.calls.length).toBe(calls)
  expect(s.store.taskSummary(created.id).queue?.map((item) => item.id)).toEqual([queued])
})

it('rejects settling, snoozing and archiving Bots while allowing pinning', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const task = f.runtime.services.store.taskSummary(created.id)
  for (const [key, after] of [
    ['archived', true],
    ['archivedAt', '2026-11-13T12:00:00Z'],
    ['snoozedUntil', '2026-11-14T12:00:00Z'],
    ['settleBehavior', { settleInactive: true, inactiveDays: 3 }],
    ['archiveAfterSettledDays', 1],
  ] as const) {
    expect(
      (
        await f.request(
          '/api/workspace',
          {
            collection: 'tasks',
            id: created.id,
            changes: { [key]: { before: null, after } },
          },
          'PATCH',
        )
      ).status,
    ).toBe(400)
  }
  expect(
    (await f.request('/api/tasks/lifecycle', { id: created.id, action: 'archive' })).status,
  ).toBe(400)
  expect(f.runtime.services.store.taskSummary(created.id).archivedAt).toBeUndefined()
  expect(
    (
      await f.request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: created.id,
          changes: { pinned: { before: task.pinned ?? null, after: true } },
        },
        'PATCH',
      )
    ).status,
  ).toBe(200)
  expect(f.runtime.services.store.taskSummary(created.id).pinned).toBe(true)
})

it('keeps Bots standalone and named by people only', async () => {
  const f = await setup()
  const s = f.runtime.services
  const inProject = await f.create({ ...f.draft(), repositoryId: 'repo' })
  expect(inProject.response.status).toBe(400)
  expect(s.store.get().tasks.some((task) => task.id === inProject.task.id)).toBe(false)

  for (const forged of [
    { execution: 'worktree' as const },
    { setupCommand: 'pnpm install' },
    { autoProject: true },
  ])
    expect((await f.create({ ...f.draft(), ...forged })).response.status).toBe(400)

  const created = decode(botResultSchema, await (await f.create()).response.json())
  for (const [key, after] of [
    ['execution', 'worktree'],
    ['autoProject', true],
    ['setupCommand', 'pnpm install'],
  ] as const)
    expect(
      (
        await f.request(
          '/api/workspace',
          { collection: 'tasks', id: created.id, changes: { [key]: { before: null, after } } },
          'PATCH',
        )
      ).status,
    ).toBe(400)
  const move = await f.request(
    '/api/workspace',
    {
      collection: 'tasks',
      id: created.id,
      changes: {
        repositoryId: { before: s.store.taskSummary(created.id).repositoryId, after: 'repo' },
      },
    },
    'PATCH',
  )
  expect(move.status).toBe(400)

  // A client's automatic first-message title and project selection do not apply to a Bot.
  const messageId = randomUUID()
  const sent = await f.request('/api/tasks/message', {
    id: created.id,
    messageId,
    text: 'Check the release plan for this local verification.',
    initialTitle: { before: 'Release helper', after: 'Check the release plan' },
    selectProject: true,
  })
  expect(sent.status).toBe(200)
  await waitForRuntime(() => expect(s.store.taskSummary(created.id).status).toBe('review'))
  expect(s.store.taskSummary(created.id).title).toBe('Release helper')
  expect(s.store.taskSummary(created.id).repositoryId).toBe('dovo:scratch')

  // Normal threads keep the automatic first-message title.
  const normal = f.draft()
  await f.request('/api/tasks/message', {
    id: normal.id,
    messageId: randomUUID(),
    text: 'Plain thread',
    createTask: normal,
    initialTitle: { before: normal.title, after: 'Plain thread' },
  })
  expect(s.store.taskSummary(normal.id).title).toBe('Plain thread')
})

it('keeps the Bot while a delegated worker has no confirmed completion', async () => {
  const f = await setup()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  f.runtime.services.threadWatch.watch(
    created.id,
    'remote',
    'child',
    'Mac',
    undefined,
    'spawned',
    true,
  )
  const deletion = { id: created.id, action: 'delete', removeWorktrees: false }
  expect((await f.request('/api/tasks/lifecycle', deletion)).status).toBe(409)
  expect(f.runtime.services.store.task(created.id).bot).toBeDefined()
  f.runtime.services.threadWatch.stop(created.id, 'remote', 'child')
  expect((await f.request('/api/tasks/lifecycle', deletion)).status).toBe(200)
})
