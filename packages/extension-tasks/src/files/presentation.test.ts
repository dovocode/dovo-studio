import { expect, it } from 'vite-plus/test'
import { fileStats } from './presentation'
it('counts edited lines without including unchanged context', () => {
  const file = {
    path: 'file.ts',
    before: 'one\ntwo\nthree\n',
    after: 'one\nchanged\nextra\nthree\n',
    viewed: false,
  }
  expect(fileStats(file)).toEqual({ path: 'file.ts', additions: 2, deletions: 1 })
  expect(fileStats({ ...file, after: file.before })).toEqual({
    path: 'file.ts',
    additions: 0,
    deletions: 0,
  })
  expect(fileStats({ ...file, before: '', after: 'one\ntwo\n' })).toEqual({
    path: 'file.ts',
    additions: 2,
    deletions: 0,
  })
  expect(fileStats({ ...file, before: 'one\ntwo\n', after: '' })).toEqual({
    path: 'file.ts',
    additions: 0,
    deletions: 2,
  })
})
