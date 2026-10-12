import { expect, it } from 'vite-plus/test'
import { fileStats } from './stats'
it('counts changed lines rather than unchanged file contents', () => {
  expect(
    fileStats({ path: 'a.ts', viewed: false, before: 'same\nold\n', after: 'same\nnew\nextra\n' }),
  ).toEqual({
    additions: 2,
    deletions: 1,
  })
})
