import { expect, it } from 'vite-plus/test'
import { taskSchema } from '@dovo/protocol'
import { viewedTaskTurn } from './task-view-eligibility'

const task = taskSchema.parse({
  id: 'task',
  repositoryId: 'repo',
  agentId: 'agent',
  title: 'Task',
  status: 'review',
  createdAt: '2026-09-23T10:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  turns: [
    {
      id: 'turn',
      assistantId: 'reply',
      status: 'completed',
      startedAt: '2026-09-23T10:00:00Z',
      finishedAt: '2026-09-23T10:01:00Z',
      provider: 'codex',
      model: 'model',
      agentId: 'agent',
    },
  ],
})
const visible = {
  focused: true,
  chatVisible: true,
  appActive: true,
  connected: true,
  ownerMatches: true,
}

it('acknowledges the exact completed turn only while its own chat is being viewed', () => {
  expect(viewedTaskTurn(task, visible)).toBe('turn')
  for (const property of Object.keys(visible) as Array<keyof typeof visible>) {
    expect(viewedTaskTurn(task, { ...visible, [property]: false })).toBeUndefined()
  }
})
it('acknowledges a completion arriving while viewing, but never an active turn', () => {
  expect(
    viewedTaskTurn(
      { ...task, status: 'running', turns: [{ ...task.turns![0], status: 'running' }] },
      visible,
    ),
  ).toBeUndefined()
  expect(viewedTaskTurn(task, visible)).toBe('turn')
})
it('does not acknowledge already viewed, settled or sample chats', () => {
  expect(viewedTaskTurn({ ...task, lastViewedTurnId: 'turn' }, visible)).toBeUndefined()
  expect(viewedTaskTurn({ ...task, archived: true }, visible)).toBeUndefined()
  expect(viewedTaskTurn({ ...task, example: true }, visible)).toBeUndefined()
})
it('does not consume a newer completion by reusing the previous turn identity', () => {
  const next = {
    ...task,
    lastViewedTurnId: 'turn',
    turns: [...task.turns!, { ...task.turns![0], id: 'next' }],
  }
  expect(viewedTaskTurn(next, visible)).toBe('next')
  expect(viewedTaskTurn(next, { ...visible, ownerMatches: false })).toBeUndefined()
})
