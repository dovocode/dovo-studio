import { expect, it } from 'vite-plus/test'
import { checkpointFolders, fileStats } from './stats'
it('keeps root files at top level and groups real directories without duplicate paths', () => {
  expect([
    ...checkpointFolders(['README.md', 'src/a.ts', 'src/b.ts', 'src/a.ts', 'src/ui/view.tsx']),
  ]).toEqual([
    ['', ['README.md']],
    ['src', ['src/a.ts', 'src/b.ts']],
    ['src/ui', ['src/ui/view.tsx']],
  ])
})
it('counts changed lines rather than unchanged file contents', () => {
  expect(
    fileStats({ path: 'a.ts', viewed: false, before: 'same\nold\n', after: 'same\nnew\nextra\n' }),
  ).toEqual({
    additions: 2,
    deletions: 1,
  })
})
