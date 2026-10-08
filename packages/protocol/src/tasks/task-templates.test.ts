import { expect, it } from 'vite-plus/test'
import { templateFromTask, templateTaskFields } from './task-templates.js'
import type { Task } from '../workspace.js'

it('turns a task into a template and a template into draft fields', () => {
  const harness = {
    provider: 'codex' as const,
    model: 'gpt',
    reasoning: '',
    instructions: '',
    permission: 'ask' as const,
    endpoint: '',
  }
  const task = {
    id: 't',
    title: 'Fix',
    repositoryId: 'r',
    agentId: '',
    harness,
    execution: 'worktree',
    worktreeFromOrigin: true,
    setupCommand: 'pnpm install',
    status: 'review',
    createdAt: '',
    messages: [
      { id: 'c', role: 'user', text: 'comment', file: 'a.ts' },
      { id: 'm', role: 'user', text: ' Fix the flaky test ' },
    ],
    files: [],
    draft: '',
    example: false,
  } as Task
  const template = templateFromTask(task, ' Flaky test ', 'tpl')
  expect(template).toEqual({
    id: 'tpl',
    name: 'Flaky test',
    objective: 'Fix the flaky test',
    harness,
    execution: 'worktree',
    worktreeFromOrigin: true,
    setupCommand: 'pnpm install',
  })
  expect(templateTaskFields(template)).toEqual({
    draft: 'Fix the flaky test',
    harness,
    agentId: '',
    execution: 'worktree',
    worktreeFromOrigin: true,
    setupCommand: 'pnpm install',
  })
  const localTemplate = templateFromTask({ ...task, worktreeFromOrigin: false }, 'Local', 'local')
  expect(localTemplate.worktreeFromOrigin).toBe(false)
  expect(templateTaskFields(localTemplate).worktreeFromOrigin).toBe(false)
  const inheritedTemplate = templateFromTask(
    { ...task, worktreeFromOrigin: undefined },
    'Inherited',
    'inherited',
  )
  expect(inheritedTemplate).not.toHaveProperty('worktreeFromOrigin')
})
