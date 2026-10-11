import { expect, it } from 'vite-plus/test'
import { taskBudgetUsage, type Task, type Workspace } from '@dovo/protocol'
import { scopedWorkspace } from './snapshot-overview'
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
