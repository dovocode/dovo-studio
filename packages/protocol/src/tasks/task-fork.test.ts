import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { conversationPresentation } from '../conversation/timeline.js'
import type { Task } from '../workspace.js'
import { forkMessageSchema, messageForkBlocker, threadForkBlocker } from './task-fork.js'

it('accepts one source message and a client-chosen fork ID', () => {
  const input = {
    id: 'thread',
    messageId: 'message',
    forkId: '7b0f3c9e-2d4a-4f6b-9c1d-3e5f7a9b1c2d',
  }
  expect(decode(forkMessageSchema, input)).toEqual(input)
  expect(() => decode(forkMessageSchema, { ...input, forkId: 'not-a-uuid' })).toThrow(/forkId/)
  expect(() => decode(forkMessageSchema, { ...input, messageId: '' })).toThrow(/messageId/)
})

it('explains each thread kind that stays with its execution', () => {
  expect(threadForkBlocker({})).toBeUndefined()
  expect(threadForkBlocker({ delegation: { parentTaskId: 'p', parentRunId: 'r', key: 'k' } })).toBe(
    'Delegated child threads stay with their parent thread. Fork the parent thread instead.',
  )
  expect(
    threadForkBlocker({
      replica: { ownerRuntimeId: 'o', threadId: 't', ownerName: 'Studio Mac', projectName: 'P' },
    }),
  ).toContain('Studio Mac')
  expect(
    threadForkBlocker({ machineHandoff: { id: 'h', targetRuntimeId: 'o', state: 'staged' } }),
  ).toContain('computer transfer')
})

it('allows settled messages, including earlier history while a later turn runs', () => {
  const startedAt = new Date().toISOString()
  const turn = (id: string, assistantId: string, status: 'completed' | 'running') => ({
    id,
    assistantId,
    agentId: '',
    provider: 'codex' as const,
    model: '',
    status,
    startedAt,
  })
  const task: Pick<Task, 'messages' | 'turns'> = {
    messages: [
      { id: 'u1', role: 'user', text: 'First', turnId: 't1' },
      { id: 'a1', role: 'assistant', text: 'Done', turnId: 't1' },
      { id: 'u2', role: 'user', text: 'Second', turnId: 't2' },
      { id: 'a2', role: 'assistant', text: '', turnId: 't2' },
      { id: 'u3', role: 'user', text: 'Not started' },
    ],
    turns: [turn('t1', 'a1', 'completed'), turn('t2', 'a2', 'running')],
  }
  const presentation = conversationPresentation(task)
  const blocker = (id: string, running: boolean) =>
    messageForkBlocker(
      task.messages.find((message) => message.id === id)!,
      presentation.get(id)!.status,
      running,
    )
  expect(blocker('u1', true)).toBeUndefined()
  expect(blocker('a1', true)).toBeUndefined()
  expect(blocker('u2', true)).toContain('Wait for this turn')
  expect(blocker('a2', true)).toContain('Wait for this turn')
  expect(blocker('u3', true)).toContain('Wait for this turn')
  // An unanswered request is settled once nothing runs, as in a fork made from a request.
  expect(blocker('u3', false)).toBeUndefined()
  expect(messageForkBlocker({ role: 'user', file: 'src/a.ts' }, 'completed', false)).toContain(
    'review comment',
  )
})
