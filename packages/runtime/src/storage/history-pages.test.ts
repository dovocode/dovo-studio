import { expect, it, vi } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { WorkspaceStore } from './workspace.js'

function thread(): Task {
  return {
    id: 'thread',
    title: 'History',
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '2026-10-01T00:00:00Z',
    draft: '',
    files: [],
    example: false,
    messages: Array.from({ length: 120 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      text: `Message ${index}`,
      ...(index % 2 ? { turnId: `t${(index - 1) / 2}` } : {}),
    })),
    turns: Array.from({ length: 60 }, (_, index) => ({
      id: `t${index}`,
      assistantId: `m${index * 2 + 1}`,
      agentId: '',
      provider: 'codex',
      model: '',
      status: 'completed',
      startedAt: '2026-10-01T00:00:00Z',
      finishedAt: '2026-10-01T00:01:00Z',
      tokens: index,
      checkpoint: {
        before: 'before',
        after: 'after',
        omitted: [],
        files: [
          { path: 'file.txt', before: 'a'.repeat(8192), after: 'b'.repeat(8192), viewed: false },
        ],
      },
    })),
  }
}

it('pages retained committed history identically to SQLite without reading or extending the cache', () => {
  const db = openDatabase(':memory:')
  try {
    const writer = new WorkspaceStore(db)
    writer.update((workspace) => ({ ...workspace, tasks: [thread()] }))
    const cold = new WorkspaceStore(db)
    let before: string | undefined
    do {
      const expected = cold.historyPage('thread', before)!
      const reads = vi.spyOn(db, 'prepare')
      const actual = writer.historyPage('thread', before)!
      expect(reads).not.toHaveBeenCalled()
      reads.mockRestore()
      expect(actual).toEqual(expected)
      expect(
        actual.messages.every((message) => writer.task('thread').messages.includes(message)),
      ).toBe(true)
      expect(actual.turns.every((turn) => writer.task('thread').turns?.includes(turn))).toBe(true)
      before = actual.before
    } while (before)
    expect(writer.historyPage('thread', 'missing')).toBeUndefined()
    expect(cold.historyPage('thread', 'missing')).toBeUndefined()
    expect(cold.retainedHistories().tasks).toEqual([])
  } finally {
    db.close()
  }
})

it('keeps retained pages equivalent through streaming, metadata edits and destructive history changes', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({ ...workspace, tasks: [thread()] }))
    for (let frame = 0; frame < 20; frame++) {
      store.updateTaskHistory('thread', (task) => ({
        ...task,
        title: `Frame ${frame}`,
        messages: task.messages.map((message, index) =>
          index === 119 ? { ...message, text: message.text + ' streamed' } : message,
        ),
        turns: task.turns?.map((turn, index) => (index === 59 ? { ...turn, tokens: frame } : turn)),
      }))
      expect(store.historyPage('thread')).toEqual(new WorkspaceStore(db).historyPage('thread'))
    }
    store.updateTaskHistory('thread', (task) => ({
      ...task,
      messages: task.messages.slice(0, 60),
      turns: task.turns?.slice(0, 30),
    }))
    expect(store.historyPage('thread')).toEqual(new WorkspaceStore(db).historyPage('thread'))
    expect(store.historyPage('thread', 'm119')).toBeUndefined()
    store.updateTask('thread', (task) => ({ ...task, title: 'Metadata only' }))
    expect(store.historyPage('thread')).toEqual(new WorkspaceStore(db).historyPage('thread'))
  } finally {
    db.close()
  }
})

it('falls back to bounded SQLite paging after eviction without retaining cold conversations', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db, undefined, {
      historyBudget: { tasks: 1, bytes: 64 * 1024 * 1024 },
    })
    store.update((workspace) => ({ ...workspace, tasks: [thread(), { ...thread(), id: 'other' }] }))
    expect(store.retainedHistories().tasks).toEqual(['other'])
    expect(store.historyPage('thread')).toEqual(new WorkspaceStore(db).historyPage('thread'))
    expect(store.retainedHistories().tasks).toEqual(['other'])
  } finally {
    db.close()
  }
})

it('does not serve rolled-back streamed history from the retained cache', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({ ...workspace, tasks: [thread()] }))
    const original = store.historyPage('thread')
    expect(() =>
      store.transaction(() => {
        store.updateTaskHistory('thread', (task) => ({
          ...task,
          messages: task.messages.slice(0, 60),
        }))
        expect(store.historyPage('thread')).not.toEqual(original)
        throw new Error('Abort transaction')
      }),
    ).toThrow('Abort transaction')
    expect(store.historyPage('thread')).toEqual(original)
    expect(store.historyPage('thread')).toEqual(new WorkspaceStore(db).historyPage('thread'))
  } finally {
    db.close()
  }
})
