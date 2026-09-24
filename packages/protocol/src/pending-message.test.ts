import { expect, it } from 'vitest'
import { decode } from './schema'
import { taskSchema } from './workspace'
import { visiblePendingMessage, type PendingMessage } from './pending-message'

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
