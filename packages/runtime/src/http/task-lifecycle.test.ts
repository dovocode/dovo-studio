import { afterEach, expect, it } from 'vite-plus/test'
import { startRuntime } from '../index'
import { WorkspaceStore } from '../storage/workspace'
import { decode, conversationPageSchema, snapshotSchema, type Task } from '@dovo/protocol'
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
  return { ...runtime.services, action, address: `http://127.0.0.1:${runtime.port}` }
}
function addChildren(store: WorkspaceStore) {
  const child = (id: string, parentTaskId: string): Task => ({
    ...task,
    id,
    delegation: { parentTaskId, parentRunId: 'finished-attempt', key: id },
    messages: [{ id: `message-${id}`, role: 'assistant', text: id }],
  })
  store.update((workspace) => ({
    ...workspace,
    tasks: [
      ...workspace.tasks,
      child('child', task.id),
      child('nested', 'child'),
      child('sibling', task.id),
    ],
  }))
  return [task.id, 'child', 'nested', 'sibling']
}
it('propagates settle, reopen and snooze changes to all descendants in one workspace update', async () => {
  const { store } = await setup()
  const ids = addChildren(store)
  store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      archived: { before: null, after: true },
      snoozedUntil: { before: null, after: '2026-10-04T12:00:00Z' },
    },
  })
  for (const id of ids)
    expect(store.task(id)).toMatchObject({
      archived: true,
      snoozedUntil: '2026-10-04T12:00:00Z',
    })
  expect(store.task('other').archived).toBeUndefined()
  store.patch({
    collection: 'tasks',
    id: task.id,
    changes: {
      archived: { before: true, after: false },
      snoozedUntil: { before: '2026-10-04T12:00:00Z', after: null },
    },
  })
  for (const id of ids) {
    expect(store.task(id).archived).toBe(false)
    expect(store.task(id).snoozedUntil).toBeUndefined()
  }
})
it('archives, restores and deletes the whole family while retaining unrelated threads', async () => {
  const { store, db, action, activity } = await setup()
  const ids = addChildren(store)
  for (const id of ids) {
    activity.add('tool', id, 'Family output')
    db.prepare('INSERT INTO attachments VALUES (?, ?, ?, ?)').run(
      `attachment-${id}`,
      id,
      '{}',
      Buffer.from('content'),
    )
  }
  expect((await action('archive')).status).toBe(200)
  for (const id of ids) expect(store.task(id).archivedAt).toBeTruthy()
  expect((await action('restore')).status).toBe(200)
  for (const id of ids) {
    expect(store.task(id).archived).toBe(false)
    expect(store.task(id).archivedAt).toBeUndefined()
  }
  expect((await action('delete')).status).toBe(200)
  expect(store.get().tasks.map((entry) => entry.id)).toEqual(['other'])
  for (const id of ids) {
    expect(db.prepare('SELECT id FROM attachments WHERE task = ?').all(id)).toEqual([])
    expect(activity.list('', '', 0, id).events).toEqual([])
  }
  expect((await action('delete')).status).toBe(200)
})
it('rejects a family action before changing any member when a descendant is active', async () => {
  const { store, action } = await setup()
  const ids = addChildren(store)
  store.updateTask('nested', (entry) => ({ ...entry, status: 'running' }))
  expect(() =>
    store.patch({
      collection: 'tasks',
      id: task.id,
      changes: { archived: { before: null, after: true } },
    }),
  ).toThrow('Stop active child agents')
  for (const operation of ['archive', 'restore', 'delete'])
    expect((await action(operation)).status).toBe(409)
  for (const id of ids) expect(store.task(id).archivedAt).toBeUndefined()
  expect(store.get().tasks).toHaveLength(5)
})
it('keeps the whole family visible until a nested child terminal closes', async () => {
  const { store, terminals, action } = await setup()
  const ids = addChildren(store)
  const session = terminals.create('nested', process.cwd())
  try {
    for (const operation of ['archive', 'delete'])
      expect((await action(operation)).status).toBe(409)
    for (const id of ids) expect(store.task(id).archivedAt).toBeUndefined()
  } finally {
    await terminals.close(session.id)
  }
  expect((await action('archive')).status).toBe(200)
  for (const id of ids) expect(store.task(id).archivedAt).toBeTruthy()
})
it('deleting a child removes its descendants and preserves the parent and siblings', async () => {
  const { store, address } = await setup()
  addChildren(store)
  const response = await fetch(`${address}/api/tasks/lifecycle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'child', action: 'delete' }),
  })
  expect(response.status).toBe(200)
  expect(store.get().tasks.map((entry) => entry.id)).toEqual(['thread', 'other', 'sibling'])
  expect(store.task(task.id).subagents?.map((entry) => entry.id)).toEqual(['sibling'])
})
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
    await terminals.close(session.id)
  }
  expect((await action('archive')).status).toBe(200)
})

it('pages all authenticated history with stable cursors while preserving legacy snapshots', async () => {
  const { store, address } = await setup()
  store.updateTask(task.id, (t) => ({
    ...t,
    messages: Array.from({ length: 80 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      text: `message ${index}`,
    })),
  }))
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const history = (before?: string, credential = token) =>
    fetch(`${address}/api/tasks/history`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ id: task.id, before }),
    })
  expect((await history(undefined, 'invalid')).status).toBe(401)
  expect((await history('removed')).status).toBe(409)
  const collected: string[] = []
  let before: string | undefined
  do {
    const response = await history(before)
    expect(response.status).toBe(200)
    const page = decode(conversationPageSchema, await response.json())
    collected.unshift(...page.messages.map((message) => message.id))
    before = page.before
  } while (before)
  expect(collected).toEqual(store.task(task.id).messages.map((message) => message.id))
  const paged = decode(
    snapshotSchema,
    await (
      await fetch(`${address}/api/snapshot?scope=threads&task=thread&history=paged`, { headers })
    ).json(),
  )
  expect(paged.workspace.tasks[0]?.messages).toHaveLength(20)
  expect(paged.workspace.tasks[0]?.historyBefore).toBe('m60')
  const legacy = decode(
    snapshotSchema,
    await (await fetch(`${address}/api/snapshot?scope=threads&task=thread`, { headers })).json(),
  )
  expect(legacy.workspace.tasks[0]?.messages).toHaveLength(80)
})
