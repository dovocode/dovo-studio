import { afterEach, expect, it, vi } from 'vitest'
import type { GithubJSON } from './github-api.js'
import { githubThreads } from './github-threads.js'
import { githubChecks } from './github-checks.js'
import { PullRequests } from './pulls.js'
import { GitService } from './git.js'
import { pullStatuses } from './pull-statuses.js'

const repo = {
  nameWithOwner: 'team/project',
  url: 'https://github.com/team/project',
  host: 'github.com',
  repository: 'github.com/team/project',
  path: 'repos/team/project',
}
const done = { hasNextPage: false, endCursor: null }
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it('paginates both review threads and their comments while preserving resolution, permission and outdated state', async () => {
  const json = vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'thread-a',
                  isResolved: true,
                  isOutdated: true,
                  viewerCanResolve: false,
                  viewerCanUnresolve: true,
                  comments: {
                    nodes: [{ databaseId: 1 }],
                    pageInfo: { hasNextPage: true, endCursor: 'comment-next' },
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'thread-next' },
            },
          },
        },
      },
    })
    .mockResolvedValueOnce({
      data: { node: { comments: { nodes: [{ databaseId: 2 }], pageInfo: done } } },
    })
    .mockResolvedValueOnce({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'thread-b',
                  isResolved: false,
                  isOutdated: false,
                  viewerCanResolve: false,
                  viewerCanUnresolve: false,
                  comments: { nodes: [{ databaseId: 3 }], pageInfo: done },
                },
              ],
              pageInfo: done,
            },
          },
        },
      },
    })
  const threads = await githubThreads(json, repo, 7)
  expect(threads.get('inline-1')).toEqual({
    threadId: 'thread-a',
    resolved: true,
    outdated: true,
    canResolve: true,
  })
  expect(threads.get('inline-2')).toEqual(threads.get('inline-1'))
  expect(threads.get('inline-3')).toMatchObject({ threadId: 'thread-b', canResolve: false })
  expect(json.mock.calls[1][0]).toContain('cursor=comment-next')
  expect(json.mock.calls[2][0]).toContain('cursor=thread-next')
})

it('rejects GraphQL partial errors instead of implying every thread is unresolved', async () => {
  const json = vi.fn<GithubJSON>().mockResolvedValue({
    data: { repository: null },
    errors: [{ message: 'Review threads permission denied' }],
  })
  await expect(githubThreads(json, repo, 7)).rejects.toThrow('Review threads permission denied')
})

it('keeps detailed failing check output when annotations fail and loads every annotation page', async () => {
  const run = {
    id: 10,
    name: 'Lint',
    status: 'completed',
    conclusion: 'failure',
    html_url: `${repo.url}/actions/runs/10`,
    started_at: '2026-09-20T08:00:00Z',
    output: { summary: '**Two problems**', text: 'Run `pnpm check`.', annotations_count: 2 },
  }
  const json = vi
    .fn<GithubJSON>()
    .mockResolvedValueOnce([{ check_runs: [run, { ...run, id: 11, name: 'Types' }] }])
    .mockImplementation(async (args: string[]) => {
      if (args[3].includes('check-runs/11')) throw new Error('Annotations permission denied')
      return [
        [
          {
            path: 'a.ts',
            start_line: 3,
            end_line: 3,
            annotation_level: 'failure',
            message: 'Unused value',
          },
        ],
        [
          {
            path: 'b.ts',
            start_line: 5,
            end_line: 8,
            annotation_level: 'warning',
            message: 'Deprecated call',
            title: 'Migration',
          },
        ],
      ]
    })
  const details = await githubChecks(json, repo, 'a'.repeat(40))
  expect(details.checks.find((check) => check.id === '10')).toMatchObject({
    summary: '**Two problems**',
    details: 'Run `pnpm check`.',
    annotations: [
      { path: 'a.ts', startLine: 3, endLine: 3 },
      { path: 'b.ts', startLine: 5, endLine: 8 },
    ],
  })
  expect(details.checks.find((check) => check.id === '11')).toMatchObject({
    name: 'Types',
    status: 'failure',
    summary: '**Two problems**',
  })
  expect(details.warnings).toEqual(['Types annotations: Annotations permission denied'])
})

it('keeps team review requests unknown without claiming the viewer has no review request', async () => {
  const git = new GitService()
  vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      data: {
        viewer: { login: 'dominic' },
        repository: {
          pr7: {
            reviewRequests: {
              nodes: [{ requestedReviewer: {} }],
              pageInfo: { hasNextPage: false },
            },
            reviewDecision: 'REVIEW_REQUIRED',
            statusCheckRollup: null,
          },
        },
      },
    }),
  )
  expect(
    (await pullStatuses(git, '/repo', repo.host, repo.nameWithOwner, [7])).get(7)
      ?.viewerReviewRequested,
  ).toBeUndefined()
})

