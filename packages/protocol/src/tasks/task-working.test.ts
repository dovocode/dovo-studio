import { expect, it } from 'vite-plus/test'
import { decode, taskSchema, type Task, type Subagent, type ThreadWatchSummary } from '../index.js'
import { taskIsWorking } from './task-working.js'
import { hasUnreadTaskActivity, hasUnviewedTaskCompletion } from '../workspace.js'

const parent = decode(taskSchema, {
  id: 'parent',
  title: 'Parent',
  repositoryId: '',
  agentId: '',
  status: 'review',
  createdAt: '',
  messages: [],
  files: [],
  draft: '',
  example: false,
  turns: [
    {
      id: 'turn',
      assistantId: 'reply',
      agentId: '',
      provider: 'codex',
      model: '',
      status: 'completed',
      startedAt: '',
    },
  ],
})
const child: Subagent = {
  id: 'child',
  name: 'Child',
  provider: 'codex',
  status: 'working',
  sessionLive: true,
  startedAt: '',
  updatedAt: '',
}

it.each([undefined, 'dovo'] as const)(
  'keeps a parent active across completion of its own turn (%s)',
  (source) => {
    const task: Task = { ...parent, subagents: [{ ...child, source }] }
    expect(taskIsWorking(task)).toBe(true)
    expect(hasUnreadTaskActivity(task)).toBe(true)
    expect(hasUnviewedTaskCompletion(task)).toBe(false)
    task.subagents = [{ ...child, source, status: 'completed', finishedAt: '2026-10-26T00:00:00Z' }]
    expect(taskIsWorking(task)).toBe(false)
    expect(hasUnviewedTaskCompletion(task)).toBe(true)
  },
)

it('does not treat stale native metadata or ordinary drafts as active work', () => {
  expect(taskIsWorking({ ...parent, status: 'draft' })).toBe(false)
  expect(taskIsWorking({ ...parent, subagents: [{ ...child, sessionLive: false }] })).toBe(false)
  expect(taskIsWorking({ ...parent, subagents: [{ ...child, status: 'stopped' }] })).toBe(false)
  expect(taskIsWorking({ ...parent, subagents: [{ ...child, status: 'unknown' }] })).toBe(true)
})

it('keeps remote delegated children active, including unknown/offline state, until they finish or pause', () => {
  const watch: ThreadWatchSummary = {
    runtimeId: 'mac',
    threadId: 'child',
    computerName: 'Mac',
    relation: 'spawned',
    status: 'watching',
    offline: true,
    delegated: true,
  }
  expect(taskIsWorking({ ...parent, threadWatches: [watch] })).toBe(true)
  expect(taskIsWorking({ ...parent, threadWatches: [{ ...watch, paused: true }] })).toBe(false)
  expect(taskIsWorking({ ...parent, threadWatches: [{ ...watch, status: 'completed' }] })).toBe(
    false,
  )
  expect(taskIsWorking({ ...parent, threadWatches: [{ ...watch, delegated: false }] })).toBe(false)
})
