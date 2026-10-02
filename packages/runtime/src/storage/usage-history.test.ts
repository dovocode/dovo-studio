import { expect, it } from 'vitest'
import { openDatabase } from './database.js'
import { WorkspaceStore } from './workspace.js'
import { type Task } from '@dovo/protocol'
const task: Task = {
  id: 't',
  title: 'Usage',
  repositoryId: '',
  agentId: '',
  createdAt: '',
  status: 'review',
  draft: '',
  messages: [],
  files: [],
  example: false,
  turns: [
    {
      id: 'turn',
      assistantId: 'reply',
      provider: 'codex',
      agentId: 'a',
      model: 'gpt-6.1-sol',
      startedAt: '2026-10-01T00:00:00Z',
      finishedAt: '2026-10-01T00:01:00Z',
      status: 'completed',
      tokens: 100,
      tokenUsage: { input: 70, output: 10, cacheRead: 20, cacheWrite: 0 },
    },
  ],
}
it('backfills stored turns and preserves consumption after thread deletion and restart', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({ ...w, tasks: [task] }))
    const source = store.usage.sourceId
    store.update((w) => ({ ...w, tasks: [] }))
    const reopened = new WorkspaceStore(db)
    expect(reopened.usage.sourceId).toBe(source)
    expect(await reopened.usage.read('2026-09-01')).toMatchObject([
      { taskId: 't', turn: { tokens: 100, tokenUsage: { input: 70 } } },
    ])
    reopened.update((w) => ({ ...w, tasks: [task] }))
    expect(await reopened.usage.read('2026-09-01')).toHaveLength(1)
  } finally {
    db.close()
  }
})
it('preserves unrelated validated entities during streamed updates and still rejects bad updates', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({ ...w, tasks: [task, { ...task, id: 'other' }] }))
    const old = store.get().tasks[1]
    const publicOld = store.publicWorkspace().tasks[1]
    store.updateTask('t', (t) => ({ ...t, draft: 'typing' }))
    expect(store.get().tasks[1]).toBe(old)
    expect(store.publicWorkspace().tasks[1]).toBe(publicOld)
    expect(() =>
      store.updateTask('t', (t) => ({
        ...t,
        turns: t.turns?.map((turn) => ({ ...turn, tokens: -1 })),
      })),
    ).toThrow(/non-negative/)
  } finally {
    db.close()
  }
})

it('allows streamed writes between pages of a large history read', async () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const turn = task.turns?.[0]
    if (!turn) throw new Error('Missing fixture turn')
    store.usage.recordExternal(
      Array.from({ length: 600 }, (_, index) => ({
        taskId: 'cli',
        title: 'CLI',
        origin: 'cli' as const,
        turn: { ...turn, id: String(index) },
      })),
    )
    const reading = store.usage.read('2026-09-01')
    store.update((workspace) => ({ ...workspace, tasks: [task] }))
    expect((await reading).length).toBeGreaterThanOrEqual(600)
  } finally {
    db.close()
  }
})
