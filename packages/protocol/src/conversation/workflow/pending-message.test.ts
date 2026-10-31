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

it('projects batched previews with the same ordering and handoff semantics as individual checks', () => {
  const message = (id: string) => ({ id, role: 'user' as const, text: id, createdAt: '' })
  const pending: PendingMessage[] = [
    { taskId: 't', message: message('new'), state: 'sending' },
    { taskId: 'other', message: message('foreign'), state: 'saved' },
    { taskId: 't', message: message('delivered'), state: 'saved' },
    { taskId: 't', message: message('steering'), state: 'failed' },
    { taskId: 't', message: message('new'), state: 'failed' },
  ]
  for (const status of ['running', 'cancelled'] as const) {
    const task = {
      id: 't',
      status,
      messages: [message('delivered')],
      queue: [
        { ...message('steering'), steering: true },
        { ...message('delivered'), steering: true },
      ],
    }
    for (let count = 0; count <= pending.length; count++) {
      const items = pending.slice(0, count)
      const expected = new Map<string, PendingMessage>()
      for (const item of items)
        if (visiblePendingMessage(task, item)) expected.set(item.message.id, item)
      for (const queued of task.queue)
        if (
          queued.steering &&
          status === 'running' &&
          !task.messages.some((entry) => entry.id === queued.id)
        )
          expected.set(queued.id, {
            taskId: task.id,
            message: queued,
            state: 'sending',
            destination: 'thread',
          })
      expect(visiblePendingMessages(task, items)).toEqual([...expected.values()])
    }
  }
})

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
      input: {
        id: 't',
        messageId: 'first',
        text: 'First',
        turnSettings: { provider: 'codex', model: 'large', reasoning: 'high' },
      },
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
  expect(saved[0]?.message.turnSettings).toEqual({
    provider: 'codex',
    model: 'large',
    reasoning: 'high',
  })
  expect(pendingMessageQueue(task, saved)[0]?.turnSettings).toEqual(saved[0]?.message.turnSettings)
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

it('keeps an in-flight steering handoff in chat across devices, then restores failed delivery to the queue', () => {
  const steering = {
    id: 'steer',
    role: 'user' as const,
    text: 'Change direction',
    createdAt: '',
    steering: true,
  }
  const later = { id: 'later', role: 'user' as const, text: 'After this', createdAt: '' }
  const task = { id: 'task', status: 'running' as const, messages: [], queue: [steering, later] }
  expect(visiblePendingMessages(task, [])).toEqual([
    { taskId: 'task', message: steering, state: 'sending', destination: 'thread' },
  ])
  expect(pendingMessageQueue(task, null)).toEqual([later])
  const delivered = { ...task, messages: [steering] }
  expect(visiblePendingMessages(delivered, [])).toEqual([])
  expect(pendingMessageQueue(delivered, null)).toEqual([later])
  const failed = { ...task, queue: [{ ...steering, steering: undefined }, later] }
  expect(visiblePendingMessages(failed, [])).toEqual([])
  expect(pendingMessageQueue(failed, null)).toEqual(failed.queue)
  expect(pendingMessageQueue({ ...task, status: 'cancelled' }, null)).toEqual(task.queue)
})

it('waits at a paused starter and only shows runnable input at the front', () => {
  const paused = { id: 'held', role: 'user' as const, text: 'Held', createdAt: '', paused: true }
  const ready = { id: 'ready', role: 'user' as const, text: 'Ready', createdAt: '' }
  const task = { messages: [], status: 'draft' as const, queue: [paused, ready] }
  expect(startingConversationMessage(task)).toBeUndefined()
  expect(startingConversationMessage({ ...task, queue: [paused] })).toBeUndefined()
  expect(startingConversationMessage({ ...task, queue: [ready, paused] })).toBe(ready)
  expect(
    startingConversationMessage({ ...task, queue: [{ ...paused, paused: false }, ready] })?.id,
  ).toBe('held')
})

it('keeps staged first prompts and their plan settings in the queue across reconnect', () => {
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
  expect(pendingMessageDestination(task, 'stage')).toBe('queue')
  expect(pendingMessageDestination(task, 'queue')).toBe('thread')
  const pending = savedPendingMessages(task, [
    {
      id: 'mutation',
      path: '/api/tasks/message',
      method: 'POST',
      input: { id: 't', messageId: 'staged', text: 'Plan this first', queueOnly: true, plan: true },
    },
  ])
  expect(pending).toMatchObject([{ destination: 'queue', message: { id: 'staged', plan: true } }])
  expect(pendingMessageQueue(task, pending).map((message) => message.id)).toEqual(['staged'])
})
