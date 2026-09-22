import { describe, expect, it } from 'vite-plus/test'
import type { JobRun } from '@dovo/protocol'
import { automationRuns, automationRunSummary } from './automation-summary'

const run = (patch: Partial<JobRun> = {}): JobRun => ({
  id: 'run',
  automationId: 'automation',
  status: 'running',
  completedNodes: ['trigger'],
  taskIds: ['task'],
  createdAt: '2026-09-20T08:00:00Z',
  currentNodeId: 'work',
  steps: [
    { nodeId: 'trigger', label: 'Start', kind: 'trigger', status: 'completed', attempt: 1 },
    {
      nodeId: 'work',
      label: 'Check repository',
      kind: 'task',
      status: 'running',
      attempt: 1,
      taskId: 'task',
    },
    { nodeId: 'review', label: 'Review', kind: 'review', status: 'pending', attempt: 0 },
  ],
  ...patch,
})

describe('automation list and detail summaries', () => {
  it('keeps an active run visible ahead of newer history and isolates automations', () => {
    const active = run()
    const finished = run({ id: 'finished', status: 'completed', updatedAt: '2026-09-20T09:00:00Z' })
    const other = run({ id: 'other', automationId: 'other' })
    const source = [active, finished, other]
    const result = automationRuns('automation', source)
    expect(result.latest).toBe(active)
    expect(result.history).toEqual([finished, active])
    expect(source).toEqual([active, finished, other])
  })
  it('distinguishes agent input from an automation review gate', () => {
    expect(automationRunSummary(run(), new Set(['task']))).toMatchObject({
      status: 'Needs input',
      needsInput: true,
      progress: '0 of 2 steps',
    })
    expect(
      automationRunSummary(
        run({ status: 'waiting', currentNodeId: undefined, waitingNodeId: 'review' }),
        new Set(['task']),
      ),
    ).toMatchObject({
      status: 'Needs review',
      needsInput: false,
      current: { nodeId: 'review' },
    })
  })
  it('shows failed-step context and excludes the trigger from progress', () => {
    const failed = run({
      status: 'failed',
      currentNodeId: undefined,
      failedNodeId: 'work',
      interrupted: true,
    })
    expect(automationRunSummary(failed, new Set())).toMatchObject({
      status: 'Interrupted',
      active: false,
      current: { label: 'Check repository' },
      progress: '0 of 2 steps',
    })
  })
  it('supports previous runs without per-step snapshots', () => {
    expect(
      automationRunSummary(
        run({ steps: undefined, status: 'completed', completedNodes: ['a', 'b'] }),
        new Set(),
      ),
    ).toMatchObject({
      status: 'Completed',
      progress: '2 steps completed',
      active: false,
    })
  })
})
