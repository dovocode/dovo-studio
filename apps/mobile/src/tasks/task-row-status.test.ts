import { describe, expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import { showTaskDone, taskRowStatus } from './task-row-status'
const task: Task = {
  id: 'task',
  title: 'Fix tests',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'review',
  lastViewedTurnId: 'turn',
  createdAt: '2026-09-20T10:00:00Z',
  example: false,
  draft: '',
  files: [],
  messages: [],
  turns: [
    {
      id: 'turn',
      assistantId: 'reply',
      agentId: 'agent',
      provider: 'codex',
      model: 'test-model',
      status: 'completed',
      startedAt: '2026-09-20T10:00:00Z',
      finishedAt: '2026-09-20T10:04:00Z',
    },
  ],
}
const now = Date.parse('2026-09-20T10:08:00Z')
describe('mobile thread status', () => {
  it('retains review, failure and stopped state after a turn finishes', () => {
    expect(taskRowStatus(task, false, true, now)).toBe('Review · 4m')
    expect(
      taskRowStatus(
        {
          ...task,
          status: 'failed',
        },
        false,
        true,
        now,
      ),
    ).toBe('Failed · 4m')
    expect(
      taskRowStatus(
        {
          ...task,
          status: 'cancelled',
        },
        false,
        true,
        now,
      ),
    ).toBe('Stopped · 4m')
  })
  it('prioritizes input requests and marks cached working state', () => {
    expect(taskRowStatus(task, true, true, now)).toBe('Needs input')
    expect(
      taskRowStatus(
        {
          ...task,
          status: 'running',
        },
        false,
        false,
        now,
      ),
    ).toBe('Was working · 8m')
  })
  it('keeps draft and snoozed tasks explicit', () => {
    expect(
      taskRowStatus(
        {
          ...task,
          status: 'draft',
          turns: [],
        },
        false,
        true,
        now,
      ),
    ).toBe('Draft')
    expect(
      taskRowStatus(
        {
          ...task,
          snoozedUntil: '2026-09-21T10:00:00Z',
        },
        false,
        true,
        now,
      ),
    ).toBe('Snoozed · 4m')
  })
  it('shows Done only until the latest completed turn has been viewed', () => {
    const unread = {
      ...task,
      lastViewedTurnId: undefined,
    }
    expect(taskRowStatus(unread, false, true, now)).toBe('Done · 4m')
    expect(showTaskDone(unread, false, now)).toBe(true)
    expect(taskRowStatus(task, false, true, now)).toBe('Review · 4m')
    expect(showTaskDone(task, false, now)).toBe(false)
    const next = {
      ...task,
      turns: [
        {
          ...task.turns![0],
          id: 'next',
        },
      ],
    }
    expect(taskRowStatus(next, false, true, now)).toBe('Done · 4m')
  })
  it('never lets unread completion hide input, snooze, failure, cancellation or settled state', () => {
    const unread = {
      ...task,
      lastViewedTurnId: undefined,
    }
    expect(showTaskDone(unread, true, now)).toBe(false)
    for (const hidden of [
      {
        ...unread,
        archived: true,
      },
      {
        ...unread,
        snoozedUntil: '2026-09-21T10:00:00Z',
      },
      {
        ...unread,
        status: 'failed' as const,
      },
      {
        ...unread,
        status: 'cancelled' as const,
      },
      {
        ...unread,
        status: 'running' as const,
      },
    ])
      expect(showTaskDone(hidden, false, now)).toBe(false)
    expect(
      taskRowStatus(
        {
          ...unread,
          status: 'failed',
        },
        false,
        true,
        now,
      ),
    ).toBe('Failed · 4m')
  })
})

it('shows change capture separately from provider work', () => {
  expect(
    taskRowStatus({ ...task, status: 'running', runPhase: 'finalizing' }, false, true, now),
  ).toBe('Saving changes · 4m')
})
