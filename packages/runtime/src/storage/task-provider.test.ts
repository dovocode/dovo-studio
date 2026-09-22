import { afterEach, expect, it } from 'vitest'
import { defaultTaskHarness, type Agent, type Task } from '@dovo/protocol'
import { TaskQueue } from '../agents/task-queue.js'
import { openDatabase } from './database.js'
import { WorkspaceStore } from './workspace.js'
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
})
const draft: Task = {
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
const agents: Agent[] = [
  { ...defaultTaskHarness('codex'), id: 'custom-codex', name: 'Codex custom' },
  { ...defaultTaskHarness('claude'), id: 'custom-claude', name: 'Claude custom' },
]
function setup(task: Task = draft) {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  const store = new WorkspaceStore(db)
  store.update((workspace) => ({ ...workspace, agents, tasks: [task] }))
  return { store, db }
}
function harness(store: WorkspaceStore, provider: Agent['provider'], model = '') {
  store.patch({
    collection: 'tasks',
    id: 'task',
    changes: {
      harness: {
        before: store.task('task').harness ?? null,
        after: { ...defaultTaskHarness(provider), model },
      },
    },
  })
}
it('allows draft providers, locks the first submitted provider and permits its models and settings', () => {
  const { store, db } = setup()
  harness(store, 'claude')
  expect(store.task('task').providerLock).toBeUndefined()
  store.patch({
    collection: 'tasks',
    id: 'task',
    changes: { messages: { before: [], after: [{ id: 'first', role: 'user', text: 'Go' }] } },
  })
  expect(store.task('task').providerLock).toBe('claude')
  expect(() => harness(store, 'codex')).toThrow('same provider')
  harness(store, 'claude', 'sonnet')
  store.patch({
    collection: 'tasks',
    id: 'task',
    changes: {
      agentOverrides: { before: null, after: { reasoning: 'high', permission: 'full-access' } },
    },
  })
  expect(store.task('task').harness?.model).toBe('sonnet')
  expect(new WorkspaceStore(db).task('task').providerLock).toBe('claude')
  expect(() =>
    store.patch({
      collection: 'tasks',
      id: 'task',
      changes: { providerLock: { before: 'claude', after: 'codex' } },
    }),
  ).toThrow('Cannot edit providerLock')
})
it('retains the provider lock when the first queued message is removed before execution', () => {
  const { store } = setup()
  const queue = new TaskQueue(store)
  queue.add('task', 'first', 'Start')
  expect(store.task('task').providerLock).toBe('codex')
  queue.change('task', 'remove', 'first')
  expect(store.task('task').messages).toEqual([])
  expect(store.task('task').queue).toEqual([])
  expect(() => harness(store, 'claude')).toThrow('same provider')
  harness(store, 'codex', 'another-model')
})
it('validates combined custom-agent/harness changes atomically and allows same-provider custom agents', () => {
  const { store } = setup({ ...draft, messages: [{ id: 'first', role: 'user', text: 'Go' }] })
  const select = (agentId: string) =>
    store.patch({
      collection: 'tasks',
      id: 'task',
      changes: {
        harness: { before: store.task('task').harness ?? null, after: null },
        agentId: { before: store.task('task').agentId, after: agentId },
      },
    })
  expect(() => select('custom-claude')).toThrow('same provider')
  expect(store.task('task').agentId).toBe('')
  select('custom-codex')
  expect(store.task('task').agentId).toBe('custom-codex')
  harness(store, 'codex', 'updated')
  expect(store.task('task').providerLock).toBe('codex')
})
it('prevents global custom-agent edits from changing the provider of existing conversations', () => {
  const { store } = setup({
    ...draft,
    harness: undefined,
    agentId: 'custom-codex',
    messages: [{ id: 'first', role: 'user', text: 'Go' }],
  })
  expect(() =>
    store.patch({
      collection: 'agents',
      id: 'custom-codex',
      changes: { provider: { before: 'codex', after: 'claude' } },
    }),
  ).toThrow('same provider')
  expect(store.get().agents[0]?.provider).toBe('codex')
  store.patch({
    collection: 'agents',
    id: 'custom-codex',
    changes: { model: { before: '', after: 'new-model' } },
  })
  expect(store.get().agents[0]?.model).toBe('new-model')
})
it('backfills old task locks from their first turn and keeps legacy mismatches loadable for correction', () => {
  const old: Task = {
    ...draft,
    harness: defaultTaskHarness('claude'),
    turns: [
      {
        id: 'turn',
        assistantId: 'assistant',
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'completed',
        startedAt: '',
      },
    ],
  }
  const { store, db } = setup(old)
  expect(store.task('task').providerLock).toBe('codex')
  expect(new WorkspaceStore(db).task('task').providerLock).toBe('codex')
  expect(() => harness(store, 'claude', 'other-model')).toThrow('same provider')
  harness(store, 'codex')
  expect(store.task('task').harness?.provider).toBe('codex')
})
it('retains active-turn settings restrictions even within the locked provider', () => {
  const { store } = setup({
    ...draft,
    status: 'running',
    messages: [{ id: 'first', role: 'user', text: 'Go' }],
  })
  expect(() => harness(store, 'codex', 'new-model')).toThrow('Stop the active turn')
})
