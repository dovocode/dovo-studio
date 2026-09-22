import { expect, it } from 'vitest'
import type { PullAction } from '@dovo/protocol'
import { ForgeHttp } from './forge-http.js'
import { AzureForge } from './forge-azure.js'

const sha = 'a'.repeat(40)
const base = 'b'.repeat(40)
const author = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Dominic' }
const reviewerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const repository = {
  id: 'repo-id',
  name: 'Studio',
  project: { id: 'project-id', name: 'Dovo' },
  webUrl: 'https://dev.azure.com/team/Dovo/_git/Studio',
  remoteUrl: 'https://team@dev.azure.com/team/Dovo/_git/Studio',
  defaultBranch: 'refs/heads/main',
}
const pull = {
  pullRequestId: 7,
  title: 'Improve review',
  description: 'PR description',
  status: 'active',
  createdBy: author,
  creationDate: '2026-09-20T07:00:00Z',
  sourceRefName: 'refs/heads/fix',
  targetRefName: 'refs/heads/main',
  repository,
  lastMergeSourceCommit: { commitId: sha },
  lastMergeTargetCommit: { commitId: base },
  reviewers: [{ ...author, vote: 5 }],
  mergeStatus: 'succeeded',
}
const iteration = {
  id: 3,
  sourceRefCommit: { commitId: sha },
  targetRefCommit: { commitId: base },
  commonRefCommit: { commitId: 'c'.repeat(40) },
  updatedDate: '2026-09-20T08:00:00Z',
}
const thread = {
  id: 20,
  status: 'fixed',
  publishedDate: '2026-09-20T08:00:00Z',
  comments: [
    {
      id: 1,
      parentCommentId: 0,
      author,
      content: 'Good fix',
      publishedDate: '2026-09-20T08:00:00Z',
      commentType: 'text',
    },
    {
      id: 2,
      parentCommentId: 1,
      author,
      content: 'Thanks',
      publishedDate: '2026-09-20T08:01:00Z',
      commentType: 'text',
    },
  ],
  threadContext: { filePath: '/a.ts', rightFileStart: { line: 1 } },
  pullRequestThreadContext: { iterationContext: { secondComparingIteration: 3 } },
}
type Call = { url: URL; method: string; body: unknown }
function fixture(
  handler?: (call: Call) => { data: unknown; status?: number } | undefined,
  name = 'Dovo/Studio',
) {
  const calls: Call[] = []
  const http = new ForgeHttp(
    {
      id: 'azure',
      name: 'Azure',
      provider: 'azure-devops',
      baseUrl: 'https://dev.azure.com/team',
      credential: 'token',
      revision: '1',
    },
    () => 'Basic fixture',
    async (input, init) => {
      const call: Call = {
        url: new URL(input instanceof Request ? input.url : input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      const selected = handler?.(call)
      let data: unknown = selected?.data
      const status = selected?.status ?? 200
      if (!selected) {
        const path = call.url.pathname
        if (call.method !== 'GET') data = path.endsWith('/threads') ? { id: 21 } : pull
        else if (path.endsWith('/pullrequests/7')) data = pull
        else if (path.endsWith('/iterations')) data = { value: [iteration] }
        else if (path.endsWith('/changes'))
          data = {
            changeEntries: [{ changeTrackingId: 12, changeType: 'edit', item: { path: '/a.ts' } }],
            nextSkip: 0,
            nextTop: 0,
          }
        else if (path.endsWith('/items'))
          data = {
            content:
              call.url.searchParams.get('versionDescriptor.version') === sha ? 'new\n' : 'old\n',
          }
        else if (path.endsWith('/threads')) data = { value: [thread] }
        else if (path.endsWith('/statuses'))
          data = {
            value: [
              {
                id: 1,
                state: 'succeeded',
                context: { name: 'Lint', genre: 'CI' },
                iterationId: 3,
                targetUrl: 'https://ci.example.com/7',
              },
              { id: 2, state: 'failed', context: { name: 'Old failure' }, iterationId: 1 },
            ],
          }
        else if (path.endsWith('/evaluations'))
          data = {
            value: [
              {
                status: 'rejected',
                configuration: { isBlocking: true, type: { displayName: 'Build validation' } },
                context: { buildId: 55 },
              },
            ],
          }
        else if (path.endsWith('/connectionData')) data = { authenticatedUser: author }
        else if (path.endsWith('/Studio')) data = repository
        else if (path.endsWith('/repositories')) data = { value: [repository] }
        else throw new Error(`Unexpected request ${call.url}`)
      }
      return new Response(status === 204 ? null : JSON.stringify(data), { status })
    },
  )
  return { forge: new AzureForge(http, name), calls }
}

it('normalizes rich Azure detail with captured merge-base diff, review votes, threads and policies', async () => {
  const { forge, calls } = fixture()
  const detail = await forge.detail(7)
  expect(new URL(detail.fileBaseUrl!).searchParams.get('version')).toBe(`GC${sha}`)
  expect(new URL(detail.fileBaseUrl!).searchParams.get('path')).toBe('/')
  expect(detail.pull).toMatchObject({
    provider: 'azure-devops',
    headSha: sha,
    baseSha: 'c'.repeat(40),
    headRef: 'refs/heads/fix',
    cloneUrl: repository.webUrl,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    viewerIsAuthor: true,
  })
  expect(detail.files[0]).toMatchObject({ path: 'a.ts', additions: 1, deletions: 1 })
  expect(detail.files[0]?.patch).toContain('+new')
  expect(detail.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: '1', threadId: '20', resolved: true, kind: 'inline', line: 1 }),
      expect.objectContaining({ id: '2', replyTo: '1' }),
      expect.objectContaining({ kind: 'review', state: 'APPROVED_WITH_SUGGESTIONS' }),
    ]),
  )
  expect(detail.checks).toEqual([
    { name: 'CI / Lint', status: 'SUCCESS', url: 'https://ci.example.com/7' },
    {
      name: 'Build validation (required)',
      status: 'FAILURE',
      url: 'https://dev.azure.com/team/Dovo/_build/results?buildId=55',
    },
  ])
  expect(
    calls
      .filter((call) => call.url.pathname.endsWith('/items'))
      .map((call) => call.url.searchParams.get('versionDescriptor.version'))
      .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
  ).toEqual([sha, 'c'.repeat(40)].sort((a, b) => a.localeCompare(b)))
  expect(
    calls
      .find((call) => call.url.pathname.endsWith('/evaluations'))
      ?.url.searchParams.get('artifactId'),
  ).toBe('vstfs:///CodeReview/CodeReviewId/project-id/7')
})

