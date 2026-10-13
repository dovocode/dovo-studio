import { expect, it } from 'vite-plus/test'
import { createTask, type Task } from '@dovo/studio-core'
import { taskClockInterval } from './task-clock'

const now = Date.parse('2026-10-13T12:00:00Z')
const task = createTask({ title: 'Clock', repositoryId: 'repo', agentId: '', objective: '' })
const turn = (startedAt: string, finishedAt?: string): NonNullable<Task['turns']>[number] => ({
  id: 'turn',
  assistantId: 'assistant',
  agentId: '',
  provider: 'codex',
  model: '',
  status: finishedAt ? 'completed' : 'running',
  startedAt,
  ...(finishedAt ? { finishedAt } : {}),
})

it('counts seconds only during the first minute of running work', () => {
  expect(
    taskClockInterval({ ...task, status: 'running', turns: [turn('2026-10-13T11:59:30Z')] }, now),
  ).toBe(1000)
  expect(
    taskClockInterval({ ...task, status: 'running', turns: [turn('2026-10-13T11:58:00Z')] }, now),
  ).toBe(60000)
  expect(
    taskClockInterval(
      {
        ...task,
        status: 'running',
        runPhase: 'finalizing',
        turns: [turn('2026-10-13T11:59:30Z')],
      },
      now,
    ),
  ).toBe(60000)
})

it('updates finished and snoozed labels per minute and leaves timeless rows without a clock', () => {
  expect(
    taskClockInterval(
      { ...task, status: 'done', turns: [turn('2026-10-13T11:00:00Z', '2026-10-13T11:05:00Z')] },
      now,
    ),
  ).toBe(60000)
  expect(taskClockInterval({ ...task, snoozedUntil: '2026-10-13T13:00:00Z' }, now)).toBe(60000)
  expect(taskClockInterval(task, now)).toBeNull()
})
