import { expect, it } from 'vitest'
import {
  hasUnviewedTaskCompletion,
  latestCompletedTaskTurn,
  type Task,
  type TaskTurn,
} from './workspace.js'
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
  createdAt: '',
  messages: [],
  files: [],
  draft: '',
  example: false,
  turns: [turn],
}
it('marks only a new successful completion as unviewed', () => {
  expect(latestCompletedTaskTurn(task)).toEqual(turn)
  expect(hasUnviewedTaskCompletion(task)).toBe(true)
  expect(hasUnviewedTaskCompletion({ ...task, lastViewedTurnId: turn.id })).toBe(false)
  expect(hasUnviewedTaskCompletion({ ...task, status: 'done' })).toBe(true)
  expect(hasUnviewedTaskCompletion({ ...task, archived: true })).toBe(false)
  expect(hasUnviewedTaskCompletion({ ...task, turns: [] })).toBe(false)
  expect(
    hasUnviewedTaskCompletion({
      ...task,
      lastViewedTurnId: turn.id,
      turns: [turn, { ...turn, id: 'next' }],
    }),
  ).toBe(true)
})
it.each(['draft', 'running', 'failed', 'cancelled'] as const)(
  'does not show a previous successful turn while task is %s',
  (status) => {
    expect(latestCompletedTaskTurn({ ...task, status })).toBeUndefined()
    expect(hasUnviewedTaskCompletion({ ...task, status })).toBe(false)
  },
)
it.each(['running', 'failed', 'cancelled'] as const)(
  'does not skip a latest %s turn to find an older completion',
  (status) => {
    expect(
      latestCompletedTaskTurn({ ...task, turns: [turn, { ...turn, id: 'newer', status }] }),
    ).toBeUndefined()
  },
)