it('discovers repositories across projects without a prior repository binding', async () => {
  const { forge, calls } = fixture(undefined, '')
  expect(await forge.repositories(1)).toMatchObject({
    repositories: [{ fullName: 'Dovo/Studio', cloneUrl: repository.webUrl }],
    hasMore: false,
  })
  expect(calls[0]?.url.pathname).toBe('/team/_apis/git/repositories')
  await expect(forge.repository()).rejects.toThrow('Choose an Azure repository')
})

it('preserves unknown diff counts for binary files and optional permission failures', async () => {
  const { forge } = fixture(({ url }) =>
    url.pathname.endsWith('/items')
      ? { data: { contentMetadata: { isBinary: true } } }
      : url.pathname.endsWith('/evaluations')
        ? { data: {}, status: 403 }
        : undefined,
  )
  const detail = await forge.detail(7)
  expect(detail.pull.additions).toBeNull()
  expect(detail.pull.deletions).toBeNull()
  expect(detail.files[0]).toMatchObject({ path: 'a.ts', additions: null, deletions: null })
  expect(detail.comments.length).toBeGreaterThan(0)
  expect(detail.warnings.some((warning) => warning.includes('Binary'))).toBe(true)
  expect(
    detail.warnings.some((warning) => warning.startsWith('Checks: Policies unavailable')),
  ).toBe(true)
})

