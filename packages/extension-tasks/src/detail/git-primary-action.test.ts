import { expect, it } from 'vite-plus/test'
import { gitPrimaryAction } from './git-primary-action'

const clean = {
  dirty: false,
  canPush: true,
  branch: 'feature',
  ahead: 0,
  behind: 0,
  tracking: true,
}
it('prioritizes committing over pushing or opening a PR', () => {
  expect(gitPrimaryAction({ ...clean, dirty: true, ahead: 2 }, true)).toBe('Commit & push')
  expect(gitPrimaryAction({ ...clean, dirty: true, canPush: false }, true)).toBe('Commit')
})
it('pushes unpublished commits before opening a PR', () => {
  expect(gitPrimaryAction({ ...clean, ahead: 1 }, true)).toBe('Push branch')
  expect(gitPrimaryAction({ ...clean, tracking: false }, false)).toBe('Push branch')
  expect(gitPrimaryAction(clean, true)).toBe('Open PR')
})
it('does not suggest a push when behind and preserves manual controls', () => {
  expect(gitPrimaryAction({ ...clean, ahead: 1, behind: 1 }, false)).toBe('Git actions')
  expect(gitPrimaryAction(null, false)).toBe('Git actions')
})
