import { expect, it } from 'vite-plus/test'
import { createTask } from './actions'

it('retains independent editable and reference linked checkouts in a task draft', () => {
  const linkedCheckouts = [
    {
      id: 'reference',
      repositoryId: 'docs',
      execution: 'main' as const,
      access: 'read-only' as const,
    },
    {
      id: 'editable',
      repositoryId: 'api',
      execution: 'worktree' as const,
      access: 'edit' as const,
      baseBranch: 'main',
      branch: 'feature',
    },
  ]
  const task = createTask({
    title: 'Draft',
    objective: 'Change API',
    repositoryId: 'web',
    agentId: 'agent',
    linkedCheckouts,
  })
  expect(task.linkedCheckouts).toEqual(linkedCheckouts)
  linkedCheckouts[1].branch = 'changed-later'
  expect(task.linkedCheckouts?.[1].branch).toBe('feature')
})