it('paginates iteration changes and retains the current iteration on inline comments', async () => {
  const { forge, calls } = fixture(({ url }) =>
    url.pathname.endsWith('/changes')
      ? {
          data:
            url.searchParams.get('$skip') === '0'
              ? {
                  changeEntries: [
                    { changeTrackingId: 1, changeType: 'add', item: { path: '/other.ts' } },
                  ],
                  nextSkip: 1,
                  nextTop: 100,
                }
              : {
                  changeEntries: [
                    { changeTrackingId: 99, changeType: 'edit', item: { path: '/a.ts' } },
                  ],
                  nextSkip: 0,
                  nextTop: 0,
                },
        }
      : undefined,
  )
  const result = await forge.comment({
    number: 7,
    headSha: sha,
    path: 'a.ts',
    side: 'additions',
    start: 2,
    end: 4,
    body: 'Please clarify',
  })
  expect(result.url).toContain('discussionId=21')
  expect(calls.at(-1)?.body).toEqual({
    comments: [{ parentCommentId: 0, content: 'Please clarify', commentType: 1 }],
    status: 1,
    threadContext: {
      filePath: '/a.ts',
      rightFileStart: { line: 2, offset: 1 },
      rightFileEnd: { line: 4, offset: 1 },
    },
    pullRequestThreadContext: {
      changeTrackingId: 99,
      iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 },
    },
  })
  expect(calls.filter((call) => call.url.pathname.endsWith('/changes'))).toHaveLength(2)
})

it('rejects stale heads and races between PR metadata and iteration snapshots without writing', async () => {
  const { forge, calls } = fixture(({ url }) =>
    url.pathname.endsWith('/iterations')
      ? { data: { value: [{ ...iteration, sourceRefCommit: { commitId: 'e'.repeat(40) } }] } }
      : undefined,
  )
  await expect(forge.act({ action: 'close', number: 7, headSha: base })).rejects.toThrow('changed')
  await expect(
    forge.comment({
      number: 7,
      headSha: sha,
      path: 'a.ts',
      side: 'additions',
      start: 1,
      end: 1,
      body: 'Comment',
    }),
  ).rejects.toThrow('changed')
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
})

it('maps Azure write operations to thread, vote, reviewer and PR APIs', async () => {
  const { forge, calls } = fixture()
  const actions: PullAction[] = [
    { action: 'comment', body: 'Discussion', number: 7, headSha: sha },
    { action: 'reply', body: 'Reply', commentId: '1', threadId: '20', number: 7, headSha: sha },
    { action: 'resolve', threadId: '20', resolved: false, number: 7, headSha: sha },
    { action: 'review', event: 'approve', body: '', number: 7, headSha: sha },
    { action: 'review', event: 'request-changes', body: 'Fix this', number: 7, headSha: sha },
    {
      action: 'edit',
      title: 'New title',
      body: 'New body',
      base: 'release',
      number: 7,
      headSha: sha,
    },
    {
      action: 'reviewers',
      operation: 'add',
      reviewers: [reviewerId],
      teams: [],
      number: 7,
      headSha: sha,
    },
    { action: 'close', number: 7, headSha: sha },
    { action: 'reopen', number: 7, headSha: sha },
  ]
  await forge.create({ title: 'New PR', body: 'Context', head: 'topic', base: 'main', draft: true })
  for (const action of actions) await forge.act(action)
  const writes = calls
    .filter((call) => call.method !== 'GET')
    .map((call) => ({
      path: call.url.pathname.split('/pullrequests')[1],
      method: call.method,
      body: call.body,
    }))
  expect(writes).toEqual([
    {
      path: '',
      method: 'POST',
      body: {
        title: 'New PR',
        description: 'Context',
        sourceRefName: 'refs/heads/topic',
        targetRefName: 'refs/heads/main',
        isDraft: true,
      },
    },
    {
      path: '/7/threads',
      method: 'POST',
      body: {
        comments: [{ parentCommentId: 0, content: 'Discussion', commentType: 1 }],
        status: 1,
      },
    },
    {
      path: '/7/threads/20/comments',
      method: 'POST',
      body: { parentCommentId: 1, content: 'Reply', commentType: 1 },
    },
    { path: '/7/threads/20', method: 'PATCH', body: { status: 'active' } },
    { path: `/7/reviewers/${author.id}`, method: 'PUT', body: { id: author.id, vote: 10 } },
    {
      path: '/7/threads',
      method: 'POST',
      body: { comments: [{ parentCommentId: 0, content: 'Fix this', commentType: 1 }], status: 1 },
    },
    { path: `/7/reviewers/${author.id}`, method: 'PUT', body: { id: author.id, vote: -10 } },
    {
      path: '/7',
      method: 'PATCH',
      body: { title: 'New title', description: 'New body', targetRefName: 'refs/heads/release' },
    },
    { path: `/7/reviewers/${reviewerId}`, method: 'PUT', body: { id: reviewerId, vote: 0 } },
    { path: '/7', method: 'PATCH', body: { status: 'abandoned' } },
    { path: '/7', method: 'PATCH', body: { status: 'active' } },
  ])
})

