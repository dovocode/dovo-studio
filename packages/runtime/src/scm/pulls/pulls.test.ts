import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GitService } from '../git/git'
import { PullRequests } from './pulls'
const pull = {
  number: 7,
  title: 'Fix runtime',
  html_url: 'https://git.example.com/team/project/pull/7',
  state: 'open',
  merged_at: null,
  draft: false,
  user: { login: 'dominic', avatar_url: 'https://git.example.com/avatars/dominic' },
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
it('loads background PR feedback without files, thread metadata, repository settings or annotations', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    if (args[0] === 'pr')
      return JSON.stringify({
        statusCheckRollup: [
          { name: 'tests', conclusion: 'FAILURE', detailsUrl: 'https://git.example.com/checks/42' },
        ],
      })
    const endpoint = args[3]
    if (endpoint.endsWith('/pulls/7')) return JSON.stringify(pull)
    if (endpoint.includes('/issues/')) return JSON.stringify([[comment]])
    if (endpoint.includes('/reviews?'))
      return JSON.stringify([
        [{ ...comment, id: 2, state: 'CHANGES_REQUESTED', submitted_at: comment.created_at }],
      ])
    if (endpoint.includes('/comments?'))
      return JSON.stringify([
        [{ ...comment, id: 3, path: 'app.ts', line: 1, original_line: 1, diff_hunk: '' }],
      ])
    if (endpoint.includes('/check-runs?'))
      return JSON.stringify([
        {
          check_runs: [
            {
              id: 42,
              name: 'tests',
              status: 'completed',
              conclusion: 'failure',
              details_url: 'https://git.example.com/checks/42',
              output: { summary: 'Failure details', annotations_count: 3 },
            },
          ],
        },
      ])
    throw new Error(`Unexpected feedback request: ${endpoint}`)
  })
  const result = await new PullRequests(git).feedback('/project/worktree', 7)
  expect(result.comments).toHaveLength(3)
  expect(result.checks).toEqual([
    {
      id: '42',
      name: 'tests',
      status: 'failure',
      url: 'https://git.example.com/checks/42',
      summary: 'Failure details',
    },
  ])
  expect(result.files).toEqual([])
  expect(result.warnings).toEqual([])
  expect(run.mock.calls.filter(([, args]) => args[0] !== 'repo')).toHaveLength(7)
  expect(
    run.mock.calls.filter(([, args]) => args[0] !== 'repo').every(([, , background]) => background),
  ).toBe(true)
})
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
  expect(page.pulls[0].authorAvatarUrl).toBe(pull.user.avatar_url)
  expect(page.pulls[1].state).toBe('closed')
  expect(run).toHaveBeenCalledWith(
    '/project/worktree',
    [
      'api',
      '--hostname',
      'git.example.com',
      'repos/team/project/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=2',
    ],
    false,
  )
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
    false,
  )
  run.mockClear()
  await expect(service.comment('/project', { ...input, headSha: 'b'.repeat(40) })).rejects.toThrow(
    'This PR changed',
  )
  expect(run.mock.calls.some(([, args]) => args.includes('POST'))).toBe(false)
})

it('opens the overview without requesting discussion, files, checks, settings or stacks', async () => {
  const git = new GitService()
  const run = vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    if (args[3] === 'repos/team/project/pulls/7') return JSON.stringify(pull)
    throw new Error(`Overview must not load ${args.join(' ')}`)
  })
  const detail = await new PullRequests(git).section('/project', 7, 'overview')
  expect(detail.pull.body).toBe('Description')
  expect(detail.warnings).toEqual([])
  expect(detail.files).toEqual([])
  expect(detail.comments).toEqual([])
  expect(detail.checks).toEqual([])
  expect(run).toHaveBeenCalledTimes(2)
})
it('loads file changes without waiting for comments, checks or merge settings', async () => {
  const git = new GitService()
  const endpoints: string[] = []
  vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    endpoints.push(args[3])
    if (args[3] === 'repos/team/project/pulls/7')
      return JSON.stringify({ ...pull, changed_files: 1 })
    if (args[3] === 'repos/team/project/pulls/7/files?per_page=100')
      return JSON.stringify([
        [
          {
            filename: 'a.ts',
            status: 'added',
            additions: 1,
            deletions: 0,
            patch: '@@ -0,0 +1 @@\n+code',
          },
        ],
      ])
    throw new Error(`Changes must not load ${args.join(' ')}`)
  })
  const detail = await new PullRequests(git).section('/project', 7, 'changes')
  expect(detail.files[0]?.path).toBe('a.ts')
  expect(detail.warnings).toEqual([])
  expect(endpoints).toEqual([
    'repos/team/project/pulls/7',
    'repos/team/project/pulls/7/files?per_page=100',
    'repos/team/project/pulls/7',
  ])
})
it('keeps a failed discussion section isolated from the overview and changes', async () => {
  const git = new GitService()
  vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    if (args[3] === 'repos/team/project/pulls/7')
      return JSON.stringify({ ...pull, changed_files: 0 })
    if (args[3]?.includes('/files?')) return '[]'
    throw new Error('Discussion permission denied')
  })
  const service = new PullRequests(git)
  const [discussion, overview, changes] = await Promise.all(
    (['discussion', 'overview', 'changes'] as const).map((section) =>
      service.section('/project', 7, section),
    ),
  )
  expect(discussion.warnings.some((w) => w.includes('Discussion permission denied'))).toBe(true)
  expect(overview.pull.body).toBe('Description')
  expect(overview.warnings).toEqual([])
  expect(changes.warnings).toEqual([])
})

