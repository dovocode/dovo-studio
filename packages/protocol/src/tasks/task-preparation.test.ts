import { expect, it } from 'vite-plus/test'
import { preparationElapsed, taskPreparation } from './task-preparation.js'
import type { Task } from '../workspace.js'

const task = (changes: Partial<Task>): Task => ({
  id: 'task',
  title: 'Task',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'running',
  runPhase: 'preparing',
  createdAt: '2026-09-27T10:00:00.000Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
  ...changes,
})

it('marks finished, active and pending checkout steps with their details', () => {
  const result = taskPreparation(
    task({
      setupCommand: 'pnpm install\npnpm build',
      preparation: {
        steps: ['fetch', 'worktree', 'setup', 'agent'],
        current: 'setup',
        branch: 'dovo/fix-login-1a2b3c4d',
        startedAt: '2026-09-27T10:00:00.000Z',
      },
    }),
  )
  expect(result?.steps).toEqual([
    { id: 'fetch', label: 'Fetch latest from origin', detail: undefined, state: 'done' },
    { id: 'worktree', label: 'Create worktree', detail: 'dovo/fix-login-1a2b3c4d', state: 'done' },
    { id: 'setup', label: 'Run setup command', detail: 'pnpm install', state: 'active' },
    { id: 'agent', label: 'Start the agent', detail: undefined, state: 'pending' },
  ])
  expect(result?.progress).toBe(2.5 / 4)
})

it('shows nothing outside the preparing phase and labels steps from newer runtimes', () => {
  const preparation = {
    steps: ['warm_cache', 'agent'],
    current: 'warm_cache',
    startedAt: '2026-09-27T10:00:00.000Z',
  }
  expect(taskPreparation(task({ preparation, runPhase: 'provider' }))).toBeUndefined()
  expect(taskPreparation(task({ preparation, status: 'failed' }))).toBeUndefined()
  expect(taskPreparation(task({}))).toBeUndefined()
  expect(taskPreparation(task({ preparation }))?.steps[0].label).toBe('Warm cache')
})

it('formats step time without showing negative time from clock skew', () => {
  const started = '2026-09-27T10:00:00.000Z'
  const at = (seconds: number) => Date.parse(started) + seconds * 1000
  expect(preparationElapsed(started, at(-30))).toBe('')
  expect(preparationElapsed(started, at(2))).toBe('')
  expect(preparationElapsed(started, at(12))).toBe('12s')
  expect(preparationElapsed(started, at(125))).toBe('2m 05s')
  expect(preparationElapsed('not a date', at(20))).toBe('')
})

it('keeps showing the step a failed run stopped on, with its error', () => {
  const preparation = {
    steps: ['worktree', 'setup', 'agent'],
    current: 'setup',
    startedAt: '2026-09-27T10:00:00.000Z',
    failed: true,
  }
  const result = taskPreparation(
    task({ status: 'failed', runPhase: undefined, error: 'Worktree setup failed.', preparation }),
  )
  expect(result?.failed).toBe(true)
  expect(result?.error).toBe('Worktree setup failed.')
  expect(result?.steps.map((step) => step.state)).toEqual(['done', 'failed', 'pending'])
  // A new run replaces it; a task in review never shows a stale failure.
  expect(taskPreparation(task({ status: 'review', runPhase: undefined, preparation }))).toBe(
    undefined,
  )
})