it('scopes identities to the active account, refreshes explicitly, and fails closed after failed authentication', async () => {
  vi.useFakeTimers()
  const git = new GitService()
  const status = (login: string, state = 'success') =>
    JSON.stringify({ hosts: { 'github.com': [{ login, active: true, state }] } })
  const run = vi.spyOn(git, 'githubAccount').mockResolvedValue(status('dominic'))
  const pulls = new PullRequests(git, { host: repo.host, repository: repo.nameWithOwner })
  const initial = await pulls.identity('/repo')
  expect(initial).toContain('dominic')
  expect(await pulls.identity('/repo')).toEqual(initial)
  expect(run).toHaveBeenCalledTimes(1)
  run.mockResolvedValue(status('another-user'))
  expect(await pulls.identity('/repo', true)).not.toEqual(initial)
  run.mockResolvedValue(status('another-user', 'error'))
  await expect(pulls.identity('/repo', true)).rejects.toThrow('No authenticated GitHub account')
  await expect(pulls.identity('/repo')).rejects.toThrow('No authenticated GitHub account')
  expect(run.mock.calls.every(([args]) => !args.includes('--show-token'))).toBe(true)
})

it('invalidates account identity when token environment changes without exposing the token', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'githubAccount').mockResolvedValue(
    JSON.stringify({
      hosts: { 'github.com': [{ login: 'dominic', active: true, state: 'success' }] },
    }),
  )
  const pulls = new PullRequests(git, { host: repo.host, repository: repo.nameWithOwner })
  vi.stubEnv('GH_TOKEN', 'test-first-secret')
  const first = await pulls.identity('/repo')
  vi.stubEnv('GH_TOKEN', 'test-second-secret')
  const second = await pulls.identity('/repo')
  expect(first).not.toEqual(second)
  expect(first).not.toContain('test-first-secret')
  expect(second).not.toContain('test-second-secret')
  expect(run).toHaveBeenCalledTimes(2)
})

it('enriches full detail without losing review decisions, requested teams, or classic commit statuses', async () => {
  const git = new GitService()
  const sha = 'a'.repeat(40)
  const url = `${repo.url}/pull/7`
  vi.spyOn(git, 'githubAccount').mockImplementation(async (args) => {
    if (args[0] === 'pr')
      return JSON.stringify({
        statusCheckRollup: [
          { context: 'external-ci', state: 'SUCCESS', targetUrl: 'https://ci.example.com/build/1' },
        ],
      })
    if (args[3] === 'graphql')
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: 'thread-1',
                    isResolved: false,
                    isOutdated: true,
                    viewerCanResolve: true,
                    viewerCanUnresolve: false,
                    comments: { nodes: [{ databaseId: 2 }], pageInfo: done },
                  },
                ],
                pageInfo: done,
              },
            },
          },
        },
      })
    const endpoint = args[3]
    if (endpoint === repo.path)
      return JSON.stringify({
        allow_squash_merge: true,
        allow_merge_commit: false,
        allow_rebase_merge: false,
      })
    if (endpoint.endsWith('/pulls/7'))
      return JSON.stringify({
        number: 7,
        title: 'Fix',
        html_url: url,
        state: 'open',
        merged_at: null,
        user: { login: 'dominic' },
        updated_at: '2026-09-20T08:00:00Z',
        head: { label: 'team:fix', sha },
        base: { label: 'team:main', sha: 'b'.repeat(40) },
        labels: [],
        body: 'Description',
        additions: 1,
        deletions: 0,
        changed_files: 1,
        mergeable: true,
        requested_reviewers: [],
        requested_teams: [{ slug: 'maintainers' }],
        assignees: [],
      })
    const common = {
      user: { login: 'reviewer' },
      body: '',
      html_url: `${url}#feedback`,
      created_at: '2026-09-20T08:00:00Z',
    }
    if (endpoint.includes('/reviews?'))
      return JSON.stringify([
        [{ ...common, id: 1, state: 'APPROVED', submitted_at: common.created_at, commit_id: sha }],
      ])
    if (endpoint.includes('/pulls/7/comments?'))
      return JSON.stringify([
        [
          {
            ...common,
            id: 2,
            body: 'Please check cancellation.',
            path: 'src/runtime.ts',
            line: 4,
            original_line: 4,
            diff_hunk: '@@ -1 +1 @@',
          },
        ],
      ])
    if (endpoint.includes('/files?'))
      return JSON.stringify([
        [
          {
            filename: 'src/runtime.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
            patch: '@@ -1 +1 @@',
          },
        ],
      ])
    if (endpoint.includes('/check-runs?'))
      return JSON.stringify([
        {
          check_runs: [
            {
              id: 10,
              name: 'Types',
              status: 'completed',
              conclusion: 'failure',
              output: { summary: 'A type failed', annotations_count: 0 },
            },
          ],
        },
      ])
    return JSON.stringify([[]])
  })
  const detail = await new PullRequests(git, {
    host: repo.host,
    repository: repo.nameWithOwner,
  }).detail('/repo', 7)
  expect(detail.warnings).toEqual([])
  expect(detail.capabilities).toMatchObject({
    mergeMethods: ['squash'],
    inlineRange: true,
    draft: true,
  })
  expect(detail.pull).toMatchObject({
    provider: 'github',
    cloneUrl: `${repo.url}.git`,
    headRef: 'refs/pull/7/head',
    reviewers: ['maintainers'],
  })
  expect(detail.fileBaseUrl).toBe(`${repo.url}/blob/${sha}/`)
  expect(detail.comments.find((comment) => comment.id === 'review-1')).toMatchObject({
    state: 'APPROVED',
    body: '',
    commitId: sha,
  })
  expect(detail.comments.find((comment) => comment.id === 'inline-2')).toMatchObject({
    threadId: 'thread-1',
    outdated: true,
    resolved: false,
    canResolve: true,
  })
  expect(detail.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: '10', summary: 'A type failed' }),
      expect.objectContaining({ name: 'external-ci', status: 'SUCCESS' }),
    ]),
  )
})

