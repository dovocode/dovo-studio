import { expect, it } from 'vite-plus/test'
import { sideThreadAttention, sideThreadAttentionTarget } from './side-thread-attention.js'
import type { Task } from '../workspace.js'

const child = (id: string): Pick<Task, 'id' | 'sideThread'> => ({
  id,
  sideThread: {
    parentTaskId: 'parent',
    objective: '',
    source: 'head',
    contextMessageCount: 0,
    parentHistoryRevision: 0,
    contextHash: '',
    permissionCeiling: { provider: 'codex', permission: 'read-only' },
  },
})

it('prioritizes approvals and includes delegated descendants without unrelated inputs', () => {
  const snapshot = {
    workspace: {
      tasks: [
        { id: 'parent' },
        child('first'),
        child('second'),
        { id: 'worker', delegation: { parentTaskId: 'second', parentRunId: 'run', key: 'worker' } },
      ],
    },
    approvals: [
      { id: 'unrelated-approval', taskId: 'unrelated' },
      { id: 'worker-approval', taskId: 'worker' },
      { id: 'second-approval', taskId: 'second' },
    ],
    questions: [{ id: 'first-question', taskId: 'first' }],
  }
  expect(sideThreadAttention(snapshot, 'first')).toBe('input')
  expect(sideThreadAttention(snapshot, 'second')).toBe('approval')
  expect(sideThreadAttentionTarget(snapshot, 'parent')).toEqual({
    id: 'second',
    kind: 'approval',
    requestId: 'worker-approval',
  })
  expect(sideThreadAttentionTarget({ ...snapshot, approvals: [] }, 'parent')).toEqual({
    id: 'first',
    kind: 'input',
    requestId: 'first-question',
  })
  expect(sideThreadAttentionTarget(snapshot, 'unrelated')).toBeUndefined()
  expect(sideThreadAttention(snapshot, 'unrelated')).toBeUndefined()
})

it('ignores ordinary questions routed to an agent and clears when input is resolved', () => {
  const snapshot = {
    workspace: { tasks: [child('child')] },
    approvals: [],
    questions: [{ id: 'parent-question', taskId: 'child', routing: 'parent' as const }],
  }
  expect(sideThreadAttention(snapshot, 'child')).toBeUndefined()
  expect(sideThreadAttentionTarget(snapshot, 'parent')).toBeUndefined()
  expect(sideThreadAttention(undefined, 'child')).toBeUndefined()
  expect(sideThreadAttentionTarget(null, 'parent')).toBeUndefined()
})
