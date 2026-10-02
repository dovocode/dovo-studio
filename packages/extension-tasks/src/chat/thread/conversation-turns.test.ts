import { expect, it } from 'vite-plus/test'
import type { TaskTurn } from '@dovo/studio-core'
import { conversationTurns } from './conversation-turns'

const turn = (assistantId: string, status: TaskTurn['status']): TaskTurn => ({
  id: assistantId,
  assistantId,
  status,
  agentId: '',
  provider: 'codex',
  model: 'test',
  startedAt: '',
})

it('uses one marker per user input, including resumed work through completion', () => {
  const messages = [
    { id: 'u1', role: 'user' as const, text: 'Fix it' },
    { id: 'a1', role: 'assistant' as const, text: 'Investigating' },
    { id: 'a2', role: 'assistant' as const, text: 'Continuing' },
    { id: 'u2', role: 'user' as const, text: 'Another request' },
  ]
  const running = conversationTurns({
    messages,
    turns: [turn('a1', 'completed'), turn('a2', 'running')],
  })
  expect(running.map((group) => [group.id, group.status, group.messages.length])).toEqual([
    ['u1', 'running', 3],
    ['u2', 'waiting', 1],
  ])
  expect(conversationTurns({ messages, turns: [turn('a2', 'completed')] })[0]?.status).toBe(
    'completed',
  )
  expect(conversationTurns({ messages, turns: [turn('a2', 'failed')] })[0]?.status).toBe('failed')
  expect(conversationTurns({ messages, turns: [turn('a2', 'cancelled')] })[0]?.status).toBe(
    'cancelled',
  )
})

it('keeps queued user requests separate and supports legacy assistant-only history', () => {
  expect(conversationTurns({ messages: [] })).toEqual([])
  const groups = conversationTurns({
    messages: [
      { id: 'a', role: 'assistant', text: 'Imported response' },
      { id: 'u1', role: 'user', text: '' },
      { id: 'u2', role: 'user', text: 'Queued follow-up' },
    ],
  })
  expect(groups.map((group) => [group.id, group.status])).toEqual([
    ['a', 'completed'],
    ['u1', 'waiting'],
    ['u2', 'waiting'],
  ])
})

it('keeps fallback steering attempts in one user-visible run', () => {
  const task = {
    messages: [
      { id: 'u1', role: 'user' as const, text: 'Original' },
      { id: 'a1', role: 'assistant' as const, text: 'First attempt' },
      { id: 'u2', role: 'user' as const, text: 'Steer' },
      { id: 'a2', role: 'assistant' as const, text: 'Replacement' },
    ],
    turns: [
      {
        id: 'attempt1',
        runId: 'run',
        assistantId: 'a1',
        status: 'cancelled' as const,
        startedAt: '',
        agentId: 'agent',
        provider: 'codex' as const,
        model: '',
      },
      {
        id: 'attempt2',
        runId: 'run',
        assistantId: 'a2',
        status: 'completed' as const,
        startedAt: '',
        agentId: 'agent',
        provider: 'codex' as const,
        model: '',
      },
    ],
  }
  const groups = conversationTurns(task)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.messages).toHaveLength(4)
  expect(groups[0]?.status).toBe('completed')
})
