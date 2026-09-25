import { expect, it } from 'vitest'
import { taskBranchName } from './task-branch'

it('uses the AI task title with a unique suffix and strips Git ref metacharacters', () => {
  expect(taskBranchName('Fix café checkout: API / reconnect?', 'a123')).toBe(
    'dovo/fix-cafe-checkout-api-reconnect-a123',
  )
  expect(taskBranchName('../@{bad} ~^:*? [title] .lock', 'a123')).toBe('dovo/bad-title-lock-a123')
  expect(taskBranchName('🚀', 'a123')).toBe('dovo/task-a123')
  expect(taskBranchName('a'.repeat(200), 'a123')).toBe(`dovo/${'a'.repeat(60)}-a123`)
  expect(taskBranchName('Same title', 'a123')).not.toBe(taskBranchName('Same title', 'b123'))
})

it('names worktrees <org or user>/<repo>-<branch> and stays safe as a path', async () => {
  const { taskWorktreePath } = await import('./task-branch')
  expect(
    taskWorktreePath('github.com/dovocode/dovo-studio', '/code/dovo', 'dovo/fix-login-a123'),
  ).toBe('dovocode/dovo-studio-fix-login-a123')
  expect(taskWorktreePath('dev.azure.com/contoso/platform/api', '/x', 'dovo/task-a1')).toBe(
    'contoso/api-task-a1',
  )
  expect(taskWorktreePath(undefined, '/Users/me/Code/side project', 'dovo/task-a1')).toBe(
    'local/side-project-task-a1',
  )
  expect(taskWorktreePath('github.com/../..', '/x', 'feature/../../etc')).not.toContain('..')
})
