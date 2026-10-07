import { expect, it, vi } from 'vite-plus/test'
import { GitService } from '../git/git'
import { pullStatuses } from './pull-statuses'
it('loads check and review statuses in one repository-scoped request', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      data: {
        repository: {
          pr1: { reviewDecision: 'APPROVED', statusCheckRollup: { state: 'SUCCESS' } },
          pr2: { reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: { state: 'FAILURE' } },
          pr3: { reviewDecision: null, statusCheckRollup: null },
          pr4: { reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: { state: 'PENDING' } },
        },
      },
    }),
  )
  const result = await pullStatuses(git, '/project', 'git.example.com', 'team/repo', [1, 2, 3, 4])
  expect(result.get(1)).toEqual({ checksState: 'SUCCESS', reviewDecision: 'APPROVED' })
  expect(result.get(2)?.checksState).toBe('FAILURE')
  expect(result.get(3)?.checksState).toBeNull()
  expect(result.get(4)?.checksState).toBe('PENDING')
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith(
    '/project',
    expect.arrayContaining(['git.example.com', 'owner=team', 'name=repo']),
  )
})
it('distinguishes unavailable statuses from no checks and skips empty pages', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockRejectedValue(new Error('Permission denied'))
  expect(await pullStatuses(git, '/project', 'github.com', 'team/repo', [])).toEqual(new Map())
  expect(run).not.toHaveBeenCalled()
  const result = await pullStatuses(git, '/project', 'github.com', 'team/repo', [1])
  expect(result.get(1)).toEqual({ statusError: 'Permission denied' })
})

it('identifies explicit current-user review requests and authored PRs', async () => {
  const git = new GitService()
  vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      data: {
        viewer: { login: 'dominic' },
        repository: {
          pr1: {
            viewerDidAuthor: false,
            reviewDecision: 'REVIEW_REQUIRED',
            statusCheckRollup: null,
            reviewRequests: {
              nodes: [{ requestedReviewer: { login: 'dominic' } }],
              pageInfo: { hasNextPage: false },
            },
          },
          pr2: {
            viewerDidAuthor: true,
            reviewDecision: null,
            statusCheckRollup: null,
            reviewRequests: { nodes: [{ requestedReviewer: {} }], pageInfo: { hasNextPage: true } },
          },
        },
      },
    }),
  )
  const result = await pullStatuses(git, '/project', 'github.com', 'team/repo', [1, 2])
  expect(result.get(1)).toMatchObject({ viewerIsAuthor: false, viewerReviewRequested: true })
  expect(result.get(2)?.viewerIsAuthor).toBe(true)
  expect(result.get(2)?.viewerReviewRequested).toBeUndefined()
})

it('loads diff and comment totals in the status batch, including zero counts', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      data: {
        repository: {
          pr1: {
            additions: 123,
            deletions: 45,
            totalCommentsCount: 8,
            reviewDecision: null,
            statusCheckRollup: null,
          },
          pr2: {
            additions: 0,
            deletions: 0,
            totalCommentsCount: 0,
            reviewDecision: null,
            statusCheckRollup: null,
          },
        },
      },
    }),
  )
  const result = await pullStatuses(git, '/project', 'github.com', 'team/repo', [1, 2])
  expect(result.get(1)).toMatchObject({ additions: 123, deletions: 45, commentCount: 8 })
  expect(result.get(2)).toMatchObject({ additions: 0, deletions: 0, commentCount: 0 })
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0][1].join(' ')).toContain('additions deletions totalCommentsCount')
})

it('personalizes assignment and involvement without excluding paginated unknown relationships', async () => {
  const git = new GitService()
  const users = (names: string[], more = false) => ({
    nodes: names.map((login) => ({ login })),
    pageInfo: { hasNextPage: more },
  })
  vi.spyOn(git, 'github').mockResolvedValue(
    JSON.stringify({
      data: {
        viewer: { login: 'dominic' },
        repository: {
          pr1: {
            viewerDidAuthor: false,
            assignees: users(['dominic']),
            participants: users([]),
            reviewDecision: null,
            statusCheckRollup: null,
          },
          pr2: {
            viewerDidAuthor: false,
            assignees: users([], true),
            participants: users([], true),
            reviewDecision: null,
            statusCheckRollup: null,
          },
          pr3: {
            viewerDidAuthor: false,
            assignees: users([]),
            participants: users(['dominic']),
            reviewDecision: null,
            statusCheckRollup: null,
          },
        },
      },
    }),
  )
  const result = await pullStatuses(git, '/project', 'github.com', 'team/repo', [1, 2, 3])
  expect(result.get(1)).toMatchObject({ viewerIsAssigned: true, viewerIsInvolved: true })
  expect(result.get(2)?.viewerIsAssigned).toBeUndefined()
  expect(result.get(2)?.viewerIsInvolved).toBeUndefined()
  expect(result.get(3)).toMatchObject({ viewerIsAssigned: false, viewerIsInvolved: true })
})
