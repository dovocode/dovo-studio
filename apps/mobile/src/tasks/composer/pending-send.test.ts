import { expect, it } from 'vite-plus/test'
import { decode, taskSchema } from '@dovo/protocol'
import {
  pendingQueue,
  sendDestination,
  sendingDraft,
  visibleMobileSend,
  type MobilePendingSend,
} from './pending-send'
const task = decode(taskSchema, {
  id: 'thread',
  title: 'Thread',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'running',
  createdAt: '',
  messages: [],
  files: [],
  draft: 'Next message',
  example: false,
})
const pending: MobilePendingSend = {
  taskId: task.id,
  destination: 'queue',
  state: 'sending',
  message: { id: 'send', role: 'user', text: 'Next message', createdAt: '' },
}
it('previews an active-thread follow-up directly in the queue without duplicating server acceptance', () => {
  expect(sendDestination(task, 'queue')).toBe('queue')
  expect(pendingQueue(task, pending)).toEqual([pending.message])
  const accepted = { ...task, queue: [pending.message] }
  expect(pendingQueue(accepted, pending)).toEqual([pending.message])
  expect(visibleMobileSend(accepted, pending)).toBeNull()
  expect(pendingQueue({ ...task, messages: [pending.message] }, pending)).toEqual([])
})
it('keeps ordinary sends and steering in the thread, and accounts for an existing stopped queue', () => {
  expect(sendDestination({ ...task, status: 'cancelled' }, 'queue')).toBe('thread')
  expect(sendDestination(task, 'steer')).toBe('thread')
  expect(pendingQueue(task, { ...pending, destination: 'thread' })).toEqual([])
  expect(sendDestination({ ...task, status: 'cancelled', queue: [pending.message] }, 'queue')).toBe(
    'queue',
  )
})
it('clears the visible submitted text immediately while retaining it for failure recovery', () => {
  expect(sendingDraft(task.draft, pending)).toBe('')
  expect(task.draft).toBe('Next message')
  expect(sendingDraft(task.draft, { ...pending, state: 'failed' })).toBe('Next message')
  expect(sendingDraft('Another follow-up', pending)).toBe('Another follow-up')
  expect(visibleMobileSend({ ...task, id: 'another-thread' }, pending)).toBeNull()
})
