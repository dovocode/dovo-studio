import { expect, it } from 'vitest'
import {
  canChangeTaskProvider,
  defaultTaskHarness,
  lockedTaskProvider,
  type Task,
  type Agent,
} from './workspace.js'
const task: Task = {
  id: 'task',
  title: 'Task',
  agentId: '',
  repositoryId: 'repo',
  status: 'draft',
  createdAt: '',
  messages: [],
  files: [],
  draft: '',
  example: false,
  harness: defaultTaskHarness('codex'),
}
it('allows provider choice until user input is submitted, while unsent drafts remain free', () => {
  expect(canChangeTaskProvider({ ...task, draft: 'Not sent yet' })).toBe(true)
  expect(lockedTaskProvider(task, [])).toBeUndefined()
  const sent = { ...task, messages: [{ id: 'input', role: 'user' as const, text: 'First task' }] }
  expect(canChangeTaskProvider(sent)).toBe(false)
  expect(lockedTaskProvider(sent, [])).toBe('codex')
  const queued = {
    ...task,
    queue: [{ id: 'input', role: 'user' as const, text: 'First task', createdAt: '' }],
  }
  expect(canChangeTaskProvider(queued)).toBe(false)
  expect(lockedTaskProvider(queued, [])).toBe('codex')
  expect(canChangeTaskProvider({ ...task, providerLock: 'codex' })).toBe(false)
  expect(lockedTaskProvider({ ...task, checkoutLocked: true }, [])).toBe('codex')
})
it('uses the first historical turn rather than a custom agent provider changed afterward', () => {
  const agents: Agent[] = [{ ...defaultTaskHarness('claude'), id: 'custom', name: 'Custom' }]
  const old = {
    ...task,
    harness: undefined,
    agentId: 'custom',
    turns: [
      {
        id: 'turn',
        assistantId: 'assistant',
        agentId: 'custom',
        provider: 'codex' as const,
        model: '',
        startedAt: '',
        status: 'completed' as const,
      },
    ],
  }
  expect(lockedTaskProvider(old, agents)).toBe('codex')
  expect(canChangeTaskProvider(old)).toBe(false)
})
