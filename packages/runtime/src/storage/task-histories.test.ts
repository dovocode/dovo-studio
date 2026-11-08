import type Database from 'better-sqlite3'
import { expect, it, vi } from 'vite-plus/test'
import { summarizeTaskHistory, type Task } from '@dovo/protocol'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'

const historyRead = /^SELECT value FROM conversation_items WHERE task_id = \? AND kind = \?/
function task(id: string, size = 3, changes: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    agentId: '',
    repositoryId: '',
    status: 'review',
    createdAt: '2026-10-01T00:00:00Z',
    draft: '',
    files: [],
    example: false,
    providerLock: 'codex',
    messages: Array.from({ length: size * 2 }, (_, index) => ({
      id: `${id}-${index}`,
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      text: `${id} message ${index}`,
      ...(index % 2 ? { turnId: `${id}-turn-${(index - 1) / 2}` } : {}),
    })),
    turns: Array.from({ length: size }, (_, index) => ({
      id: `${id}-turn-${index}`,
      assistantId: `${id}-${index * 2 + 1}`,
      agentId: 'agent',
      provider: 'codex' as const,
      model: 'model',
      startedAt: '2026-10-01T00:00:00Z',
      finishedAt: '2026-10-01T00:01:00Z',
      status: 'completed' as const,
      tokens: 10,
      checkpoint: {
        before: 'before',
        after: 'after',
        files: [{ path: 'a.ts', before: 'old', after: 'new', viewed: false }],
        omitted: [],
      },
    })),
    ...changes,
  }
}
function seed(db: Database.Database, tasks: Task[]) {
  new WorkspaceStore(db).update((workspace) => ({ ...workspace, tasks }))
}
/** Records each statement's SQL, so tests can tell which histories a store read. */
function recordQueries(db: Database.Database) {
  const sql: string[] = []
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation((source: string) => {
    sql.push(source.replace(/\s+/g, ' ').trim())
    return prepare(source)
  })
  return { reads: () => sql.filter((source) => historyRead.test(source)).length, sql }
}

it('opens without reading any conversation and loads only the task whose history is requested', () => {
  const db = openDatabase(':memory:')
  try {
    const tasks = [task('a'), task('b'), task('c')]
    seed(db, tasks)
    const queries = recordQueries(db)
    const store = new WorkspaceStore(db)
    expect(queries.reads()).toBe(0)
    expect(store.retainedHistories().tasks).toEqual([])
    expect(store.get().tasks.map((item) => 'messages' in item || 'turns' in item)).toEqual([
      false,
      false,
      false,
    ])
    expect(store.taskSummary('b').history).toMatchObject({
      messages: 6,
      turns: 3,
      latestTurn: { id: 'b-turn-2' },
      firstUserText: 'b message 0',
      latestUserText: 'b message 4',
    })
    expect(store.taskSummary('b').history.latestTurn).not.toHaveProperty('checkpoint')
    expect(store.task('b')).toEqual(tasks[1])
    expect(queries.reads()).toBe(1)
    expect(store.retainedHistories().tasks).toEqual(['b'])
    // A retained history is served from memory with a stable identity.
    expect(store.task('b')).toBe(store.task('b'))
    expect(queries.reads()).toBe(1)
    store.updateTask('c', (item) => ({ ...item, pinned: true }))
    expect(queries.reads()).toBe(1)
    expect(store.retainedHistories().tasks).toEqual(['b'])
  } finally {
    db.close()
  }
})

