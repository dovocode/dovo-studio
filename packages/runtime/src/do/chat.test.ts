import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  DO_CHAT_ORIGIN,
  decode,
  doAgentCommandSchema,
  type DoAgentAction,
  type DoRun,
  type DoSaveRequest,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'
import { HttpError } from '../errors.js'
import { DoChat } from './chat.js'

vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function setup(enabled = true) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: join(f.directory, '.git', 'do-chat.sqlite'),
    ownerToken: 'do-chat-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  if (enabled) s.preferences.save({ enableDo: true })
  s.store.update(() => f.workspace)
  const calls: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (context) => {
      calls.push(context)
      context.onText('Done')
    },
  })
  // Run-token turn scope is enforced by the tasks service; tests act as the active turn.
  const scope = vi.spyOn(s.tasks, 'assertToolScope').mockImplementation(() => undefined)
  const chat = new DoChat(s.db, s)
  const create = (text = 'Ship the feature everywhere', id = randomUUID()) =>
    chat.create({ id, text, repositoryId: 'repo', agentId: 'agent' })
  const tool = (taskId: string, command: DoAgentAction) =>
    chat.command(decode(doAgentCommandSchema, { taskId, parentRunId: 'run-1', command }))
  const idle = (taskId: string) =>
    vi.waitFor(
      () => {
        const task = s.store.taskSummary(taskId)
        expect(s.tasks.hasWorkingFamily(taskId) || !!task.queue?.length).toBe(false)
      },
      { timeout: 15_000, interval: 50 },
    )
  return { s, calls, scope, chat, create, tool, idle }
}
const plan = (id: string = randomUUID()): DoSaveRequest => ({
  id,
  title: 'Ship it',
  goal: 'Implement and verify the feature',
  items: [
    {
      id: 'a',
      title: 'Item a',
      instructions: 'Do a',
      dependsOn: [],
      target: { runtimeId: 'local', repositoryId: 'repo', agentId: 'agent' },
    },
  ],
})
const status = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    if (error instanceof HttpError) return error.status
    throw error
  }
  return 200
}

it('requires the Do preference for chats, proposals and instructions', async () => {
  const f = await setup(false)
  expect(await status(f.create())).toBe(403)
  expect(f.s.store.get().tasks.filter((task) => task.origin === DO_CHAT_ORIGIN)).toEqual([])
  f.s.preferences.save({ enableDo: true })
  const { taskId } = await f.create()
  expect(f.chat.instructions(taskId)).toContain('do_plan')
  f.s.preferences.save({ enableDo: false })
  expect(f.chat.instructions(taskId)).toBeUndefined()
  expect(await status(f.tool(taskId, { action: 'propose', plan: plan() }))).toBe(403)
  expect(await status(f.tool(taskId, { action: 'discover' }))).toBe(403)
})

it('creates one normal thread per request and delivers the first message once', async () => {
  const f = await setup()
  const id = randomUUID()
  const [first, retry] = await Promise.all([
    f.create('Plan the release', id),
    f.create('Plan the release', id),
  ])
  expect(retry.taskId).toBe(first.taskId)
  await f.idle(first.taskId)
  expect((await f.create('Plan the release', id)).taskId).toBe(first.taskId)
  expect(await status(f.create('Something else', id))).toBe(409)
  const chats = f.s.store.get().tasks.filter((task) => task.origin === DO_CHAT_ORIGIN)
  expect(chats.map((task) => task.id)).toEqual([first.taskId])
  expect(chats[0]).toMatchObject({
    repositoryId: 'repo',
    agentId: 'agent',
    title: 'Plan the release',
  })
  const messages = f.s.store
    .task(first.taskId)
    .messages.filter((message) => message.role === 'user')
  expect(messages.map((message) => message.text)).toEqual(['Plan the release'])
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0].prompt).toContain('Plan the release')
  expect(f.chat.coordinator(first.taskId)).toBe(true)
  expect(await status(f.chat.create({ id: randomUUID(), text: 'x', repositoryId: 'gone' }))).toBe(
    404,
  )
})

