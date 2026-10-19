import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from '../../agents/execution/types'
import type { Task } from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Continue',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'First request',
  })
  const send = (messageId: string, text: string, attachmentIds: string[] = []) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, messageId, text, attachmentIds }),
    })
  return { ...runtime.services, task, send }
}
it.each([
  { status: 'completed', hidden: true },
  { status: 'in-progress', hidden: false },
  { status: 'pending', hidden: false },
] as const)(
  'a new user message hides only a finished checklist (%s)',
  async ({ status, hidden }) => {
    const s = await setup()
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onSession('checklist-session')
      input.onText('Done')
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
    await (
      await s.tasks.start(s.task.id)
    ).done
    const todos: Task['nativeTodos'] = [
      { text: 'Previous step', status: 'completed' },
      { text: 'Last step', status },
    ]
    const seed = () => s.store.updateTask(s.task.id, (task) => ({ ...task, nativeTodos: todos }))
    seed()
    expect((await s.send('empty', '')).status).toBe(400)
    expect(s.store.task(s.task.id).nativeTodos).toEqual(todos)
    expect((await s.send('next', 'New request')).status).toBe(200)
    await waitForRuntime(() => expect(s.store.task(s.task.id).status).toBe('review'))
    expect(s.store.task(s.task.id).nativeTodos).toEqual(hidden ? undefined : todos)
    // Retrying a lost response must not clear a checklist published by the new turn.
    seed()
    expect((await s.send('next', 'New request')).status).toBe(200)
    expect(s.store.task(s.task.id).nativeTodos).toEqual(todos)
    await s.tasks.send(s.task.id, 'notification', 'System watch update')
    await waitForRuntime(() => expect(s.store.task(s.task.id).status).toBe('review'))
    expect(s.store.task(s.task.id).nativeTodos).toEqual(todos)
  },
)

it.each(['cancelled', 'failed', 'review'] as const)(
  'sending a follow-up resumes an idle %s thread and preserves queue order',
  async (status) => {
    const s = await setup()
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onText('Done')
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
    s.tasks.queue.add(s.task.id, 'earlier', 'Earlier queued request')
    s.store.updateTask(s.task.id, (task) => ({
      ...task,
      status,
      queuePaused: true,
      restartRecovery: { kind: 'turn', automatic: false },
    }))
    expect((await s.send('next', 'New follow-up')).status).toBe(200)
    await waitForRuntime(() => {
      expect(s.store.task(s.task.id).status).toBe('review')
      expect(s.store.task(s.task.id).queue ?? []).toHaveLength(0)
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]?.[0].prompt).toContain('Earlier queued request')
    expect(run.mock.calls[1]?.[0].prompt).toContain('New follow-up')
    expect(s.store.task(s.task.id).queuePaused).toBe(false)
    expect(s.store.task(s.task.id).restartRecovery).toBeUndefined()
  },
)
it('sending while a turn is active does not resume a deliberately paused queue', async () => {
  const s = await setup()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    await gate
    input.onText('Done')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    const active = await s.tasks.start(s.task.id)
    await waitForRuntime(() => expect(run).toHaveBeenCalledTimes(1))
    s.tasks.queue.change(s.task.id, 'pause')
    expect((await s.send('later', 'Wait for my resume')).status).toBe(200)
    expect(s.store.task(s.task.id).queuePaused).toBe(true)
    release()
    await active.done
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).queue?.map((message) => message.id)).toEqual(['later'])
    expect((await s.send('later', 'Wait for my resume')).status).toBe(200)
    expect(s.store.task(s.task.id).queuePaused).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  } finally {
    release()
  }
})

it('sending to a stopped thread with no queued messages immediately starts the new turn', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  s.store.updateTask(s.task.id, (task) => ({ ...task, status: 'cancelled', queuePaused: true }))
  expect((await s.send('new', 'Continue with this change')).status).toBe(200)
  await waitForRuntime(() => {
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).status).toBe('review')
  })
  expect(run.mock.calls[0]?.[0].prompt).toContain('Continue with this change')
})

it('reopens a settled thread only on accepted send and does not reopen on replay', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Done'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  s.store.updateTask(s.task.id, (task) => ({ ...task, status: 'review', archived: true }))
  s.store.patch({
    collection: 'tasks',
    id: s.task.id,
    changes: { draft: { before: '', after: 'Continue this work' } },
  })
  expect(s.store.task(s.task.id).archived).toBe(true)
  expect((await s.send('invalid', '')).status).toBe(400)
  expect(s.store.task(s.task.id).archived).toBe(true)
  expect((await s.send('follow-up', 'Continue this work')).status).toBe(200)
  await waitForRuntime(() => {
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).status).toBe('review')
  })
  expect(s.store.task(s.task.id)).toMatchObject({ archived: false, draft: '' })
  s.store.updateTask(s.task.id, (task) => ({ ...task, archived: true }))
  expect((await s.send('follow-up', 'Continue this work')).status).toBe(200)
  expect(s.store.task(s.task.id).archived).toBe(true)
  expect(run).toHaveBeenCalledTimes(1)
})

it('requires explicit restoration for an archived thread', async () => {
  const s = await setup()
  const archivedAt = new Date().toISOString()
  const todos: Task['nativeTodos'] = [{ text: 'Previous work', status: 'completed' }]
  s.store.updateTask(s.task.id, (task) => ({
    ...task,
    status: 'review',
    archived: true,
    archivedAt,
    nativeTodos: todos,
  }))
  expect((await s.send('follow-up', 'Continue')).status).toBe(409)
  expect(s.store.task(s.task.id)).toMatchObject({ archived: true, archivedAt })
  expect(s.store.taskSubmission(s.task.id, 'follow-up')).toBeUndefined()
  expect(s.store.task(s.task.id).nativeTodos).toEqual(todos)
})

it('reopens a settled thread on an attachment-only message after validating its files', async () => {
  const s = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Read attachment'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  s.store.updateTask(s.task.id, (task) => ({ ...task, status: 'review', archived: true }))
  const attachmentId = '00000000-0000-4000-8000-000000000001'
  expect((await s.send('missing-file', '', [attachmentId])).status).toBe(404)
  expect(s.store.task(s.task.id).archived).toBe(true)
  const { attachment } = await s.attachments.upload({
    taskId: s.task.id,
    id: attachmentId,
    name: 'note.txt',
    data: Buffer.from('New context').toString('base64'),
  })
  expect(s.store.task(s.task.id).archived).toBe(true)
  expect((await s.send('attachment-only', '', [attachment.id])).status).toBe(200)
  await waitForRuntime(() => {
    expect(run).toHaveBeenCalledTimes(1)
    expect(s.store.task(s.task.id).status).toBe('review')
  })
  expect(s.store.task(s.task.id).archived).toBe(false)
  expect(s.store.task(s.task.id).draftAttachments).toEqual([])
  expect(run.mock.calls[0]?.[0].attachments?.[0]?.name).toBe('note.txt')
})
