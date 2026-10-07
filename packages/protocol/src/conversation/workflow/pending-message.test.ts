import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { taskSchema } from '../../workspace'
import {
  visiblePendingMessage,
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
