import { afterEach, expect, it } from 'vitest'
import { hasUnviewedTaskCompletion, type Task, type TaskTurn } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { WorkspaceStore } from '../storage/workspace.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const token = 'task-viewed-test-owner-token-with-at-least-32-characters'
const turn: TaskTurn = {
  id: 'completed',
  assistantId: 'assistant',
  agentId: '',
  provider: 'codex',
  model: '',
  status: 'completed',
  startedAt: '2026-09-23T00:00:00Z',
  finishedAt: '2026-09-23T00:01:00Z',
}
const task: Task = {
  id: 'task',
  title: 'Task',
  agentId: '',
  repositoryId: 'repo',
  status: 'review',
  createdAt: '2026-09-22T00:00:00Z',
  updatedAt: '2026-09-23T00:01:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  turns: [turn],
}
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  const viewed = (
    turnId: string,
    id = task.id,
    credential = token,
    viewed?: boolean,
    expectedRevision = runtime.services.store.get().tasks.find((task) => task.id === id)
      ?.viewedRevision ?? 0,
  ) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/viewed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, turnId, viewed, expectedRevision }),
    })
  return { s: runtime.services, viewed, url: `http://127.0.0.1:${runtime.port}/api/tasks/viewed` }
}
it('acknowledges a completion without changing lifecycle, activity ordering or repeated revision writes', async () => {
  const { s, viewed } = await setup()
  const version = s.store.version()
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(true)
  const response = await viewed(turn.id)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  const saved = s.store.task(task.id)
  expect(saved.lastViewedTurnId).toBe(turn.id)
  expect(saved.viewedRevision).toBe(1)
  expect(saved.updatedAt).toBe(task.updatedAt)
  expect(saved.status).toBe('review')
  expect(hasUnviewedTaskCompletion(saved)).toBe(false)
  expect(s.store.version()).toBe(version + 1)
  await viewed(turn.id)
  expect(s.store.version()).toBe(version + 1)
  expect(s.activity.list('/api/tasks/viewed', '', 0).events).toEqual([])
  expect(new WorkspaceStore(s.db).task(task.id).lastViewedTurnId).toBe(turn.id)
  expect(new WorkspaceStore(s.db).task(task.id).viewedRevision).toBe(1)
  expect(s.store.task(task.id).updatedAt).toBe(task.updatedAt)
})
it('does not let an older tab acknowledge a newer completion', async () => {
  const { s, viewed } = await setup()
  await viewed(turn.id)
  s.store.updateTask(task.id, (task) => ({
    ...task,
    turns: [...task.turns!, { ...turn, id: 'next' }],
  }))
  const version = s.store.version()
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(true)
  await viewed(turn.id)
  await viewed('not-a-turn')
  expect(s.store.version()).toBe(version)
  expect(s.store.task(task.id).lastViewedTurnId).toBe(turn.id)
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(true)
  await viewed('next')
  expect(s.store.task(task.id).lastViewedTurnId).toBe('next')
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(false)
})
it.each(['running', 'failed', 'cancelled'] as const)(
  'ignores acknowledgements while the task is %s',
  async (status) => {
    const { s, viewed } = await setup()
    s.store.updateTask(task.id, (task) => ({ ...task, status }))
    const version = s.store.version()
    expect((await viewed(turn.id)).status).toBe(200)
    expect(s.store.task(task.id).lastViewedTurnId).toBeUndefined()
    expect(s.store.version()).toBe(version)
  },
)
it('requires authentication and an existing task on the owning runtime', async () => {
  const { s, viewed } = await setup()
  expect((await viewed(turn.id, task.id, 'not-authorized')).status).toBe(401)
  expect((await viewed(turn.id, 'task-from-other-runtime')).status).toBe(404)
  expect(s.store.task(task.id).lastViewedTurnId).toBeUndefined()
})
it('keeps viewed state server-owned rather than allowing a generic patch to clear new completions', async () => {
  const { s } = await setup()
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: task.id,
      changes: { lastViewedTurnId: { before: null, after: turn.id } },
    }),
  ).toThrow('Cannot edit lastViewedTurnId')
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: 'new',
      changes: {},
      create: { ...task, id: 'new', status: 'draft', turns: undefined, lastViewedTurnId: turn.id },
    }),
  ).toThrow('New tasks must be drafts')
})

it('marks the current completion unread without changing activity order, and persists idempotently', async () => {
  const { s, viewed } = await setup()
  await viewed(turn.id)
  const version = s.store.version()
  const response = await viewed(turn.id, task.id, token, false)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  expect(s.store.task(task.id).lastViewedTurnId).toBeUndefined()
  expect(s.store.task(task.id).updatedAt).toBe(task.updatedAt)
  expect(s.store.task(task.id).status).toBe('review')
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(true)
  expect(s.store.version()).toBe(version + 1)
  await viewed(turn.id, task.id, token, false)
  expect(s.store.version()).toBe(version + 1)
  expect(new WorkspaceStore(s.db).task(task.id).lastViewedTurnId).toBeUndefined()
  expect(new WorkspaceStore(s.db).task(task.id).viewedRevision).toBe(2)
  // Explicit true and the legacy omitted flag both acknowledge normally.
  await viewed(turn.id, task.id, token, true)
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(false)
})

it('does not let a stale unread action clear a newer completion acknowledgement', async () => {
  const { s, viewed } = await setup()
  await viewed(turn.id)
  s.store.updateTask(task.id, (task) => ({
    ...task,
    turns: [...task.turns!, { ...turn, id: 'next' }],
  }))
  await viewed('next')
  const version = s.store.version()
  await viewed(turn.id, task.id, token, false)
  expect(s.store.task(task.id).lastViewedTurnId).toBe('next')
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(false)
  expect(s.store.version()).toBe(version)
})

it('rejects a delayed automatic read after a newer manual unread action for the same turn', async () => {
  const { s, viewed } = await setup()
  const oldRevision = s.store.task(task.id).viewedRevision ?? 0
  await viewed(turn.id, task.id, token, true, oldRevision)
  expect(s.store.task(task.id).viewedRevision).toBe(1)
  await viewed(turn.id, task.id, token, false, 1)
  expect(s.store.task(task.id).viewedRevision).toBe(2)
  const version = s.store.version()
  // This automatic acknowledgement started before the explicit Mark unread action.
  expect((await viewed(turn.id, task.id, token, true, oldRevision)).status).toBe(200)
  expect(s.store.version()).toBe(version)
  expect(s.store.task(task.id).viewedRevision).toBe(2)
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(true)
  expect(s.store.task(task.id).updatedAt).toBe(task.updatedAt)
  await viewed(turn.id, task.id, token, true, 2)
  expect(s.store.task(task.id).viewedRevision).toBe(3)
  expect(hasUnviewedTaskCompletion(s.store.task(task.id))).toBe(false)
})

it('keeps the read revision server-owned', async () => {
  const { s } = await setup()
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: task.id,
      changes: { viewedRevision: { before: null, after: 1 } },
    }),
  ).toThrow('Cannot edit viewedRevision')
  expect(() =>
    s.store.patch({
      collection: 'tasks',
      id: 'new',
      changes: {},
      create: { ...task, id: 'new', status: 'draft', turns: undefined, viewedRevision: 1 },
    }),
  ).toThrow('New tasks must be drafts')
})

it.each([undefined, -1, 0.5])(
  'requires a nonnegative integer revision: %s',
  async (expectedRevision) => {
    const { s, url } = await setup()
    const version = s.store.version()
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, turnId: turn.id, expectedRevision }),
    })
    expect(response.status).toBe(400)
    expect(s.store.version()).toBe(version)
  },
)
