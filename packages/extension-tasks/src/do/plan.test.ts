import { expect, it } from 'vite-plus/test'
import { decodeResult, doSaveRequestSchema, type DoRun, type DoSaveRequest } from '@dovo/protocol'
import { editablePlan, planErrors } from './plan'

const plan: DoSaveRequest = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Ship the scoped change',
  goal: 'Implement and verify the requested change.',
  maxConcurrency: 2,
  items: [
    {
      id: 'implement',
      title: 'Implement',
      instructions: 'Make the change and run relevant checks.',
      dependsOn: [],
      target: { runtimeId: 'local', repositoryId: 'project', execution: 'worktree' },
    },
  ],
}

it('turns a stored run into a revision-bound save without sending authoritative execution state', () => {
  const run: DoRun = {
    ...plan,
    revision: '00000000-0000-4000-8000-000000000002',
    maxConcurrency: 2,
    status: 'draft',
    createdAt: '2026-10-17T00:00:00Z',
    updatedAt: '2026-10-17T00:00:00Z',
    items: plan.items.map((item) => ({
      ...item,
      state: { status: 'pending', attempt: 0, updatedAt: '2026-10-17T00:00:00Z' },
    })),
  }
  const editable = editablePlan(run)
  expect(editable.expectedRevision).toBe(run.revision)
  expect(editable.items[0]).not.toHaveProperty('state')
  expect(decodeResult(doSaveRequestSchema, editable).success).toBe(true)
})

it('reports missing assignment and instructions before a save can be sent', () => {
  expect(
    planErrors({
      ...plan,
      items: [
        { ...plan.items[0], instructions: ' ', target: { runtimeId: 'local', repositoryId: '' } },
      ],
    }),
  ).toEqual(['Work item 1: add instructions.', 'Work item 1: select a project.'])
})

it('rejects dependency cycles and out-of-bounds concurrency in the editor', () => {
  expect(
    planErrors({
      ...plan,
      items: [
        { ...plan.items[0], dependsOn: ['verify'] },
        { ...plan.items[0], id: 'verify', dependsOn: ['implement'] },
      ],
    }),
  ).toContain('Dependencies cannot form a cycle')
  expect(planErrors({ ...plan, maxConcurrency: 9 })).toHaveLength(1)
  expect(planErrors(plan)).toEqual([])
})
