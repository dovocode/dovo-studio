import { expect, it } from 'vite-plus/test'
import { whitespaceOnlyFile, whitespaceOnlyPatch } from './whitespace-changes'
it('hides modified whitespace previews while retaining unavailable previews and file operations', () => {
  const file = { status: 'modified', before: 'x = 1\n', after: 'x=1\n' }
  expect(whitespaceOnlyFile(file)).toBe(true)
  expect(whitespaceOnlyFile({ ...file, after: 'x=2\n' })).toBe(false)
  expect(whitespaceOnlyFile({ ...file, status: 'added' })).toBe(false)
  expect(whitespaceOnlyFile({ ...file, previousPath: 'old' })).toBe(false)
  expect(whitespaceOnlyFile({ ...file, before: undefined })).toBe(false)
})
it('compares patch hunks independently and keeps semantic changes', () => {
  const patch = '@@ -1 +1 @@\n-x = 1\n+x=1\n'
  expect(whitespaceOnlyPatch({ status: 'modified', patch })).toBe(true)
  expect(
    whitespaceOnlyPatch({ status: 'modified', patch: patch + '@@ -5 +5 @@\n-y=1\n+y=2' }),
  ).toBe(false)
  expect(whitespaceOnlyPatch({ status: 'modified' })).toBe(false)
  expect(whitespaceOnlyPatch({ status: 'renamed', patch })).toBe(false)
})