it('loads explicit-target list status through account transport without requiring a checkout', async () => {
  const git = new GitService()
  const inspect = vi.spyOn(git, 'inspect').mockRejectedValue(new Error('Not a checkout'))
  vi.spyOn(git, 'githubAccount').mockImplementation(async (args) =>
    JSON.stringify(
      args[3] === 'graphql'
        ? {
            data: {
              viewer: { login: 'reviewer' },
              repository: {
                pr7: { reviewDecision: 'APPROVED', statusCheckRollup: { state: 'SUCCESS' } },
              },
            },
          }
        : [
            {
              number: 7,
              title: 'Fix',
              html_url: `${repo.url}/pull/7`,
              state: 'open',
              merged_at: null,
              user: { login: 'dominic' },
              updated_at: '2026-09-20T08:00:00Z',
              head: { label: 'team:fix' },
              base: { label: 'team:main' },
              labels: [],
            },
          ],
    ),
  )
  const page = await new PullRequests(git, {
    host: repo.host,
    repository: repo.nameWithOwner,
  }).list('/not-a-checkout', 'open', 1)
  expect(page.pulls[0]).toMatchObject({ reviewDecision: 'APPROVED', checksState: 'SUCCESS' })
  expect(page.pulls[0].statusError).toBeUndefined()
  expect(inspect).not.toHaveBeenCalled()
})

it('keeps project-local CLI account identity caches separate', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'githubAccount').mockImplementation(async (_args, _limits, cwd) =>
    JSON.stringify({
      hosts: {
        'github.com': [
          {
            login: cwd === '/first' ? 'first-user' : 'second-user',
            active: true,
            state: 'success',
          },
        ],
      },
    }),
  )
  const pulls = new PullRequests(git, { host: repo.host, repository: repo.nameWithOwner })
  expect(await pulls.identity('/first')).toContain('first-user')
  expect(await pulls.identity('/second')).toContain('second-user')
  expect(run).toHaveBeenCalledTimes(2)
})
it('verifies a named GitHub profile without switching the globally active account', async () => {
  const git = new GitService()
  const run = vi
    .spyOn(git, 'githubAccount')
    .mockResolvedValue(JSON.stringify({ login: 'selected-user' }))
  const token = vi.fn<(cwd: string) => Promise<string>>().mockResolvedValue('fixture-private-token')
  const pulls = new PullRequests(git, {
    host: repo.host,
    repository: repo.nameWithOwner,
    profile: 'selected-user',
    token,
  })
  const identity = await pulls.identity('/checkout')
  expect(identity).toContain('selected-user')
  expect(identity).not.toContain('fixture-private-token')
  expect(run).toHaveBeenCalledExactlyOnceWith(
    ['api', '--hostname', repo.host, 'user'],
    { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    '/checkout',
    { host: repo.host, token: 'fixture-private-token' },
  )
  run.mockResolvedValue(JSON.stringify({ login: 'unexpected-user' }))
  await expect(pulls.identity('/checkout', true)).rejects.toThrow('selected GitHub profile changed')
})
