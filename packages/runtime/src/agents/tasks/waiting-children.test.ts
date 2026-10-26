import { afterEach, expect, it } from 'vite-plus/test'
import {
  decode,
  defaultTaskHarness,
  taskSchema,
  taskIsWorking,
  type Task,
  type Subagent,
} from '@dovo/protocol'
import { createServices } from '../../services.js'
import { openDatabase } from '../../storage/database.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function task(id: string, parent?: string): Task {
  return decode(taskSchema, {
    id,
    title: id,
    repositoryId: '',
    agentId: '',
    status: 'review',
    createdAt: '',
    example: false,
    draft: '',
    messages: [],
    files: [],
    queuePaused: true,
    ...(parent ? { delegation: { parentTaskId: parent, parentRunId: 'turn', key: id } } : {}),
  })
}
function setup(tasks: Task[]) {
  const db = openDatabase(':memory:')
  const s = createServices(db, 'waiting-children-owner-token-at-least-32-characters')
  cleanups.push(async () => {
    await s.tasks.dispose()
    db.close()
  })
  s.store.update((workspace) => ({ ...workspace, tasks }))
  return s
}
const native: Subagent = {
  id: 'native',
  name: 'Worker',
  provider: 'codex',
  status: 'working',
  sessionLive: true,
  startedAt: '',
  updatedAt: '',
}

it('keeps finished ancestors working until every delegated descendant finishes', () => {
  const s = setup([
    task('parent'),
    task('child', 'parent'),
    { ...task('nested', 'child'), status: 'running' },
    { ...task('unrelated'), status: 'running' },
  ])
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(true)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  expect(taskIsWorking(s.store.taskSummary('child'))).toBe(true)
  expect(s.store.taskSummary('child').waitingForFeedback).toBeUndefined()
  expect(s.store.taskSummary('nested').waitingForFeedback).toBeUndefined()
  s.store.updateTask('nested', (task) => ({ ...task, status: 'review' }))
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(false)
  expect(taskIsWorking(s.store.taskSummary('child'))).toBe(false)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  expect(s.store.taskSummary('child').waitingForFeedback).toBeUndefined()
})

it('keeps working for live native agents and pending child results, including read-only parents', () => {
  const s = setup([
    {
      ...task('parent'),
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
      subagents: [native],
    },
  ])
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(true)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  s.store.updateTask('parent', (task) => ({
    ...task,
    subagents: [{ ...native, status: 'completed', finishedAt: 'now', completion: 'pending' }],
  }))
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(true)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  s.store.updateTask('parent', (task) => ({
    ...task,
    subagents: [{ ...native, status: 'completed', finishedAt: 'now', completion: 'read' }],
  }))
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
})

it.each(['running', 'failed', 'cancelled', 'draft'] as const)(
  'keeps a %s parent out of Waiting while its child works',
  (status) => {
    const s = setup([
      { ...task('parent'), status },
      { ...task('child', 'parent'), status: 'running' },
    ])
    expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  },
)

it('does not wait for stale native sessions or completed and stopped child branches', () => {
  const s = setup([
    { ...task('parent'), subagents: [{ ...native, sessionLive: false }] },
    task('child', 'parent'),
    { ...task('stopped', 'parent'), status: 'cancelled' },
  ])
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
})

it('keeps a finished turn out of Waiting until its own run releases ownership', () => {
  const s = setup([{ ...task('parent'), activeRunId: 'finishing' }])
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  s.store.updateTask('parent', (task) => ({ ...task, activeRunId: undefined }))
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
})

it('keeps working for a finished child that is still releasing its run', () => {
  const s = setup([task('parent'), { ...task('child', 'parent'), activeRunId: 'finishing' }])
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(true)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  expect(s.store.taskSummary('child').waitingForFeedback).toBeUndefined()
  s.store.updateTask('child', (task) => ({ ...task, activeRunId: undefined }))
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
})

it('keeps ancestors working while a child has unread inbox results', () => {
  const s = setup([
    task('parent'),
    {
      ...task('child', 'parent'),
      subagentInbox: [
        { id: 'result', role: 'user', text: 'Answer', subagentResultId: 'nested', createdAt: '' },
      ],
    },
  ])
  expect(taskIsWorking(s.store.taskSummary('parent'))).toBe(true)
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
  s.store.updateTask('child', (task) => ({ ...task, subagentInbox: [] }))
  expect(s.store.taskSummary('parent').waitingForFeedback).toBeUndefined()
})
