import { expect, it } from 'vite-plus/test'
import { diffContentWidth } from './diff-layout'

it('keeps short diffs at least as wide as the viewport', () => {
  expect(diffContentWidth(['short'], 360, 1)).toBe(360)
})

it('reserves tab stops and wide glyphs without changing source text', () => {
  expect(diffContentWidth(['\t\tvalue'], 0, 1)).toBe((16 + 5) * 8 + 92)
  expect(diffContentWidth(['a\tb'], 0, 1)).toBe(9 * 8 + 92)
  expect(diffContentWidth(['漢字'], 0, 1)).toBe(4 * 8 + 92)
})

it('scales code and gutter space for Dynamic Type and car mode', () => {
  const lines = ['x'.repeat(100)]
  expect(diffContentWidth(lines, 360, 2)).toBe(diffContentWidth(lines, 360, 1) * 2)
  expect(diffContentWidth(lines, 360, 1.3)).toBe(diffContentWidth(lines, 360, 1) * 1.3)
})