it('evicts the least recently used histories by count and approximate bytes', () => {
  const db = openDatabase(':memory:')
  try {
    seed(db, [task('a'), task('b'), task('c', 40)])
    const counted = new WorkspaceStore(db, undefined, {
      historyBudget: { tasks: 2, bytes: 64 * 1024 * 1024 },
    })
    counted.task('a')
    counted.task('b')
    counted.task('a')
    counted.task('c')
    expect(counted.retainedHistories().tasks).toEqual(['a', 'c'])
    const small = new WorkspaceStore(db, undefined, { historyBudget: { tasks: 10, bytes: 30_000 } })
    small.task('a')
    small.task('b')
    expect(small.retainedHistories().tasks).toEqual(['a', 'b'])
    // Larger than the whole budget: it stays alone as the most recent history.
    const complete = small.task('c')
    expect(small.retainedHistories()).toMatchObject({ tasks: ['c'] })
    expect(small.retainedHistories().bytes).toBeGreaterThan(30_000)
    expect(complete.messages).toHaveLength(80)
    expect(small.task('a')).toEqual(counted.task('a'))
    expect(small.retainedHistories().tasks).toEqual(['a'])
  } finally {
    db.close()
  }
})

it('accounts for large diff excerpts and checkpoint disk contents when retaining histories', () => {
  const db = openDatabase(':memory:')
  try {
    const large = 'x'.repeat(100_000)
    const first = task('a', 1)
    const second = task('b', 1)
    first.messages[0].diffComment = {
      side: 'additions',
      start: 1,
      end: 1,
      excerpt: large,
      body: 'comment',
    }
    second.turns![0].checkpoint!.files[0].diskContents = large
    seed(db, [first, second])
    const store = new WorkspaceStore(db, undefined, {
      historyBudget: { tasks: 10, bytes: 300_000 },
    })
    store.task('a')
    expect(store.retainedHistories().bytes).toBeGreaterThan(200_000)
    store.task('b')
    expect(store.retainedHistories().tasks).toEqual(['b'])
    expect(store.retainedHistories().bytes).toBeGreaterThan(200_000)
  } finally {
    db.close()
  }
})

it('keeps summaries stable across unrelated updates and restarts, and derives a missing one again', () => {
  const db = openDatabase(':memory:')
  try {
    seed(db, [task('a'), task('b')])
    let store = new WorkspaceStore(db)
    const [a, b] = store.get().tasks
    const publicA = store.publicWorkspace().tasks[0]
    store.updateTaskHistory('b', (item) => ({
      ...item,
      messages: [...item.messages, { id: 'b-new', role: 'user', text: 'More' }],
    }))
    expect(store.get().tasks[0]).toBe(a)
    expect(store.publicWorkspace().tasks[0]).toBe(publicA)
    expect(store.get().tasks[1]).not.toBe(b)
    for (const summary of store.get().tasks)
      expect(summary.history).toEqual(summarizeTaskHistory(store.task(summary.id)))
    const before = store.get().tasks
    store = new WorkspaceStore(db)
    expect(store.get().tasks).toEqual(before)
    db.prepare('DELETE FROM workspace_task_histories WHERE task_id = ?').run('a')
    const queries = recordQueries(db)
    store = new WorkspaceStore(db)
    expect(queries.reads()).toBe(1)
    expect(store.get().tasks).toEqual(before)
    expect(store.retainedHistories().tasks).toEqual([])
    vi.restoreAllMocks()
    expect(db.prepare('SELECT COUNT(*) FROM workspace_task_histories').pluck().get()).toBe(2)
  } finally {
    db.close()
  }
})

it('keeps appends, rewinds and submission receipts complete through restarts and failed commits', () => {
  const db = openDatabase(':memory:')
  try {
    seed(db, [task('a'), task('b')])
    let store = new WorkspaceStore(db)
    const appended = { id: 'a-new', role: 'user' as const, text: 'Next request' }
    store.updateTaskHistory('a', (item) => ({ ...item, messages: [...item.messages, appended] }), {
      id: 'a-new',
      fingerprint: 'request',
    })
    expect(store.taskSubmission('a', 'a-new')).toBe('request')
    expect(store.taskSummary('a').history).toMatchObject({
      messages: 7,
      latestUserText: 'Next request',
    })
    const committed = store.task('a')
    expect(() =>
      store.transaction(() => {
        store.updateTaskHistory('a', (item) => ({
          ...item,
          messages: [...item.messages, { id: 'lost', role: 'user', text: 'Rolled back' }],
        }))
        throw new Error('Disk full')
      }),
    ).toThrow('Disk full')
    expect(store.task('a')).toEqual(committed)
    expect(store.taskSummary('a').history.messages).toBe(7)
    store = new WorkspaceStore(db)
    expect(store.task('a')).toEqual(committed)
    store.updateTaskHistory('a', (item) => ({
      ...item,
      messages: item.messages.slice(0, 2),
      turns: item.turns?.slice(0, 1),
    }))
    expect(store.taskSummary('a')).toMatchObject({
      historyRevision: 1,
      history: { messages: 2, turns: 1, latestTurn: { id: 'a-turn-0' } },
    })
    store = new WorkspaceStore(db)
    expect(store.task('a').messages.map((message) => message.id)).toEqual(['a-0', 'a-1'])
    expect(store.task('a').turns?.map((turn) => turn.id)).toEqual(['a-turn-0'])
    expect(store.task('b')).toEqual(task('b'))
  } finally {
    db.close()
  }
})

