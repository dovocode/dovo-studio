import { expect, it } from 'vite-plus/test'
import { workingGitStatus } from './working-status.js'

it.each([
  [' M', 'unchanged', 'modified'],
  ['M ', 'modified', 'unchanged'],
  ['MM', 'modified', 'modified'],
  ['A ', 'added', 'unchanged'],
  ['AD', 'added', 'deleted'],
  [' D', 'unchanged', 'deleted'],
  ['D ', 'deleted', 'unchanged'],
  ['??', 'unchanged', 'untracked'],
  [' T', 'unchanged', 'type-changed'],
  ['ZZ', 'unknown', 'unknown'],
])('reads index and working tree status for %s', (xy, index, workingTree) => {
  expect(workingGitStatus(xy)).toEqual({ index, workingTree })
})

it.each(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])(
  'keeps unmerged %s out of ordinary staged membership',
  (xy) => {
    expect(workingGitStatus(xy)).toEqual({ index: 'unmerged', workingTree: 'unmerged' })
  },
)
