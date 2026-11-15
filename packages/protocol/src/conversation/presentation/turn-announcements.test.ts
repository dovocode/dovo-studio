import { expect, it, vi } from 'vite-plus/test'
import { TurnAnnouncementsTracker } from './turn-announcements.js'
import { taskSchema } from '../../workspace.js'
import { decode } from '../../shared/schema.js'

const thread = () =>
  decode(taskSchema, {
    files: [],
    draft: '',
    example: false,
    id: 'thread',
    title: 'Test',
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'running',
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        turnId: 'turn',
        text: 'Old text. New text.',
        textBreaks: [9],
      },
    ],
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: 'agent',
        provider: 'opencode',
        model: 'test',
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

it('ignores history and streaming deltas, then reads each completed chunk once', () => {
  const tracker = new TurnAnnouncementsTracker()
  const task = thread()
  expect(tracker.update('one', task, [], 'messages')).toEqual([])
  task.messages[0]!.text += ' More'
  expect(tracker.update('one', task, [], 'messages')).toEqual([])
  task.messages[0]!.textBreaks = [9, 19]
  expect(tracker.update('one', task, [], 'messages')).toEqual(['New text.'])
  expect(tracker.update('one', task, [], 'messages')).toEqual([])
  task.turns![0]!.status = 'completed'
  task.status = 'review'
  expect(tracker.update('one', task, [], 'messages')).toEqual(['Turn finished.', 'More'])
})

it('clears navigation and mode state and ignores old paged messages', () => {
  const tracker = new TurnAnnouncementsTracker()
  const task = thread()
  tracker.update('one', task, [], 'messages')
  task.messages.unshift({ id: 'old-reply', role: 'assistant', text: 'Do not replay' })
  task.turns!.unshift({
    ...task.turns![0]!,
    id: 'old-turn',
    assistantId: 'old-reply',
    startedAt: '2020-01-01T00:00:00Z',
    status: 'completed',
  })
  expect(tracker.update('one', task, [], 'messages')).toEqual([])
  expect(tracker.update('two', task, [], 'steps')).toEqual([])
  task.status = 'cancelled'
  expect(tracker.update('two', task, [], 'steps')).toEqual(['Turn stopped.'])
  expect(tracker.update('two', task, [], 'off')).toEqual([])
})

it('announces completed steps, never tool payloads, with bounded messages', () => {
  vi.useFakeTimers()
  try {
    const tracker = new TurnAnnouncementsTracker()
    const task = thread()
    tracker.update('one', task, [], 'steps')
    const steps = [{ id: 'read', turnId: 'turn', status: 'running', summary: 'Read file' }]
    expect(tracker.update('one', task, steps, 'steps')).toEqual([])
    steps[0]!.status = 'completed'
    expect(tracker.update('one', task, steps, 'steps')).toEqual(['Read file. completed.'])
    expect(tracker.update('one', task, steps, 'steps')).toEqual([])
    task.messages[0]!.text = 'x'.repeat(10000)
    task.messages[0]!.textBreaks = [10000]
    const result = tracker.update('one', task, steps, 'steps')
    expect(result[0]!.length).toBeLessThan(1700)
    expect(result[0]).toContain('Read the thread')
  } finally {
    vi.useRealTimers()
  }
})

it('translates status text without translating the assistant response', () => {
  const tracker = new TurnAnnouncementsTracker()
  const task = thread()
  const translate = (text: string) => (text === 'Turn finished.' ? 'Beurt voltooid.' : 'CHANGED')
  tracker.update('one', task, [], 'messages', translate)
  task.turns![0]!.status = 'completed'
  task.status = 'review'
  expect(tracker.update('one', task, [], 'messages', translate)).toEqual([
    'Beurt voltooid.',
    'New text.',
  ])
})
