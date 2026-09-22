import { expect, it } from 'vitest'
import { parsePatchFiles } from '@pierre/diffs'
import { pullFilePatch } from '@dovo/studio-core'
import { reviewPatch } from './review-patch'
const parse = (patch: string) =>
  parsePatchFiles(pullFilePatch({ status: 'modified', patch }), undefined, true)[0].files[0]
it('renders a truncated review excerpt with its original line coordinates', () => {
  const patch =
    '@@ -255,12 +255,14 @@ function Toast() {\n context\n-old comment\n+decision comment\n another line'
  expect(() => parse(patch)).toThrow('hunk line count mismatch')
  const normalized = reviewPatch(patch)
  expect(normalized).toContain('@@ -255,3 +255,3 @@ function Toast() {')
  const diff = parse(normalized)
  expect(diff.hunks[0]).toMatchObject({
    deletionStart: 255,
    additionStart: 255,
    deletionCount: 3,
    additionCount: 3,
  })
})
it('preserves full hunks, blank context lines, multiple hunks and no-newline markers', () => {
  const patch =
    '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n@@ -10,2 +10,2 @@\n \n tail\n'
  expect(parse(reviewPatch(patch)).hunks).toHaveLength(2)
})
it('does not silently repair malformed or overflowing review hunks', () => {
  expect(() => reviewPatch('@@ -1 +1 @@\n invalid\n extra')).toThrow('exceeds')
  expect(() => reviewPatch('@@ -1 +1 @@\ninvalid')).toThrow('Invalid review hunk line')
})