it('lets a chat manage only the drafts it proposed and never start them', async () => {
  const f = await setup()
  const a = (await f.create('A')).taskId
  const b = (await f.create('B')).taskId
  const input = plan()
  const proposed = await f.tool(a, { action: 'propose', plan: input })
  expect(f.scope).toHaveBeenCalledWith(a, 'run-1')
  if (!('run' in proposed)) throw new Error('Expected a run')
  expect(proposed.run.status).toBe('draft')
  // An identical retry returns the stored draft; a foreign chat cannot touch it.
  const retried = await f.tool(a, { action: 'propose', plan: input })
  expect('run' in retried && retried.run.revision).toBe(proposed.run.revision)
  expect(await status(f.tool(b, { action: 'propose', plan: input }))).toBe(404)
  expect(await status(f.tool(b, { action: 'read', id: input.id }))).toBe(404)
  expect(await status(f.tool(b, { action: 'cancel', id: input.id }))).toBe(404)
  expect(await f.tool(b, { action: 'list' })).toEqual({ runs: [] })
  // Updates need the current revision.
  const stale = { ...input, title: 'Renamed', expectedRevision: randomUUID() }
  expect(await status(f.tool(a, { action: 'propose', plan: stale }))).toBe(409)
  const updated = await f.tool(a, {
    action: 'propose',
    plan: { ...stale, expectedRevision: proposed.run.revision },
  })
  expect('run' in updated && updated.run.title).toBe('Renamed')
  const listed = await f.tool(a, { action: 'list' })
  expect('runs' in listed && listed.runs.map((run) => run.id)).toEqual([input.id])
  // Human-created runs cannot be adopted by guessing their ID.
  const human = f.s.doRuns.save(plan())
  expect(await status(f.tool(a, { action: 'propose', plan: plan(human.id) }))).toBe(409)
  expect(await status(f.tool(a, { action: 'read', id: human.id }))).toBe(404)
  // Ordinary threads have no tool; start, retry, complete and delete are not tool actions.
  const ordinary = f.s.tasks.create({
    title: 'Other',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  expect(await status(f.tool(ordinary.id, { action: 'list' }))).toBe(403)
  for (const action of ['start', 'retry', 'complete', 'delete'])
    expect(() =>
      decode(doAgentCommandSchema, {
        taskId: a,
        parentRunId: 'run-1',
        command: { action, id: input.id, expectedRevision: proposed.run.revision },
      }),
    ).toThrow('command')
  expect(f.s.doRuns.read(input.id).status).toBe('draft')
  // Cancelling its own run stays available while Do is disabled.
  f.s.preferences.save({ enableDo: false })
  const cancelled = await f.tool(a, { action: 'cancel', id: input.id })
  expect('run' in cancelled && cancelled.run.status).toBe('cancelled')
})

it('queues one durable notice when a human-started proposal is ready for review', async () => {
  const f = await setup()
  const { taskId } = await f.create('Plan it')
  await f.idle(taskId)
  const input = plan()
  const proposed = await f.tool(taskId, { action: 'propose', plan: input })
  if (!('run' in proposed)) throw new Error('Expected a run')
  // Drafts and running plans produce no notice.
  await f.chat.tick()
  f.s.doRuns.start(input.id, proposed.run.revision)
  let run: DoRun | undefined
  await vi.waitFor(
    async () => {
      await f.s.doRuns.tick()
      run = f.s.doRuns.read(input.id)
      expect(run.status).toBe('review')
    },
    { timeout: 15_000, interval: 50 },
  )
  const notices = () =>
    f.s.store
      .task(taskId)
      .messages.filter((message) => message.id.startsWith(`do-chat:${input.id}:notice:`))
  expect(notices()).toEqual([])
  // Housekeeping may settle a quiet coordinator while its delegated work continues.
  f.s.store.updateTask(taskId, (task) => ({ ...task, archived: true, autoSettled: true }))
  await f.chat.tick()
  await f.chat.tick()
  await f.idle(taskId)
  expect(notices()).toHaveLength(1)
  expect(f.s.store.taskSummary(taskId).archived).toBe(false)
  expect(notices()[0].text).toContain('final review')
  expect(notices()[0].text).toContain('Done')
  // A human review is a new state and gets its own notice.
  f.s.doRuns.complete(input.id, 'accepted')
  await f.chat.tick()
  await f.chat.tick()
  await f.idle(taskId)
  expect(notices()).toHaveLength(2)
  expect(notices()[1].text).toContain('accepted')
  expect(run?.items[0].state.taskId).toBeTruthy()
})

it('keeps result notices queued while the user has paused the coordinator', async () => {
  const f = await setup()
  const { taskId } = await f.create('Plan it')
  await f.idle(taskId)
  const input = plan()
  const proposed = await f.tool(taskId, { action: 'propose', plan: input })
  if (!('run' in proposed)) throw new Error('Expected a run')
  f.s.doRuns.start(input.id, proposed.run.revision)
  await vi.waitFor(
    async () => {
      await f.s.doRuns.tick()
      expect(f.s.doRuns.read(input.id).status).toBe('review')
    },
    { timeout: 15_000, interval: 50 },
  )
  f.s.store.updateTask(taskId, (task) => ({ ...task, queuePaused: true }))
  const calls = f.calls.length
  await f.chat.tick()
  await f.chat.tick()
  const coordinator = f.s.store.taskSummary(taskId)
  expect(coordinator.queuePaused).toBe(true)
  expect(
    coordinator.queue?.filter((message) => message.id.startsWith(`do-chat:${input.id}:notice:`)),
  ).toHaveLength(1)
  expect(f.calls).toHaveLength(calls)
})
