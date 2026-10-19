import { it, expect } from 'vite-plus/test'
import { insertDictation } from './dictation-audio'

it('inserts at the captured selection and preserves surrounding punctuation', () => {
  expect(insertDictation('Fix the bug.', 'crash', 8, 11)).toBe('Fix the crash.')
  expect(insertDictation('Hello world', 'beautiful', 6, 6)).toBe('Hello beautiful world')
  expect(insertDictation('', ' Hallo wereld! ', 0, 0)).toBe('Hallo wereld!')
  expect(insertDictation('Fix', 'this', 3, 3)).toBe('Fix this')
})
