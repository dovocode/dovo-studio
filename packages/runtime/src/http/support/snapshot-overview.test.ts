import { expect, it } from 'vite-plus/test'
import { taskBudgetUsage, summarizeTask, type Task, type Workspace } from '@dovo/protocol'
import { scopedWorkspace, snapshotWorkspace, pagedSummaryTask } from './snapshot-overview'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
const task: Task = {
  id: 'thread',
  title: 'Long conversation',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'review',
  createdAt: '2026-10-01T00:00:00Z',
  draft: '',
  files: [],
  example: false,
  messages: Array.from({ length: 80 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}`,
  })),
  turns: Array.from({ length: 40 }, (_, index) => ({
    id: `turn${index}`,
    assistantId: `m${index * 2 + 1}`,
    agentId: 'agent',
    provider: 'codex',
    model: '',
    status: 'completed',
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-01T00:01:00Z',
    tokens: 10,
    ...(index === 0
      ? {
          checkpoint: {
            before: 'before',
            after: 'after',
            files: [{ path: 'file.txt', before: 'before', after: 'after', viewed: false }],
            omitted: [],
          },
        }
      : {}),
  })),
}
const workspace: Workspace = {
  version: 1,
  tasks: [task],
  agents: [],
  repositories: [],
  automations: [],
  runtimeAddress: '',
}
it('negotiates paging without changing legacy snapshots or losing budget and change metadata', () => {
  expect(scopedWorkspace(workspace, [task.id]).tasks[0]).toBe(task)
  const paged = scopedWorkspace(workspace, [task.id], true).tasks[0]!
  expect(paged.messages).toHaveLength(20)
  expect(paged.turns).toHaveLength(10)
  expect(paged.historyBefore).toBe('m60')
  expect(paged.historyTotals?.undoableTurnId).toBe('turn0')
  expect(paged.historyTotals?.hasChanges).toBe(true)
  expect(taskBudgetUsage(paged)).toEqual(taskBudgetUsage(task))
  expect(scopedWorkspace(workspace, [task.id], true).tasks[0]).toBe(paged)
  expect(task.messages).toHaveLength(80)
})
it('shares equivalent selections while isolating subscriptions, paging and workspace changes', () => {
  const second = { ...task, id: 'second' }
  const host = { ...workspace, tasks: [task, second] }
  const selected = scopedWorkspace(host, ['thread', 'second'], true)
  expect(scopedWorkspace(host, ['second', 'thread', 'thread'], true)).toBe(selected)
  const firstOnly = scopedWorkspace(host, ['thread'], true)
  expect(firstOnly).not.toBe(selected)
  expect(firstOnly.tasks[1]?.messages).toEqual([])
  expect(scopedWorkspace(host, ['thread', 'second'], false)).not.toBe(selected)
  const changed = { ...host, tasks: [{ ...task, title: 'Changed' }, second] }
  expect(scopedWorkspace(changed, ['thread', 'second'], true)).not.toBe(selected)
  expect(scopedWorkspace(changed, ['thread'], true).tasks[0]?.title).toBe('Changed')
})
it('bounds cached selection variants within a live workspace', () => {
  const host = { ...workspace }
  const original = scopedWorkspace(host, ['thread'], true)
  for (let index = 0; index < 16; index++) scopedWorkspace(host, [`other-${index}`], true)
  expect(scopedWorkspace(host, ['thread'], true)).not.toBe(original)
})

it('projects overview summaries without reading history and preserves aggregate usage', () => {
  const host = { ...workspace, tasks: [summarizeTask(task)] }
  const histories = {
    publicTask: () => {
      throw new Error('Overview must not read complete histories')
    },
    publicCompleteTasks() {
      throw new Error('Overview must not enumerate complete histories')
    },
  }
  const overview = snapshotWorkspace(host, histories, { overview: true })
  expect(overview.tasks[0]?.messages).toEqual([])
  expect(overview.tasks[0]?.turns).toHaveLength(1)
  expect(taskBudgetUsage(overview.tasks[0]!)).toEqual(taskBudgetUsage(task))
  expect(snapshotWorkspace(host, histories, { overview: true })).toBe(overview)
})

it('loads complete history only for subscribed tasks and keeps legacy reads complete', () => {
  const second = { ...task, id: 'second' }
  const host = { ...workspace, tasks: [task, second].map(summarizeTask) }
  const requested: string[] = []
  const histories = {
    publicTask: (id: string) => {
      requested.push(id)
      return id === task.id ? task : second
    },
    *publicCompleteTasks() {
      for (const [index, summary] of host.tasks.entries())
        yield { summary, task: [task, second][index]! }
    },
  }
  const scoped = snapshotWorkspace(host, histories, { taskIds: ['thread'], pagedHistory: true })
  expect(requested).toEqual(['thread'])
  expect(scoped.tasks[0]?.messages).toHaveLength(20)
  expect(scoped.tasks[1]?.messages).toEqual([])
  expect(taskBudgetUsage(scoped.tasks[0]!)).toEqual(taskBudgetUsage(task))
  const legacy = snapshotWorkspace(host, histories, {})
  expect(legacy.tasks[0]).toBe(task)
  expect(legacy.tasks[1]).toBe(second)
  expect(legacy.tasks[0]?.messages).toHaveLength(80)
})

it.each(['plain', 'linked', 'error', 'undone'] as const)(
  'builds a database page with identical %s checkpoint and budget totals without full hydration',
  (mode) => {
    const db = openDatabase(':memory:')
    try {
      const checkpoint = task.turns![0]!.checkpoint!
      const source: Task = {
        ...task,
        turns: task.turns!.map((turn, index) =>
          index !== 0
            ? turn
            : {
                ...turn,
                checkpoint:
                  mode === 'linked'
                    ? {
                        ...checkpoint,
                        files: [],
                        linked: [
                          {
                            ...checkpoint,
                            checkoutId: 'other',
                            repositoryId: 'other',
                            directory: '/tmp/other',
                          },
                        ],
                      }
                    : mode === 'error'
                      ? { ...checkpoint, error: 'Capture failed' }
                      : mode === 'undone'
                        ? {
                            ...checkpoint,
                            undone: { at: '2026-10-01T01:00:00Z', backup: 'backup' },
                          }
                        : checkpoint,
              },
        ),
      }
      const writer = new WorkspaceStore(db)
      writer.update(() => ({ ...workspace, tasks: [source] }))
      const store = new WorkspaceStore(db)
      const summary = store.publicWorkspace().tasks[0]!
      const paged = pagedSummaryTask(db, summary, store.historyPage(source.id)!)
      const expected = scopedWorkspace({ ...workspace, tasks: [source] }, [source.id], true)
        .tasks[0]!
      expect(paged.messages).toEqual(expected.messages)
      expect(paged.turns).toEqual(expected.turns)
      expect(paged.historyBefore).toBe(expected.historyBefore)
      expect(paged.historyTotals).toEqual(expected.historyTotals)
      expect(taskBudgetUsage(paged)).toEqual(taskBudgetUsage(source))
      expect(store.retainedHistories().tasks).toEqual([])
      expect(pagedSummaryTask(db, summary, store.historyPage(source.id)!)).toBe(paged)
    } finally {
      db.close()
    }
  },
)
