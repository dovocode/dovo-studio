import { expect, it } from 'vite-plus/test'
import type { Repository } from '../../workspace'
import type { PullSummary } from './pulls'
import {
  assignRemoteSources,
  forgePullIdentity,
  publicPullSummaries,
  pullRepositoryKey,
  pullRepositoryIdentity,
  selectPullSources,
  uniquePulls,
} from './pull-sources'
const repository: Repository = {
  id: 'app',
  name: 'App',
  path: '/app',
  branch: 'main',
  gitIdentity: 'github.com/team/app',
}
it('never carries account relationships when displaying another reader’s saved public rows', () => {
  const pull: PullSummary = {
    number: 1,
    title: 'Fix',
    url: 'https://github.com/team/app/pull/1',
    state: 'open',
    draft: false,
    author: 'work',
    updatedAt: '',
    head: 'branch',
    base: 'main',
    labels: [],
    viewerIsAuthor: true,
    viewerIsAssigned: true,
    viewerIsInvolved: true,
    viewerReviewRequested: true,
  }
  expect(publicPullSummaries([pull])[0]).toMatchObject({
    title: 'Fix',
    viewerIsAuthor: undefined,
    viewerIsAssigned: undefined,
    viewerIsInvolved: undefined,
    viewerReviewRequested: undefined,
  })
  expect(pull.viewerIsAuthor).toBe(true)
})
it('does not group a stale checkout identity but keeps an explicit forge target', () => {
  expect(
    pullRepositoryKey({ ...repository, gitIdentityError: 'Checkout unavailable' }, 'local'),
  ).toBe('local')
  expect(
    pullRepositoryKey(
      {
        ...repository,
        gitIdentityError: 'Checkout unavailable',
        pullIdentity: 'forge.example/team/app',
      },
      'local',
    ),
  ).toBe('forge.example/team/app')
})
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

it('spreads remotes across connected computers, prefers the local computer and keeps owners', () => {
  const repo = (name: string) => ({
    ...repository,
    id: name,
    gitIdentity: `github.com/team/${name}`,
  })
  const on = (runtimeId: string, name: string, connected = true) => ({
    key: `${runtimeId}:${name}`,
    runtimeId,
    connected,
    repository: repo(name),
  })
  const sources = [
    on('a', 'one'),
    on('b', 'one'),
    on('a', 'two'),
    on('b', 'two'),
    on('b', 'three'),
    on('c', 'three'),
  ]
  const first = assignRemoteSources(sources)
  expect([...first.owners.values()]).toEqual(['a:one', 'b:three', 'a:two'])
  const preferred = assignRemoteSources(sources, { preferredRuntimeId: 'b' })
  expect([...preferred.owners.values()]).toEqual(['b:one', 'b:three', 'b:two'])
  // Owners stay put across refreshes until they disconnect; then the remote moves.
  const kept = assignRemoteSources(sources, { previous: first.owners, preferredRuntimeId: 'b' })
  expect(kept.owners).toEqual(first.owners)
  const offline = sources.map((source) =>
    source.runtimeId === 'a' ? { ...source, connected: false } : source,
  )
  const moved = assignRemoteSources(offline, { previous: first.owners })
  expect(moved.owners.get('github.com/team/one')).toBe('b:one')
  expect(moved.selected.map((source) => source.key)).toEqual(['b:one', 'b:two', 'b:three'])
  // A custom remote identity dedupes other collections, such as Jira sites, the same way.
  const jira = assignRemoteSources(sources, { remote: (source) => source.repository.id })
  expect(jira.owners.size).toBe(3)
})

it('matches the bound target instead of a fork and rejects unknown bound identities', () => {
  expect(pullRepositoryIdentity(repository)).toBe('github.com/team/app')
  expect(
    pullRepositoryIdentity({
      ...repository,
      forge: { connectionId: 'work', repository: 'upstream/app' },
    }),
  ).toBeUndefined()
  expect(
    pullRepositoryIdentity({
      ...repository,
      pullIdentity: 'github.com/upstream/app',
      gitIdentityError: 'offline',
    }),
  ).toBe('github.com/upstream/app')
})

it('only hands a retained view to a verified reader of the same account', () => {
  const remote = 'github.com/team/app'
  const original = { ...source('a', false), readerIdentity: 'work' }
  const unknown = source('b')
  const personal = { ...source('c'), readerIdentity: 'personal' }
  const same = { ...source('d'), readerIdentity: 'work' }
  const options = {
    previous: new Map([[remote, 'a']]),
    previousReaderIdentities: new Map([[remote, 'work']]),
    requireSameReader: true,
  }
  expect(assignRemoteSources([original, unknown, personal], options).selected).toEqual([original])
  expect(assignRemoteSources([original, unknown, personal, same], options).selected).toEqual([same])
  // Disappearing owners and changed accounts do not reset the identity requirement.
  expect(assignRemoteSources([unknown, personal], options).selected).toEqual([])
  expect(
    assignRemoteSources([{ ...original, connected: true, readerIdentity: 'personal' }], options)
      .selected,
  ).toEqual([])
  expect(assignRemoteSources([same], options).selected).toEqual([same])
  expect(assignRemoteSources([unknown], { requireSameReader: true }).selected).toEqual([unknown])
})

it('chooses the same preferred server across clients, addresses, active runtimes and previous owners', () => {
  const candidates = [
    {
      ...source('desktop-local'),
      serverId: 'persistent-mac',
      readerIdentity: 'work',
      runtimeId: 'localhost',
    },
    {
      ...source('desktop-remote'),
      serverId: 'persistent-linux',
      readerIdentity: 'work',
      runtimeId: 'vpn-linux',
    },
  ]
  const options = { sharedPreference: true, requireSameReader: true }
  const desktop = assignRemoteSources(candidates, { ...options, preferredRuntimeId: 'localhost' })
    .selected[0]!
  const mobileCandidates = candidates
    .map((candidate, index) => ({
      ...candidate,
      key: `mobile-${index}`,
      runtimeId: `lan-${index}`,
    }))
    .reverse()
  const mobile = assignRemoteSources(mobileCandidates, {
    ...options,
    preferredRuntimeId: 'lan-1',
    previous: new Map([
      [
        'github.com/team/app',
        mobileCandidates.find((candidate) => candidate.serverId !== desktop.serverId)!.key,
      ],
    ]),
    previousReaderIdentities: new Map([['github.com/team/app', 'work']]),
  }).selected[0]!
  expect(mobile.serverId).toBe(desktop.serverId)
  const offline = candidates.map((candidate) => ({
    ...candidate,
    connected: candidate.serverId !== desktop.serverId,
  }))
  const failedOver = assignRemoteSources(offline, {
    ...options,
    previous: new Map([['github.com/team/app', desktop.key]]),
    previousReaderIdentities: new Map([['github.com/team/app', 'work']]),
  })
  expect(failedOver.selected[0]?.serverId).not.toBe(desktop.serverId)
  const recovered = assignRemoteSources(candidates, {
    ...options,
    previous: failedOver.owners,
    previousReaderIdentities: new Map([['github.com/team/app', 'work']]),
  })
  expect(recovered.selected[0]?.serverId).toBe(desktop.serverId)
  const wrongAccount = offline.map((candidate) =>
    candidate.connected ? { ...candidate, readerIdentity: 'personal' } : candidate,
  )
  expect(
    assignRemoteSources(wrongAccount, {
      ...options,
      previous: new Map([['github.com/team/app', desktop.key]]),
      previousReaderIdentities: new Map([['github.com/team/app', 'work']]),
    }).selected.every((candidate) => !candidate.connected),
  ).toBe(true)
})
