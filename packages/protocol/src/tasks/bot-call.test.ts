import { expect, it } from 'vite-plus/test'
import { botCallReplies } from './bot-call'
import { decode, taskSchema } from '../index'
it('matches voice requests to their own final turn and excludes routine reports', () => {
  const task = decode(taskSchema, {
    id: 'bot',
    repositoryId: '',
    title: 'Bot',
    agentId: '',
    status: 'review',
    execution: 'main',
    createdAt: '2026-11-13T00:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  task.messages = [
    { id: 'voice', role: 'user', text: 'Check', turnId: 'turn', createdAt: task.createdAt },
    { id: 'answer', role: 'assistant', text: 'Checked', turnId: 'turn', createdAt: task.createdAt },
    {
      id: 'other',
      role: 'assistant',
      text: 'Other result',
      turnId: 'another',
      createdAt: task.createdAt,
    },
  ]
  task.turns = [
    {
      id: 'turn',
      assistantId: 'answer',
      provider: 'codex',
      agentId: '',
      model: 'model',
      startedAt: task.createdAt,
      status: 'completed',
    },
  ]
  expect(botCallReplies(task)).toEqual([
    { id: 'voice', status: 'completed', text: 'Checked', error: undefined },
  ])
  task.turns[0].status = 'failed'
  task.turns[0].error = 'Provider stopped'
  expect(botCallReplies(task)[0]).toMatchObject({ status: 'failed', error: 'Provider stopped' })
})
