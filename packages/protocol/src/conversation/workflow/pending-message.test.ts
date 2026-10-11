import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { taskSchema } from '../../workspace'
import {
  visiblePendingMessage,
  visiblePendingMessages,
  mergePendingMessages,
  savedPendingMessages,
  pendingMessageDestination,
  pendingMessageQueue,
  startingConversationMessage,
  type PendingMessage,
} from './pending-message'

it('shows local delivery immediately but removes it on message or queue acknowledgement', () => {
  const task = decode(taskSchema, {
    id: 't',
    title: 'Task',
    repositoryId: 'r',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const pending: PendingMessage = {
    taskId: 't',
    state: 'sending',
    message: { id: 'm', role: 'user', text: 'Hello' },
  }
  expect(visiblePendingMessage(task, pending)).toBe(pending)
  expect(task.messages).toEqual([])
  expect(visiblePendingMessage({ ...task, messages: [pending.message] }, pending)).toBeNull()
  expect(
    visiblePendingMessage(
      { ...task, queue: [{ ...pending.message, role: 'user', createdAt: '2026-09-24T12:00:00Z' }] },
      pending,
    ),
  ).toBeNull()
  expect(visiblePendingMessage({ ...task, id: 'other' }, pending)).toBeNull()
  expect(visiblePendingMessage(task, { ...pending, state: 'failed' })?.state).toBe('failed')
})

it('routes active follow-ups directly into the queue and preserves acknowledgement order', () => {
  expect(pendingMessageDestination({ status: 'running' }, 'queue')).toBe('queue')
  expect(pendingMessageDestination({ status: 'cancelled' }, 'queue')).toBe('thread')
  expect(pendingMessageDestination({ status: 'running' }, 'steer')).toBe('thread')
  const first = { id: 'first', role: 'user' as const, text: 'First', createdAt: 'now' }
  const task = { id: 't', messages: [], queue: [first] }
  const pending: PendingMessage = {
    taskId: 't',
    state: 'sending',
    destination: 'queue',
    message: { id: 'next', role: 'user', text: 'Next', createdAt: 'later' },
  }
  expect(pendingMessageDestination({ status: 'cancelled', queue: task.queue }, 'queue')).toBe(
    'queue',
  )
  const preview = pendingMessageQueue(task, pending)
  expect(preview.map((message) => message.id)).toEqual(['first', 'next'])
  expect(task.queue).toEqual([first])
  expect(pendingMessageQueue({ ...task, queue: preview }, pending)).toEqual(preview)
  expect(pendingMessageQueue({ ...task, messages: [pending.message] }, pending)).toEqual([first])
  expect(pendingMessageQueue(task, { ...pending, destination: 'thread' })).toEqual([first])
})

it('presents the first accepted message in the thread throughout startup', () => {
  const first = { id: 'first', role: 'user' as const, text: 'Build it', createdAt: 'now' }
  const task = { messages: [], turns: [], queue: [first], status: 'draft' as const }
  expect(startingConversationMessage(task)).toBe(first)
  expect(startingConversationMessage({ ...task, status: 'running', runPhase: 'preparing' })).toBe(
    first,
  )
  expect(startingConversationMessage({ ...task, messages: [first], queue: [] })).toBeUndefined()
})
it('keeps paused, failed and follow-up inputs in the queue', () => {
  const first = { id: 'first', role: 'user' as const, text: 'Build it', createdAt: 'now' }
  const task = {
    messages: [],
    queue: [first],
    status: 'running' as const,
    runPhase: 'preparing' as const,
  }
  expect(startingConversationMessage({ ...task, queuePaused: true })).toBeUndefined()
  expect(startingConversationMessage({ ...task, status: 'failed' })).toBeUndefined()
  expect(
    startingConversationMessage({ ...task, messages: [{ ...first, id: 'previous' }] }),
  ).toBeUndefined()
})

it('does not show a handed-off message in the queue while its history arrives before the queue snapshot', () => {
  const handedOff = { id: 'steered', role: 'user' as const, text: 'Direction', createdAt: '' }
  const later = { ...handedOff, id: 'later', text: 'Later' }
  expect(
    pendingMessageQueue({ id: 'task', messages: [handedOff], queue: [handedOff, later] }, null),
  ).toEqual([later])
})

it('keeps multiple local sends ordered and hands each off independently', () => {
  const task = { id: 't', messages: [], queue: [] }
  const first: PendingMessage = {
    taskId: 't',
    state: 'sending',
    destination: 'thread',
    message: { id: 'first', role: 'user', text: 'First' },
  }
  const second: PendingMessage = {
    ...first,
    destination: 'queue',
    message: { ...first.message, id: 'second', text: 'Second' },
  }
  expect(visiblePendingMessages(task, [first, second]).map((item) => item.message.id)).toEqual([
    'first',
    'second',
  ])
  const accepted = { ...task, messages: [first.message] }
  expect(visiblePendingMessages(accepted, [first, second])).toEqual([second])
  expect(pendingMessageQueue(accepted, [first, second]).map((item) => item.id)).toEqual(['second'])
  expect(
    visiblePendingMessages(
      { ...accepted, queue: [{ ...second.message, role: 'user', createdAt: '' }] },
      [first, second],
    ),
  ).toEqual([])
})

it('restores saved sends from the journal without borrowing another thread or accepting malformed input', () => {
  const task = decode(taskSchema, {
    id: 't',
    title: 'Task',
    repositoryId: 'r',
    agentId: '',
    status: 'running',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const journal = [
    {
      id: 'one',
      path: '/api/tasks/message',
      method: 'POST' as const,
      input: { id: 't', messageId: 'first', text: 'First' },
    },
    {
      id: 'two',
      path: '/api/tasks/steer',
      method: 'POST' as const,
      blocked: true,
      input: { id: 't', messageId: 'second', text: 'Second' },
    },
    {
      id: 'other',
      path: '/api/tasks/message',
      method: 'POST' as const,
      input: { id: 'other', messageId: 'third', text: 'Other' },
    },
    {
      id: 'bad',
      path: '/api/tasks/message',
      method: 'POST' as const,
      input: { id: 't', text: 'Missing ID' },
    },
  ]
  const saved = savedPendingMessages(task, journal)
  expect(saved.map((item) => [item.message.id, item.state, item.destination])).toEqual([
    ['first', 'saved', 'queue'],
    ['second', 'failed', 'thread'],
  ])
  expect(task.messages).toEqual([])
  expect(mergePendingMessages(task, saved, [{ ...saved[1]!, state: 'saved' }])[1]?.state).toBe(
    'failed',
  )
  expect(mergePendingMessages(task, [], [{ ...saved[0]!, state: 'saved' }])).toEqual([])
})
