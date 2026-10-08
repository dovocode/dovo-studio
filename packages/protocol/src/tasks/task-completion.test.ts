import { expect, it } from 'vite-plus/test'
import {
  hasUnreadTaskActivity,
  hasUnviewedTaskCompletion,
  latestCompletedTaskTurn,
  type Task,
  type TaskTurn,
} from '../workspace.js'
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
it('keeps a new run unread through completion until its response is viewed', () => {
  const previous = { ...task, lastViewedTurnId: turn.id }
  expect(hasUnreadTaskActivity(previous)).toBe(false)
  const running: Task = {
    ...previous,
    status: 'running',
    turns: [turn, { ...turn, id: 'next', status: 'running', finishedAt: undefined }],
  }
  expect(hasUnreadTaskActivity(running)).toBe(true)
  expect(hasUnviewedTaskCompletion(running)).toBe(false)
  expect(latestCompletedTaskTurn(running)).toBeUndefined()
  expect(hasUnreadTaskActivity({ ...running, runPhase: 'finalizing' })).toBe(true)
  const completed: Task = { ...previous, turns: [turn, { ...turn, id: 'next' }] }
  expect(hasUnreadTaskActivity(completed)).toBe(true)
  expect(hasUnreadTaskActivity({ ...completed, lastViewedTurnId: 'next' })).toBe(false)
})
it('highlights the first run before any successful completion exists', () => {
  expect(hasUnreadTaskActivity({ ...task, status: 'running', turns: [] })).toBe(true)
})
it.each(['draft', 'failed', 'cancelled'] as const)(
  'preserves read styling for a %s thread',
  (status) => {
    expect(hasUnreadTaskActivity({ ...task, status })).toBe(false)
  },
)
it('keeps settled and archived threads read even with cached running state', () => {
  expect(hasUnreadTaskActivity({ ...task, status: 'running', archived: true })).toBe(false)
  expect(
    hasUnreadTaskActivity({ ...task, status: 'running', archivedAt: '2026-10-08T00:00:00Z' }),
  ).toBe(false)
})
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
