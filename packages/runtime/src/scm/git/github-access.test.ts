import { expect, it } from 'vite-plus/test'
import {
  githubAccessError,
  githubRequestRepository,
  type GithubCredentialSource,
} from './github-access.js'
import { GithubApiError, parseGithubApiArgs } from './github-transport.js'

it.each([
  ['settings', 'saved GitHub token', 'Update the saved token'],
  ['environment', 'runtime environment token', 'Update its token on the runtime computer'],
  ['gh', 'GitHub CLI login', 'gh auth login --hostname git.example.com'],
  ['gh-wrapper', 'configured GitHub CLI wrapper', 'Check the configured GitHub CLI wrapper'],
] satisfies Array<[GithubCredentialSource, string, string]>)(
  'identifies %s without echoing the upstream body',
  (source, label, repair) => {
    const failure = githubAccessError(new GithubApiError(404, 'upstream-secret'), {
      host: 'git.example.com',
      repository: 'team/project',
      login: 'verified-user',
      source,
    })
    expect(failure).toBeInstanceOf(GithubApiError)
    expect(failure).toMatchObject({ status: 404 })
    expect(String(failure)).toContain('missing or inaccessible')
    expect(String(failure)).toContain('git.example.com · team/project · verified-user')
    expect(String(failure)).toContain(label)
    expect(String(failure)).toContain(repair)
    expect(String(failure)).not.toContain('upstream-secret')
  },
)

it('preserves rate limits, non-access failures and binding changes by identity', () => {
  for (const error of [
    new GithubApiError(403, 'Secondary rate limit', 30, { secondary: true }),
    new GithubApiError(429, 'Rate limit'),
    new GithubApiError(502, 'Network unavailable'),
    Object.assign(new Error('Account changed'), { status: 409 }),
  ])
    expect(githubAccessError(error, { host: 'github.com', source: 'gh' })).toBe(error)
})

it('does not guess an unknown credential source or retain unsafe metadata', () => {
  const error = new GithubApiError(401, 'private upstream message')
  const failure = githubAccessError(error, {
    host: 'https://secret@host',
    repository: 'team/repo?token=secret',
    login: 'secret\nvalue',
  })
  expect(String(failure)).toContain('selected GitHub credential')
  expect(String(failure)).not.toContain('CLI login')
  expect(String(failure)).not.toContain('secret')
  expect(error.message).toBe('private upstream message')
})

it('extracts only a REST repository, leaving non-repository and GraphQL calls unguessed', () => {
  expect(githubRequestRepository(parseGithubApiArgs(['api', 'repos/team/project/pulls/1']))).toBe(
    'team/project',
  )
  expect(githubRequestRepository(parseGithubApiArgs(['api', 'user']))).toBeUndefined()
  expect(githubRequestRepository(parseGithubApiArgs(['api', 'graphql']))).toBeUndefined()
})