it('rejects patches if a push occurs during file pagination and recovers on a fresh read', async () => {
  const git = new GitService()
  let head = pull.head.sha
  vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
    if (args[0] === 'repo')
      return JSON.stringify({
        nameWithOwner: 'team/project',
        url: 'https://git.example.com/team/project',
      })
    if (args[3] === 'repos/team/project/pulls/7')
      return JSON.stringify({ ...pull, head: { ...pull.head, sha: head }, changed_files: 0 })
    if (args[3]?.includes('/files?')) {
      head = 'c'.repeat(40)
      return '[]'
    }
    throw new Error('Unexpected request')
  })
  const service = new PullRequests(git)
  await expect(service.section('/project', 7, 'changes')).rejects.toMatchObject({ status: 409 })
  const detail = await service.section('/project', 7, 'changes')
  expect(detail.pull.headSha).toBe(head)
  expect(detail.warnings).toEqual([])
})

it.each(['checks', 'detail', 'feedback', 'monitor'] as const)(
  'rejects mixed-revision checks during %s reads and recovers on refresh',
  async (mode) => {
    const git = new GitService()
    let head = pull.head.sha
    const updatedHead = 'c'.repeat(40)
    const checkHeads: string[] = []
    vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'repo')
        return JSON.stringify({
          nameWithOwner: 'team/project',
          url: 'https://git.example.com/team/project',
        })
      if (args[0] === 'pr') {
        head = updatedHead
        return JSON.stringify({
          statusCheckRollup: [{ name: 'new-head-only', conclusion: 'SUCCESS' }],
        })
      }
      const endpoint = args[3]
      if (endpoint === 'repos/team/project/pulls/7')
        return JSON.stringify({ ...pull, head: { ...pull.head, sha: head }, changed_files: 0 })
      if (endpoint.includes('/check-runs?')) {
        checkHeads.push(endpoint)
        return JSON.stringify([{ check_runs: [] }])
      }
      if (endpoint.includes('/reviews?') || endpoint.includes('/comments?')) return '[[]]'
      if (endpoint.includes('/files?')) return '[[]]'
      throw new Error(`Unexpected request: ${args.join(' ')}`)
    })
    const service = new PullRequests(git)
    const read = () =>
      mode === 'checks'
        ? service.section('/project', 7, 'checks')
        : mode === 'feedback'
          ? service.feedback('/project', 7)
          : mode === 'monitor'
            ? service.status('/project', 7)
            : service.detail('/project', 7)
    await expect(read()).rejects.toMatchObject({ status: 409 })
    const result = await read()
    expect(result.pull.headSha).toBe(updatedHead)
    expect(result.checks).toContainEqual({ name: 'new-head-only', status: 'SUCCESS' })
    expect(checkHeads).toEqual(
      mode === 'monitor'
        ? []
        : [
            `repos/team/project/commits/${pull.head.sha}/check-runs?per_page=100`,
            `repos/team/project/commits/${updatedHead}/check-runs?per_page=100`,
          ],
    )
  },
)

it.each([false, true])(
  'fails closed when the final checks revision cannot be verified (monitor %s)',
  async (monitor) => {
    const git = new GitService()
    let pullReads = 0
    vi.spyOn(git, 'github').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'repo')
        return JSON.stringify({
          nameWithOwner: 'team/project',
          url: 'https://git.example.com/team/project',
        })
      if (args[0] === 'pr')
        return JSON.stringify({ statusCheckRollup: [{ name: 'tests', conclusion: 'SUCCESS' }] })
      if (args[3] === 'repos/team/project/pulls/7') {
        if (++pullReads > 1) throw new Error('Revision verification unavailable')
        return JSON.stringify(pull)
      }
      if (args[3].includes('/check-runs?')) return JSON.stringify([{ check_runs: [] }])
      throw new Error(`Unexpected request: ${args.join(' ')}`)
    })
    const service = new PullRequests(git)
    await expect(
      monitor ? service.status('/project', 7) : service.section('/project', 7, 'checks'),
    ).rejects.toThrow('Revision verification unavailable')
  },
)
