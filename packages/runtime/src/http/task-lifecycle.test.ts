import { afterEach, expect, it } from 'vitest'
import { startRuntime } from '../index'
import { WorkspaceStore } from '../storage/workspace'
import type { Task } from '@dovo/protocol'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
const token = 'thread-lifecycle-test-token-at-least-32-characters'
const task: Task = {
  id: 'thread',
  title: 'Thread',
  agentId: '',
  repositoryId: '',
  status: 'draft',
  createdAt: '2026-09-23T00:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
}
async function setup() {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [task, { ...task, id: 'other' }],
  }))
  const action = (action: string, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/lifecycle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, action }),
    })
  return { ...runtime.services, action }
}
it('archives separately from settle, persists and restores without losing the conversation', async () => {
  const { store, db, action } = await setup()
  store.updateTask(task.id, (t) => ({
    ...t,
    archived: true,
    messages: [{ id: 'message', role: 'user', text: 'Keep me' }],
  }))
  expect(store.task(task.id).archivedAt).toBeUndefined()
  expect((await action('archive')).status).toBe(200)
  const archived = store.task(task.id)
  expect(archived.archivedAt).toBeTruthy()
  expect((await action('archive')).status).toBe(200)
  expect(store.task(task.id).archivedAt).toBe(archived.archivedAt)
  expect(new WorkspaceStore(db).task(task.id).archivedAt).toBe(archived.archivedAt)
  expect((await action('restore')).status).toBe(200)
  expect(store.task(task.id)).toMatchObject({
    archived: false,
    messages: archived.messages,
  })
  expect(store.task(task.id).archivedAt).toBeUndefined()
  expect(store.task(task.id).queuePaused).toBeUndefined()
})
it('requires authentication and rejects active threads', async () => {
  const { store, action } = await setup()
  expect((await action('delete', 'invalid')).status).toBe(401)
  store.updateTask(task.id, (t) => ({ ...t, status: 'running' }))
  for (const method of ['archive', 'restore', 'delete'])
    expect((await action(method)).status).toBe(409)
  expect(store.get().tasks).toHaveLength(2)
})
it('deletes only the requested thread, its attachments and activity; repeated deletes are safe', async () => {
  const { store, db, action, activity } = await setup()
  activity.add('tool', task.id, 'Private output')
  db.prepare('INSERT INTO attachments VALUES (?, ?, ?, ?)').run(
    'file',
    task.id,
    '{}',
    Buffer.from('content'),
  )
  expect((await action('delete')).status).toBe(200)
  expect(store.get().tasks.map((task) => task.id)).toEqual(['other'])
  expect(db.prepare('SELECT id FROM attachments WHERE task = ?').all(task.id)).toEqual([])
  expect(activity.list('', '', 0, task.id).events).toEqual([])
  expect((await action('delete')).status).toBe(200)
})
it('does not leave agents working after the parent run ends or runtime restarts', async () => {
  const { store, db } = await setup()
  store.updateTask(task.id, (t) => ({
    ...t,
    status: 'running',
    subagents: [
      {
        id: 'child',
        provider: 'codex',
        name: 'Reviewer',
        status: 'working',
        startedAt: task.createdAt,
        updatedAt: task.createdAt,
      },
    ],
  }))
  expect(new WorkspaceStore(db).task(task.id).subagents?.[0]?.status).toBe('unknown')
  store.updateTask(task.id, (t) => ({ ...t, status: 'review' }))
  expect(store.task(task.id).subagents?.[0]?.status).toBe('unknown')
})
it('keeps a visible thread when its terminal is still running', async () => {
  const { store, terminals, action } = await setup()
  const session = terminals.create(task.id, process.cwd())
  try {
    expect((await action('archive')).status).toBe(409)
    expect((await action('delete')).status).toBe(409)
    expect(store.task(task.id).archivedAt).toBeUndefined()
    expect(store.get().tasks).toHaveLength(2)
  } finally {
    terminals.close(session.id)
  }
  expect((await action('archive')).status).toBe(200)
})
