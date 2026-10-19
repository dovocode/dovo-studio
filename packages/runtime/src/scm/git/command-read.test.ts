import { expect, it } from 'vite-plus/test'
import { cliRead } from './command-read.js'

const settings = { git: '/custom/git-wrapper', gh: '/custom/gh-wrapper' }
it.each([
  ['git', 'rev-parse', '--show-toplevel'],
  ['git', 'branch', '--show-current'],
  ['git', 'remote'],
  ['git', 'remote', 'get-url', '--push', 'origin'],
  ['git', 'config', '--null', '--list'],
  ['git', 'config', '--get', 'remote.origin.url'],
  ['git', 'config', '--file', '/repo/config', '--get', 'remote.origin.url'],
  ['git', 'config', 'get', 'remote.origin.url'],
  ['git', '--literal-pathspecs', 'ls-tree', '-z', 'HEAD'],
  ['git', '-c', 'core.quotePath=false', '-C', '/repo', 'diff', '--stat'],
  ['git', 'cat-file', '--batch'],
  ['C:\\Git\\bin\\git.exe', 'status', '--porcelain=v2'],
  [settings.git, 'rev-parse', 'HEAD'],
  [settings.gh, 'repo', 'view', '--json', 'nameWithOwner,url'],
  ['gh', 'pr', 'checks', '42', '--json', 'name,state'],
  ['gh', 'run', 'view', '42', '--log-failed'],
  ['gh', 'auth', 'status'],
  ['gh', 'api', '--hostname', 'github.com', 'repos/owner/repo/actions/runs'],
  ['gh', 'api', 'graphql', '-f', 'query=query { viewer { login } }'],
])('recognizes routine read %j', (...args) => {
  expect(cliRead(args, settings)).toBe(true)
})

it.each([
  ['git', 'push', 'origin', 'main'],
  ['git', 'commit', '-m', 'Update'],
  ['git', 'branch', '-D', 'feature'],
  ['git', 'branch', 'new-branch'],
  ['git', 'branch', '--show-current', '--delete', 'feature'],
  ['git', 'remote', 'set-url', 'origin', 'https://github.com/team/other'],
  ['git', 'config', 'user.name', 'New name'],
  ['git', 'config', '--file', '--list', 'user.name', 'New name'],
  ['git', 'config', '--file=--list', 'user.name', 'New name'],
  ['git', 'config', '--unset', 'remote.origin.url'],
  ['git', 'config', '--get', '--unset', 'remote.origin.url'],
  ['git', 'diff', '--output=/tmp/diff'],
  ['git', 'log', '--output', '/tmp/log'],
  ['git', '-c', 'core.quotePath=false', 'add', 'file'],
  ['git', 'unknown-command'],
  ['gh', 'api', 'repos/team/app/issues', '-f', 'title=New issue'],
  ['gh', 'api', 'repos/team/app', '--method', 'DELETE'],
  [
    'gh',
    'api',
    'graphql',
    '-f',
    'query=mutation { addStar(input:{starrableId:"id"}) { clientMutationId } }',
  ],
  ['gh', 'api', 'graphql', '--input', '-'],
  ['gh', 'api', 'repos/team/app', '--unknown'],
  ['gh', 'pr', 'merge', '42'],
  ['gh', 'pr', 'view', '42', '--web'],
  ['gh', 'workflow', 'run', 'nightly'],
  ['gh', 'run', 'download', '42'],
  ['node', 'script.js'],
])('preserves mutations and unknown command %j', (...args) => {
  expect(cliRead(args, settings)).toBe(false)
})
