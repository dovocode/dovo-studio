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