it('completes with the captured source commit and never bypasses policies', async () => {
  const { forge, calls } = fixture(({ method, body }) =>
    method === 'PATCH' && body && typeof body === 'object' && 'completionOptions' in body
      ? { data: { ...pull, status: 'completed' } }
      : undefined,
  )
  expect(
    await forge.act({ action: 'merge', number: 7, headSha: sha, method: 'squash' }),
  ).toMatchObject({ status: 'merged' })
  expect(calls.at(-1)?.body).toEqual({
    status: 'completed',
    lastMergeSourceCommit: { commitId: sha },
    completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: false, bypassPolicy: false },
  })
})

it('enforces Azure description limits before creation and requires thread IDs for replies', async () => {
  const { forge, calls } = fixture()
  await expect(
    forge.create({
      title: 'Title',
      body: 'x'.repeat(4001),
      head: 'fix',
      base: 'main',
      draft: false,
    }),
  ).rejects.toThrow('4,000')
  await expect(
    forge.act({ action: 'reply', commentId: '1', body: 'Reply', number: 7, headSha: sha }),
  ).rejects.toThrow('thread ID')
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
})

it('accepts Azure create responses without webUrl or merge metadata while refusing premature mutations', async () => {
  const { webUrl: _webUrl, ...shallowRepository } = repository
  const { forge, calls } = fixture(({ url }) =>
    url.pathname.includes('/pullrequests')
      ? {
          data: {
            ...pull,
            repository: shallowRepository,
            lastMergeSourceCommit: null,
            lastMergeTargetCommit: null,
            mergeStatus: 'queued',
          },
        }
      : undefined,
  )
  expect(
    await forge.create({ title: 'Title', body: '', head: 'fix', base: 'main', draft: false }),
  ).toMatchObject({ status: 'created', url: `${repository.webUrl}/pullrequest/7` })
  await expect(forge.act({ action: 'close', number: 7, headSha: sha })).rejects.toThrow(
    'still preparing',
  )
  expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(1)
})

it('reports pending Azure completion as queued and never bypasses a rejected policy', async () => {
  const { forge } = fixture(({ method }) =>
    method === 'PATCH' ? { data: { ...pull, status: 'active', mergeStatus: 'queued' } } : undefined,
  )
  expect(
    await forge.act({ action: 'merge', number: 7, headSha: sha, method: 'rebase' }),
  ).toMatchObject({ status: 'queued' })
})

it('removes only selected Azure reviewers and adding an existing reviewer preserves their vote', async () => {
  const { forge, calls } = fixture()
  await forge.act({
    action: 'reviewers',
    operation: 'add',
    reviewers: [author.id],
    teams: [],
    number: 7,
    headSha: sha,
  })
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
  await forge.act({
    action: 'reviewers',
    operation: 'remove',
    reviewers: [author.id, reviewerId],
    teams: [],
    number: 7,
    headSha: sha,
  })
  expect(
    calls
      .filter((call) => call.method !== 'GET')
      .map((call) => ({ path: call.url.pathname, method: call.method })),
  ).toEqual([
    {
      path: `/team/Dovo/_apis/git/repositories/Studio/pullrequests/7/reviewers/${author.id}`,
      method: 'DELETE',
    },
  ])
})
