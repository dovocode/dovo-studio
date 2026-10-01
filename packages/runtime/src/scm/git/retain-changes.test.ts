import { expect, it } from 'vitest'
import { retainChangedFiles } from './retain-changes.js'

const file = { path: 'app.ts', before: 'old', after: 'new', viewed: true }
it('keeps review marks and the same collection for an unchanged scan', () => {
  const previous = [file]
  expect(retainChangedFiles(previous, [{ ...file, viewed: false }])).toBe(previous)
})
it('invalidates review marks when content changes and includes additions and removals', () => {
  const changed = { ...file, after: 'newer', viewed: false }
  const added = { ...file, path: 'new.ts', viewed: false }
  expect(retainChangedFiles([file], [changed, added])).toEqual([changed, added])
  expect(retainChangedFiles([file], [])).toEqual([])
})
