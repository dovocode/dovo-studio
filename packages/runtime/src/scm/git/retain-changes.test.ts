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
