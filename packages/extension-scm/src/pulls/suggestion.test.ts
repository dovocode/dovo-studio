import { expect, it } from 'vitest'
import { parsePatchFiles } from '@pierre/diffs'
import { pullFilePatch } from '@dovo/studio-core'
import { suggestionComment } from '../../../studio-ui/src/suggestion'
import { selectedPatchCode } from './selected-code'
it('extracts multiline replacements using original patch coordinates and rejects missing context', () => {
  const diff = parsePatchFiles(
    pullFilePatch({ status: 'modified', patch: '@@ -20,2 +20,3 @@\n old\n-tail\n+first\n+second' }),
    undefined,
    true,
  )[0].files[0]
  expect(selectedPatchCode(diff, 21, 22)).toBe('first\nsecond')
  expect(selectedPatchCode(diff, 19, 22)).toBeUndefined()
})
it('formats replacement, deletion and code containing fences without losing whitespace', () => {
  expect(suggestionComment('Fix', '  a\n  b')).toBe('Fix\n\n```suggestion\n  a\n  b\n```')
  expect(suggestionComment('', '')).toBe('```suggestion\n```')
  expect(suggestionComment('', '```')).toBe('````suggestion\n```\n````')
})
