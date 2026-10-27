import { expect, it, vi } from 'vite-plus/test'
import { runtimeProfile, type RuntimeProfile, type Task } from '@dovo/protocol'
import {
  taskListActionHandlers,
  taskListActionInput,
  type TaskListAction,
} from './task-list-action'

const task: Task = {
  id: 'thread',
  title: 'Thread',
  repositoryId: '',
  agentId: '',
  status: 'draft',
  createdAt: '2026-09-23T00:00:00Z',
  example: false,
  draft: '',
  files: [],
  messages: [],
  archived: false,
  snoozedUntil: '2026-11-01T00:00:00Z',
}

it('sends the prior lifecycle state as the atomic action precondition', () => {
  expect(taskListActionInput('settle', task)).toEqual({
    action: 'settle',
    id: 'thread',
    expectedArchived: false,
    expectedSnoozedUntil: '2026-11-01T00:00:00Z',
    snoozedUntil: null,
  })
  expect(
    taskListActionInput(
      'snooze',
      { ...task, archived: undefined, snoozedUntil: undefined },
      '2026-12-01T00:00:00Z',
    ),
  ).toEqual({
    action: 'snooze',
    id: 'thread',
    expectedArchived: null,
    expectedSnoozedUntil: null,
    snoozedUntil: '2026-12-01T00:00:00Z',
  })
})

it('uses existing mutations on older computers without queuing an Undo request', () => {
  const owner = runtimeProfile(
    { address: 'http://legacy.lan', token: 'legacy-token-at-least-32-characters' },
    'Legacy',
  )
  const lifecycle = {
    toggleSettled: vi.fn<() => void>(),
    snooze: vi.fn<(until: string | null) => void>(),
  }
  const undo =
    vi.fn<(action: TaskListAction, task: Task, profile: RuntimeProfile, until?: string) => void>()
  const actions = taskListActionHandlers(task, owner, false, lifecycle, undo)
  actions.toggleSettled()
  actions.snooze('2026-12-01T00:00:00Z')
  actions.snooze(null)
  expect(lifecycle.toggleSettled).toHaveBeenCalledOnce()
  expect(lifecycle.snooze.mock.calls).toEqual([['2026-12-01T00:00:00Z'], [null]])
  expect(undo).not.toHaveBeenCalled()
})

it('uses Undo only for new settle and snooze actions on the owning computer', () => {
  const owner = runtimeProfile(
    { address: 'http://modern.lan', token: 'modern-token-at-least-32-characters' },
    'Modern',
  )
  const lifecycle = {
    toggleSettled: vi.fn<() => void>(),
    snooze: vi.fn<(until: string | null) => void>(),
  }
  const undo =
    vi.fn<(action: TaskListAction, task: Task, profile: RuntimeProfile, until?: string) => void>()
  const actions = taskListActionHandlers(task, owner, true, lifecycle, undo)
  actions.toggleSettled()
  actions.snooze('2026-12-01T00:00:00Z')
  actions.snooze(null)
  taskListActionHandlers({ ...task, archived: true }, owner, true, lifecycle, undo).toggleSettled()
  expect(undo.mock.calls).toEqual([
    ['settle', task, owner],
    ['snooze', task, owner, '2026-12-01T00:00:00Z'],
  ])
  expect(lifecycle.snooze).toHaveBeenCalledWith(null)
  expect(lifecycle.toggleSettled).toHaveBeenCalledOnce()
})
