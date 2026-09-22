import { afterEach, expect, it, vi } from 'vitest'
import { GitService } from './git'
import { PullRequests } from './pulls'
const pull = {
  number: 7,
  title: 'Fix runtime',
  html_url: 'https://git.example.com/team/project/pull/7',
  state: 'open',
  merged_at: null,
  draft: false,
  user: { login: 'dominic' },
  updated_at: '2026-09-07T10:00:00Z',
  head: { label: 'team:fix', sha: 'a'.repeat(40) },
  base: { label: 'team:main', sha: 'b'.repeat(40) },
  labels: [{ name: 'bug' }],
  body: 'Description',
  additions: 3,
  deletions: 1,
  changed_files: 2,
  mergeable: null,
  requested_reviewers: [],
  assignees: [],
}
const comment = {
  id: 1,
  user: null,
  body: 'Conversation',
  html_url: pull.html_url,
  created_at: '2026-09-07T10:00:00Z',
}
afterEach(() => vi.restoreAllMocks())
it('loads repository-scoped pages and keeps merged and draft states', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) =>
    JSON.stringify(
      args[0] === 'repo'
        ? { nameWithOwner: 'team/project', url: 'https://git.example.com/team/project' }
        : Array.from({ length: 50 }, (_, i) => ({
            ...pull,
            number: i + 1,
            draft: i === 0,
            state: 'closed',
            merged_at: i === 0 ? '2026-09-07T10:00:00Z' : null,
          })),
    ),
  )
  const page = await new PullRequests(git).list('/project/worktree', 'closed', 2)
  expect(page).toMatchObject({ page: 2, hasMore: true })
  expect(page.pulls[0]).toMatchObject({ state: 'merged', draft: true })
  expect(page.pulls[1].state).toBe('closed')
  expect(run).toHaveBeenCalledWith('/project/worktree', [
    'api',
    '--hostname',
    'git.example.com',
    'repos/team/project/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=2',
  ])
})
it('combines all comment pages and preserves details when a check request fails', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    if (args[0] === 'pr') throw new Error('Checks permission denied')
    const endpoint = args[3]
    if (endpoint.endsWith('/pulls/7')) return JSON.stringify(pull)
    expect(args.slice(-2)).toEqual(['--paginate', '--slurp'])
    if (endpoint.includes('/issues/'))
      return JSON.stringify([[comment], [{ ...comment, id: 2, body: 'Second page' }]])
    if (endpoint.includes('/reviews?'))
      return JSON.stringify([
        [{ ...comment, id: 3, state: 'APPROVED', submitted_at: comment.created_at }],
      ])
    if (endpoint.includes('/comments?'))
      return JSON.stringify([
        [
          {
            ...comment,
            id: 4,
            path: 'src/a.ts',
            line: null,
            original_line: 12,
            diff_hunk: '@@ -1 +1 @@',
            in_reply_to_id: 5,
          },
        ],
      ])
    return JSON.stringify([
      [
        {
          filename: 'src/a.ts',
          status: 'modified',
          additions: 3,
          deletions: 1,
          patch: '@@ -1 +1 @@',
        },
      ],
    ])
  })
  const detail = await new PullRequests(git).detail('/project/worktree', 7)
  expect(detail.comments).toHaveLength(4)
  expect(detail.comments.find((c) => c.id === 'comment-2')?.body).toBe('Second page')
  expect(detail.comments.find((c) => c.id === 'inline-4')).toMatchObject({
    line: 12,
    replyTo: 'inline-5',
    author: 'Deleted user',
  })
  expect(detail.warnings).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Checks permission denied'),
      expect.stringContaining('only part'),
    ]),
  )
  expect(detail.files).toHaveLength(1)
  expect(run.mock.calls.every(([cwd]) => cwd === '/project/worktree')).toBe(true)
})
it('posts line ranges to the pinned PR in the project host and rejects stale heads', async () => {
  const git = new GitService()
  const run = vi
    .spyOn(git, 'github')
    .mockImplementation(async (_cwd, args) =>
      JSON.stringify(
        args[0] === 'repo'
          ? { nameWithOwner: 'team/project', url: 'https://git.example.com/team/project' }
          : args.includes('POST')
            ? { html_url: pull.html_url + '#comment' }
            : pull,
      ),
    )
  const service = new PullRequests(git)
  const input = {
    number: 7,
    headSha: pull.head.sha,
    path: 'src/a.ts',
    side: 'deletions',
    start: 2,
    end: 4,
    body: 'Keep this literal: `code`\nsecond line',
  }
  expect(await service.comment('/project', input)).toEqual({ url: pull.html_url + '#comment' })
  expect(run).toHaveBeenLastCalledWith(
    '/project',
    expect.arrayContaining([
      'git.example.com',
      'POST',
      'side=LEFT',
      'start_line=2',
      'line=4',
      `commit_id=${pull.head.sha}`,
      `body=${input.body}`,
    ]),
  )
  run.mockClear()
  await expect(service.comment('/project', { ...input, headSha: 'b'.repeat(40) })).rejects.toThrow(
    'This PR changed',
  )
  expect(run.mock.calls.some(([, args]) => args.includes('POST'))).toBe(false)
})
