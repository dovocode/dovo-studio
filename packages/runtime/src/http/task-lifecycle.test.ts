import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index'
import { WorkspaceStore } from '../storage/workspace'
import {
  decode,
  conversationPageSchema,
  questionPromptSchema,
  snapshotSchema,
  type Task,
} from '@dovo/protocol'
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
  store.updateTaskHistory(task.id, (t) => ({
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
  store.updateTaskHistory(task.id, (t) => ({
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

it('settles and reopens an individual custom child branch without settling its parent or siblings', async () => {
  const { store } = await setup()
  addChildren(store)
  for (const archived of [true, false]) {
    store.patch({
      collection: 'tasks',
      id: 'child',
      changes: { archived: { before: archived ? null : true, after: archived } },
    })
    expect(store.task('child').archived).toBe(archived)
    expect(store.task('nested').archived).toBe(archived)
    expect(store.task('thread').archived).toBeUndefined()
    expect(store.task('other').archived).toBeUndefined()
  }
})

it('loads the latest 50 user messages for composer recall independently of transcript pages', async () => {
  const { store, address } = await setup()
  store.updateTaskHistory(task.id, (t) => ({
    ...t,
    messages: Array.from({ length: 65 }, (_, i) => [
      { id: `u${i}`, role: 'user' as const, text: `Sent ${i}` },
      { id: `a${i}`, role: 'assistant' as const, text: 'Long reply' },
    ]).flat(),
  }))
  const read = (credential: string, before?: string) =>
    fetch(`${address}/api/tasks/composer-history`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, ...(before ? { before } : {}) }),
    })
  expect((await read('invalid')).status).toBe(401)
  const response = await read(token)
  expect(response.status).toBe(200)
  const page = decode(conversationPageSchema, await response.json())
  expect(page.messages.map((m) => m.id)).toEqual(Array.from({ length: 50 }, (_, i) => `u${i + 15}`))
  expect(page.turns).toEqual([])
  expect(page.before).toBe('u15')
  const older = decode(conversationPageSchema, await (await read(token, page.before)).json())
  expect(older.messages.map((m) => m.id)).toEqual(Array.from({ length: 15 }, (_, i) => `u${i}`))
  expect(older.before).toBeUndefined()
  expect((await read(token, 'missing')).status).toBe(409)
})
it('retires pending questions and approvals when a thread family is archived or deleted', async () => {
  const { store, questions, approvals, action, address } = await setup()
  addChildren(store)
  const prompt = decode(questionPromptSchema, {
    title: 'Pick one',
    questions: [{ id: 'choice', header: 'Choice', question: 'Which one?', custom: true }],
  })
  const answer = (id: string) =>
    fetch(`${address}/api/tasks/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, answers: { choice: ['late'] } }),
    })
  const ask = (taskId: string) => {
    const pending = questions.request(taskId, prompt, new AbortController().signal)
    return { pending, id: questions.list().at(-1)!.id }
  }
  // A non-blocking form can outlive its turn, so the thread is idle with a question pending.
  const parent = ask(task.id)
  const child = ask('nested')
  const unrelated = ask('other')
  const approval = approvals.request('child', 'Run command', '{}', new AbortController().signal)
  expect((await action('archive')).status).toBe(200)
  await expect(parent.pending).resolves.toBeNull()
  await expect(child.pending).resolves.toBeNull()
  await expect(approval).resolves.toBe('deny')
  expect(questions.list().map((item) => item.id)).toEqual([unrelated.id])
  expect(approvals.list()).toEqual([])
  expect(questions.status(parent.id)).toBeUndefined()
  expect((await answer(parent.id)).status).toBe(409)

  // Restore does not reopen the retired question.
  expect((await action('restore')).status).toBe(200)
  expect(questions.list().map((item) => item.id)).toEqual([unrelated.id])
  const again = ask(task.id)
  expect((await action('delete')).status).toBe(200)
  await expect(again.pending).resolves.toBeNull()
  expect(questions.list().map((item) => item.id)).toEqual([unrelated.id])
  expect((await answer(again.id)).status).toBe(409)
  expect((await answer(unrelated.id)).status).not.toBe(409)
})
it('keeps questions, approvals and side chats when the archive or delete write fails', async () => {
  const { store, questions, approvals, titles, db, action } = await setup()
  const ids = addChildren(store)
  const prompt = decode(questionPromptSchema, {
    title: 'Pick one',
    questions: [{ id: 'choice', header: 'Choice', question: 'Which one?', custom: true }],
  })
  const ask = (taskId: string) => {
    const pending = questions.request(taskId, prompt, new AbortController().signal)
    return { pending, id: questions.list().at(-1)!.id }
  }
  const sideChats = vi.spyOn(titles, 'cancelSideChats')
  const parent = ask(task.id)
  const child = ask('child')
  const approval = approvals.request('nested', 'Run command', '{}', new AbortController().signal)
  const pendingIds = () => questions.list().map((item) => item.id)

  // Fail at the child's row, after the parent's row in the same write.
  db.exec(
    "CREATE TRIGGER fail_child_archive BEFORE UPDATE ON workspace_tasks WHEN NEW.task_id = 'child' BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
  )
  expect((await action('archive')).status).toBe(500)
  for (const id of ids) expect(store.taskSummary(id).archivedAt).toBeUndefined()
  expect(pendingIds()).toEqual([parent.id, child.id])
  expect(approvals.list()).toHaveLength(1)
  expect(sideChats).not.toHaveBeenCalled()
  db.exec('DROP TRIGGER fail_child_archive')

  db.exec(
    "CREATE TRIGGER fail_child_delete BEFORE DELETE ON workspace_tasks WHEN OLD.task_id = 'child' BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
  )
  expect((await action('delete')).status).toBe(500)
  for (const id of ids) expect(store.get().tasks.some((item) => item.id === id)).toBe(true)
  expect(pendingIds()).toEqual([parent.id, child.id])
  expect(approvals.list()).toHaveLength(1)
  expect(sideChats).not.toHaveBeenCalled()
  db.exec('DROP TRIGGER fail_child_delete')

  // The same inputs retire once the delete commits, with no audit rows left for the threads.
  expect((await action('delete')).status).toBe(200)
  await expect(parent.pending).resolves.toBeNull()
  await expect(child.pending).resolves.toBeNull()
  await expect(approval).resolves.toBe('deny')
  expect(pendingIds()).toEqual([])
  expect(approvals.list()).toEqual([])
  expect(sideChats.mock.calls.map(([id]) => id).sort()).toEqual([...ids].sort())
  const scopes = db
    .prepare(`SELECT COUNT(*) AS count FROM activity WHERE scope IN (${ids.map(() => '?').join()})`)
    .get(...ids)
  expect(scopes).toEqual({ count: 0 })
})
it('blocks new work while a delete awaits terminal cleanup and checks again before committing', async () => {
  const { store, terminals, tasks, agents, action } = await setup()
  const ids = addChildren(store)
  const session = terminals.create('child', process.cwd())
  cleanup.push(async () => {
    if (terminals.list().some((entry) => entry.id === session.id)) await terminals.close(session.id)
  })
  // The terminal's process has exited; delete closes the retained record and awaits it.
  const list = terminals.list.bind(terminals)
  vi.spyOn(terminals, 'list').mockImplementation(() =>
    list().map((entry) => (entry.id === session.id ? { ...entry, exited: true } : entry)),
  )
  const close = terminals.close.bind(terminals)
  let entered = () => {}
  let release = () => {}
  const closing = vi.spyOn(terminals, 'close').mockImplementation(async (id) => {
    entered()
    await new Promise<void>((resolve) => (release = resolve))
    return close(id)
  })
  const provider = vi.spyOn(agents, 'get')

  // An intervening answer or message on any family member fails instead of starting work.
  const waiting = new Promise<void>((resolve) => (entered = resolve))
  const deletion = action('delete')
  await waiting
  for (const id of [task.id, 'nested'])
    await expect(tasks.send(id, `late-${id}`, 'Late answer')).rejects.toThrow('being deleted')
  release()
  expect((await deletion).status).toBe(200)
  for (const id of ids) expect(store.get().tasks.some((item) => item.id === id)).toBe(false)
  expect(provider).not.toHaveBeenCalled()
  expect(closing).toHaveBeenCalledTimes(1)
  // The reservation ends with the request.
  expect(() => tasks.requireIdle('other')).not.toThrow()
})

it('keeps the family when it becomes busy while a delete awaits terminal cleanup', async () => {
  const { store, terminals, tasks, action } = await setup()
  const ids = addChildren(store)
  const session = terminals.create('child', process.cwd())
  cleanup.push(async () => {
    if (terminals.list().some((entry) => entry.id === session.id)) await terminals.close(session.id)
  })
  const list = terminals.list.bind(terminals)
  vi.spyOn(terminals, 'list').mockImplementation(() =>
    list().map((entry) => (entry.id === session.id ? { ...entry, exited: true } : entry)),
  )
  const close = terminals.close.bind(terminals)
  let entered = () => {}
  let release = () => {}
  vi.spyOn(terminals, 'close').mockImplementation(async (id) => {
    entered()
    await new Promise<void>((resolve) => (release = resolve))
    return close(id)
  })
  const waiting = new Promise<void>((resolve) => (entered = resolve))
  const deletion = action('delete')
  await waiting
  // A path that ignores the reservation still cannot have its work deleted.
  store.updateTask('nested', (current) => ({ ...current, status: 'running' }))
  release()
  expect((await deletion).status).toBe(409)
  for (const id of ids) expect(store.get().tasks.some((item) => item.id === id)).toBe(true)
  // The failed delete released its reservation.
  store.updateTask('nested', (current) => ({ ...current, status: 'review' }))
  expect(() => tasks.requireIdle(task.id)).not.toThrow()
})
