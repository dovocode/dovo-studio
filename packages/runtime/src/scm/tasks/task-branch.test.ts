import { expect, it } from 'vite-plus/test'
import { taskBranchName } from './task-branch'
import { taskWorktreePath } from './task-branch'
import { taskWorktreeKeys, isTaskWorktree, withinWorktrees } from './task-worktree-keys'

it('keeps long linked branch suffixes unique and recognizes registered branches after a root change', () => {
  const first = taskWorktreeKeys('/repo/.git', 'task:linked:a', '/old/worktrees')
  const second = taskWorktreeKeys('/repo/.git', 'task:linked:b', '/old/worktrees')
  const branch = `feature/${'a'.repeat(200)}-${first.suffix}`
  const path = taskWorktreePath(undefined, '/repo', branch)
  expect(path).toMatch(new RegExp(`-${first.suffix}$`))
  expect(path).not.toBe(
    taskWorktreePath(undefined, '/repo', `feature/${'a'.repeat(200)}-${second.suffix}`),
  )
  const changed = taskWorktreeKeys('/repo/.git', 'task:linked:a', '/new/worktrees')
  expect(isTaskWorktree(`/old/worktrees/${path}`, changed, branch)).toBe(true)
  expect(withinWorktrees('/new/worktrees-external/repo', '/new/worktrees')).toBe(false)
  expect(withinWorktrees('/new/worktrees', '/new/worktrees')).toBe(false)
})

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

it('uses the configured branch prefix and keeps worktree names readable', async () => {
  const { taskWorktreePath } = await import('./task-branch')
  expect(taskBranchName('Fix login', 'a1b2', 'feature/')).toBe('feature/fix-login-a1b2')
  expect(taskBranchName('Fix login', 'a1b2', '')).toBe('fix-login-a1b2')
  expect(taskBranchName('Fix login', 'a1b2', 'team/dominic/')).toBe('team/dominic/fix-login-a1b2')
  expect(taskWorktreePath('github.com/acme/app', '/x', 'feature/fix-login-a1b2', 'feature/')).toBe(
    'acme/app-fix-login-a1b2',
  )
})
