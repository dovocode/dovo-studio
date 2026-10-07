import { expect, it } from 'vite-plus/test'
import type { Repository } from '../../workspace'
import { forgePullIdentity, selectPullSources, uniquePulls } from './pull-sources'
const repository: Repository = {
  id: 'app',
  name: 'App',
  path: '/app',
  branch: 'main',
  gitIdentity: 'github.com/team/app',
}
const source = (key: string, connected = true, repo = repository) => ({
  key,
  connected,
  repository: repo,
})
it('reads a remote once across servers and worktrees, independent of source order', () => {
  const sources = [source('z-server'), source('a-server'), source('a-worktree')]
  expect(selectPullSources(sources)).toEqual([sources[1]])
  expect(selectPullSources([...sources].reverse())).toEqual([sources[1]])
  expect(selectPullSources([sources[0]])).toEqual([sources[0]])
})
it('fails over to a connected server and retains one offline source when all are offline', () => {
  expect(selectPullSources([source('a-server', false), source('z-server')])).toEqual([
    source('z-server'),
  ])
  expect(selectPullSources([source('z-server', false), source('a-server', false)])).toEqual([
    source('a-server', false),
  ])
})
it('keeps hosts, forks, unknown identities and distinct bound PR targets separate', () => {
  const sources = [
    source('original'),
    source('fork', true, { ...repository, gitIdentity: 'github.com/fork/app' }),
    source('enterprise', true, { ...repository, gitIdentity: 'github.example/team/app' }),
    source('unknown', true, { ...repository, gitIdentity: undefined }),
    source('other-unknown', true, { ...repository, gitIdentity: undefined }),
    source('bound', true, {
      ...repository,
      forge: { connectionId: 'work', repository: 'other/app' },
      pullIdentity: 'github.com/other/app',
    }),
  ]
  expect(selectPullSources(sources)).toEqual(sources)
})
it('uses the bound PR target and preserves the selected account rather than merging viewers', () => {
  const selected = source('a-work', true, {
    ...repository,
    forge: { connectionId: 'work', repository: 'other/app' },
    pullIdentity: 'github.com/other/app',
  })
  const alternate = source('z-personal', true, {
    ...selected.repository,
    forge: { connectionId: 'personal', repository: 'other/app' },
  })
  expect(selectPullSources([alternate, selected])).toEqual([selected])
  const rows = [
    { url: 'https://github.com/other/app/pull/7', viewerIsAuthor: false },
    { url: 'https://github.com/other/app/pull/7/?tab=files', viewerIsAuthor: true },
    { url: 'https://github.example/other/app/pull/7', viewerIsAuthor: true },
    { url: 'https://github.com/other/app/pull/8', viewerIsAuthor: false },
  ]
  expect(uniquePulls(rows)).toEqual([rows[0], rows[2], rows[3]])
})

it('canonicalizes forge targets without leaking credentials or confusing API and clone hosts', () => {
  expect(
    forgePullIdentity({ provider: 'github', baseUrl: 'https://github.example' }, 'Team/App'),
  ).toBe('github.example/team/app')
  expect(
    forgePullIdentity(
      { provider: 'bitbucket', baseUrl: 'https://api.bitbucket.org/2.0' },
      'Team/App',
    ),
  ).toBe('bitbucket.org/team/app')
  expect(
    forgePullIdentity(
      { provider: 'azure-devops', baseUrl: 'https://dev.azure.com/org' },
      'Project/App',
    ),
  ).toBe('dev.azure.com/org/project/_git/app')
  expect(
    forgePullIdentity({ provider: 'forgejo', baseUrl: 'http://forge.local:3000/git/' }, 'Team/App'),
  ).toBe('forge.local:3000/git/Team/App')
})
