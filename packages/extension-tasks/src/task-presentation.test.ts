import { expect, it } from 'vite-plus/test'
import { createTask, type Task } from '@dovo/studio-core'
import { taskPresentation } from './task-presentation'

const now = Date.parse('2026-09-20T12:10:00Z')
const task = (status: Task['status']): Task => ({
  ...createTask({ title: 'Review folders', objective: '', repositoryId: 'repo', agentId: 'agent' }),
  status,
  lastViewedTurnId: 'turn',
  turns: [
    {
      id: 'turn',
      assistantId: 'message',
      provider: 'codex',
      agentId: 'agent',
      model: 'default',
      startedAt: '2026-09-20T12:00:00Z',
      finishedAt: status === 'running' ? undefined : '2026-09-20T12:05:00Z',
      status: status === 'running' ? 'running' : 'completed',
    },
  ],
})

it('keeps review, failure and completion visible alongside the finish age', () => {
  expect(taskPresentation(task('review'), false, now).label).toBe('Review · 5m ago')
  expect(taskPresentation(task('failed'), false, now).label).toBe('Failed · 5m ago')
  expect(taskPresentation(task('done'), false, now).label).toBe('Finished · 5m ago')
})

it('shows Done only until the latest completed turn has been viewed', () => {
  for (const status of ['review', 'done'] as const) {
    const unread = { ...task(status), lastViewedTurnId: undefined }
    expect(taskPresentation(unread, false, now)).toMatchObject({
      state: 'Done',
      compactLabel: 'Done',
      label: 'Done · 5m ago',
    })
    expect(taskPresentation({ ...unread, lastViewedTurnId: 'turn' }, false, now)).toMatchObject({
      state: status === 'review' ? 'Review' : 'Finished',
      compactLabel: '5m',
    })
    expect(
      taskPresentation({ ...unread, lastViewedTurnId: 'earlier-turn' }, false, now).state,
    ).toBe('Done')
  }
})

it('keeps input, failure, active work, stopped, snoozed and settled states ahead of unread completion', () => {
  const unread = { ...task('review'), lastViewedTurnId: undefined }
  expect(taskPresentation(unread, true, now).compactLabel).toBe('Needs input')
  expect(taskPresentation({ ...unread, status: 'failed' }, false, now).compactLabel).toBe('Failed')
  expect(taskPresentation({ ...unread, status: 'running' }, false, now).compactLabel).toBe(
    'Working 10m 0s',
  )
  expect(taskPresentation({ ...unread, status: 'cancelled' }, false, now).compactLabel).toBe(
    'Stopped',
  )
  expect(taskPresentation({ ...unread, archived: true }, true, now).compactLabel).toBe('Settled')
  expect(
    taskPresentation({ ...unread, snoozedUntil: '2026-09-20T13:00:00Z' }, true, now).compactLabel,
  ).toBe('Snoozed')
})

it('does not invent unread completion for legacy done tasks without a completed turn', () => {
  expect(
    taskPresentation({ ...task('done'), turns: [], lastViewedTurnId: undefined }, false, now),
  ).toMatchObject({
    state: 'Finished',
    compactLabel: 'Finished',
  })
})

it('shows active duration and input state without replacing either', () => {
  expect(taskPresentation(task('running'), false, now).label).toBe('Working · 10m 0s')
  expect(taskPresentation(task('running'), true, now).label).toBe('Needs input · 10m 0s')
})

it('retains settled and snoozed states and handles drafts without turn timestamps', () => {
  expect(taskPresentation({ ...task('done'), archived: true }, false, now).state).toBe('Settled')
  expect(
    taskPresentation({ ...task('review'), snoozedUntil: '2026-09-20T13:00:00Z' }, false, now).state,
  ).toBe('Snoozed')
  expect(taskPresentation({ ...task('draft'), turns: [] }, false, now).label).toBe('Draft')
})