it('recovers interrupted turns by reading only the histories that recovery changes', () => {
  const db = openDatabase(':memory:')
  try {
    const running = task('running', 2)
    running.status = 'running'
    running.turns = running.turns?.map((turn, index) =>
      index === 1 ? { ...turn, status: 'running', finishedAt: undefined } : turn,
    )
    seed(db, [
      task('idle'),
      running,
      task('queued', 1, { queue: [{ id: 'q', role: 'user', text: 'Later', createdAt: '' }] }),
    ])
    const queries = recordQueries(db)
    const store = new WorkspaceStore(db)
    expect(queries.reads()).toBe(1)
    expect(store.retainedHistories().tasks).toEqual(['running'])
    expect(store.taskSummary('running')).toMatchObject({
      status: 'failed',
      history: { latestTurn: { status: 'failed' } },
    })
    expect(store.task('running').turns?.[1]).toMatchObject({
      status: 'failed',
      checkpoint: { error: 'Runtime stopped before the after snapshot was captured.' },
    })
    expect(store.taskSummary('queued').queuePaused).toBe(true)
    expect(queries.reads()).toBe(1)
  } finally {
    db.close()
  }
})

it('fails closed when stored history counts disagree with task rows', () => {
  const db = openDatabase(':memory:')
  try {
    seed(db, [task('a'), task('b')])
    db.prepare("DELETE FROM conversation_items WHERE task_id = 'b' AND item_id = 'b-0'").run()
    expect(() => new WorkspaceStore(db)).toThrow('History for b is incomplete')
  } finally {
    db.close()
  }
})

it('rejects edited history facts and new tasks without their complete history', () => {
  const db = openDatabase(':memory:')
  try {
    seed(db, [task('a')])
    const store = new WorkspaceStore(db)
    const summary = store.taskSummary('a')
    expect(() =>
      store.update((workspace) => ({
        ...workspace,
        tasks: [{ ...summary, history: { ...summary.history, messages: 0 } }],
      })),
    ).toThrow('Write the complete history of task a')
    expect(() =>
      store.update((workspace) => ({
        ...workspace,
        tasks: [...workspace.tasks, { ...summary, id: 'copy' }],
      })),
    ).toThrow('Write the complete history of task copy')
    expect(() =>
      store.update((workspace) => ({
        ...workspace,
        tasks: [{ ...summary, ...{ messages: [] } }],
      })),
    ).toThrow('mixes a summary with conversation history')
    expect(store.task('a')).toEqual(task('a'))
  } finally {
    db.close()
  }
})

it('materializes complete public tasks for legacy snapshots without retaining them', () => {
  const db = openDatabase(':memory:')
  try {
    const tasks = [task('a'), task('b')]
    seed(db, tasks)
    const store = new WorkspaceStore(db)
    const complete = [...store.publicCompleteTasks()].map((entry) => entry.task)
    expect(complete).toEqual(tasks)
    expect(store.retainedHistories().tasks).toEqual([])
    expect(store.publicTask('a')).toBe(store.publicTask('a'))
    expect(store.retainedHistories().tasks).toEqual(['a'])
  } finally {
    db.close()
  }
})
