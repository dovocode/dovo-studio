import { expect, it } from 'vite-plus/test'
import { linkedProjectCommand } from './linked-project-command.js'

const checkout = { id: 'checkout-42', repositoryId: 'repo-42', execution: 'main', access: 'edit' }
it.each([checkout, JSON.stringify(checkout)])(
  'validates structured and encoded checkout metadata: %s',
  (value) => {
    expect(linkedProjectCommand({ action: 'add', checkout: value })).toEqual({
      action: 'add',
      checkout,
    })
  },
)
it('preserves discovery commands and their validation', () => {
  expect(linkedProjectCommand({ action: 'projects' })).toEqual({ action: 'projects' })
  expect(linkedProjectCommand({ action: 'worktrees', repositoryId: 'repo-42' })).toEqual({
    action: 'worktrees',
    repositoryId: 'repo-42',
  })
  expect(() => linkedProjectCommand({ action: 'worktrees' })).toThrow('repositoryId')
})
it.each([false, true])(
  'omits nullable optional metadata without weakening required fields (encoded: %s)',
  (encoded) => {
    const value = { ...checkout, existingWorktreePath: null, baseBranch: null, branch: null }
    expect(
      linkedProjectCommand({ action: 'add', checkout: encoded ? JSON.stringify(value) : value }),
    ).toEqual({ action: 'add', checkout })
    expect(() =>
      linkedProjectCommand({ action: 'add', checkout: JSON.stringify({ ...value, id: null }) }),
    ).toThrow('checkout')
    expect(() =>
      linkedProjectCommand({ action: 'add', checkout: JSON.stringify({ ...value, branch: 42 }) }),
    ).toThrow('checkout')
  },
)
it('rejects invalid JSON before sending a command', () => {
  expect(() => linkedProjectCommand({ action: 'add', checkout: '{broken' })).toThrow(
    'Linked checkout must contain a valid JSON object.',
  )
})
it.each([
  'null',
  '[]',
  'true',
  '42',
  '"nested-string"',
  '{}',
  JSON.stringify({ ...checkout, access: 'admin' }),
  JSON.stringify({ ...checkout, id: '../escape' }),
])('rejects invalid encoded checkouts: %s', (value) => {
  expect(() => linkedProjectCommand({ action: 'add', checkout: value })).toThrow('checkout')
})
