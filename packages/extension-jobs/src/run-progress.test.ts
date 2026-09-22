import { describe, expect, it } from 'vite-plus/test'
import type { JobRun } from '@dovo/studio-core'
import { createWorkspace } from '../../studio-core/src/workspace/seed'
import { elapsed, runSteps } from './run-progress'

const flow = createWorkspace().automations[0]
const run: JobRun = {
  id: 'history',
  automationId: flow.id,
  status: 'failed',
  createdAt: '2026-09-19T10:00:00Z',
  completedNodes: ['trigger'],
  taskIds: ['retained-task'],
  steps: [
    {
      nodeId: 'old-step',
      label: 'Original instructions',
      kind: 'task',
      status: 'failed',
      taskId: 'retained-task',
      attempt: 2,
    },
  ],
}
describe('automation run presentation', () => {
  it('keeps historical steps, labels and task links when the author changes the graph', () => {
    expect(runSteps(run, { ...flow, nodes: [] })).toEqual(run.steps)
    expect(runSteps(run, flow)[0].taskId).toBe('retained-task')
  })
  it('uses only known legacy completion and waiting information without inventing task associations', () => {
    const steps = runSteps(
      { ...run, steps: undefined, waitingNodeId: 'review', status: 'waiting' },
      flow,
    )
    expect(steps.find((step) => step.nodeId === 'trigger')?.status).toBe('completed')
    expect(steps.find((step) => step.nodeId === 'review')?.status).toBe('waiting')
    expect(steps.every((step) => !step.taskId)).toBe(true)
  })
  it('freezes finished durations and handles invalid or skewed clocks', () => {
    expect(
      elapsed('2026-09-19T10:00:00Z', '2026-09-19T10:01:15Z', Date.parse('2026-09-20T10:00:00Z')),
    ).toBe('1m 15s')
    expect(elapsed('2026-09-19T10:00:00Z', undefined, Date.parse('2026-09-19T10:00:03Z'))).toBe(
      '3s',
    )
    expect(elapsed('invalid', undefined, Date.now())).toBeNull()
    expect(elapsed('2026-09-20T10:00:00Z', undefined, Date.parse('2026-09-19T10:00:00Z'))).toBe(
      '0s',
    )
  })
})
