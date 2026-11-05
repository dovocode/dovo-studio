import { expect, it } from 'vite-plus/test'
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
it('invalidates image/binary review state when saved hashes or modes change', () => {
  const image = {
    ...file,
    before: '',
    after: '',
    preview: { kind: 'image' as const, after: { hash: 'old', size: 10, mode: '100644' } },
  }
  const scanned = { ...image, viewed: false }
  expect(retainChangedFiles([image], [scanned])[0]).toBe(image)
  const changed = {
    ...scanned,
    preview: { ...scanned.preview, after: { ...scanned.preview.after, hash: 'new' } },
  }
  expect(retainChangedFiles([image], [changed])[0]).toBe(changed)
  expect(retainChangedFiles([image], [changed])[0].viewed).toBe(false)
})
it('publishes staging-only updates while preserving content review marks', () => {
  const unstaged = {
    ...file,
    gitStatus: { index: 'unchanged' as const, workingTree: 'modified' as const },
  }
  const staged = {
    ...unstaged,
    viewed: false,
    gitStatus: { index: 'modified' as const, workingTree: 'unchanged' as const },
  }
  const result = retainChangedFiles([unstaged], [staged])
  expect(result[0]).toEqual({ ...staged, viewed: true })
  expect(result[0]).not.toBe(unstaged)
  expect(retainChangedFiles(result, [staged])).toBe(result)
  // An older scan without metadata must not retain an obsolete staged claim.
  expect(retainChangedFiles(result, [{ ...file, viewed: false }])[0]).toEqual(file)
})
