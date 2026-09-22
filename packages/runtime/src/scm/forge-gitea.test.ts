import { describe, expect, it } from 'vitest'
import type { ForgeConnection } from '@dovo/protocol'
import { ForgeHttp } from './forge-http.js'
import { GiteaForge } from './forge-gitea.js'

const headSha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)
const repo = {
  id: 1,
  name: 'project',
  full_name: 'team/project',
  html_url: 'https://forge.example/git/team/project',
  clone_url: 'https://forge.example/git/team/project.git',
  default_branch: 'main',
  allow_merge_commits: true,
  allow_squash_merge: true,
  allow_rebase: false,
}
const pull = {
  number: 7,
  title: 'Fix checks',
  html_url: `${repo.html_url}/pulls/7`,
  state: 'open',
  merged: false,
  draft: false,
  user: { login: 'author' },
  updated_at: '2026-09-20T10:00:00Z',
  head: { label: 'author:fix', ref: 'fix', sha: headSha, repo },
  base: { label: 'main', ref: 'main', sha: baseSha, repo },
  labels: [{ name: 'bug' }],
  body: 'Description',
  additions: 1,
  deletions: 1,
  changed_files: 1,
  mergeable: true,
  requested_reviewers: [{ login: 'dominic' }],
  requested_reviewers_teams: [{ name: 'old-team' }],
  assignees: [],
  content_version: 3,
}
const review = {
  id: 30,
  user: { login: 'reviewer' },
  body: 'Please fix',
  html_url: `${pull.html_url}#review-30`,
  submitted_at: '2026-09-20T11:00:00Z',
  state: 'REQUEST_CHANGES',
  official: true,
  comments_count: 1,
}
const inline = {
  id: 42,
  user: { login: 'reviewer' },
  body: 'This line',
  html_url: `${pull.html_url}#issuecomment-42`,
  created_at: '2026-09-20T11:00:00Z',
  path: 'src/a.ts',
  position: 1,
  original_position: 0,
  diff_hunk: '@@ -1 +1 @@\n-old\n+new',
  commit_id: headSha,
  resolver: { login: 'dominic' },
  pull_request_review_id: 30,
}
const patch =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
type Request = { path: string; method: string; body: unknown }
type Override = (request: Request) => Response | undefined
function fixture(
  provider: 'gitea' | 'forgejo' = 'gitea',
  version = '1.27.3',
  override?: Override,
  repository = 'team/project',
) {
  const connection: ForgeConnection = {
    id: 'forge',
    name: 'Forge',
    provider,
    baseUrl: 'https://forge.example/git',
    credential: 'token',
    revision: '1',
  }
  const requests: Request[] = []
  let merged = false
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  const http = new ForgeHttp(
    connection,
    () => 'token fixture-only',
    async (input, init) => {
      const url = new URL(input instanceof globalThis.Request ? input.url : String(input))
      expect(url.origin).toBe('https://forge.example')
      expect(url.pathname.startsWith('/git/api/v1/')).toBe(true)
      expect(new Headers(init?.headers).get('authorization')).toBe('token fixture-only')
      const request = {
        path: `${url.pathname.replace('/git/api/v1', '')}${url.search}`,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      }
      requests.push(request)
      const custom = override?.(request)
      if (custom) return custom
      const path = url.pathname.replace('/git/api/v1', '')
      if (request.method !== 'GET') {
        if (path.endsWith('/merge')) merged = true
        if (path.endsWith('/reviews')) return json(review)
        if (path === '/repos/team/project/pulls') return json(pull)
        return json(null)
      }
      if (path === '/version') return json({ version })
      if (path === '/user') return json({ login: 'dominic' })
      if (path === '/user/repos') return json(url.searchParams.get('page') === '1' ? [repo] : [])
      if (path === '/repos/team/project') return json(repo)
      if (path === '/repos/team/project/pulls')
        return json(url.searchParams.get('page') === '1' ? [pull] : [])
      if (path.endsWith('/pulls/7')) return json({ ...pull, merged })
      if (path.endsWith('/reviews'))
        return json(url.searchParams.get('page') === '1' ? [review] : [])
      if (path.endsWith('/reviews/30/comments')) return json([inline])
      if (path.endsWith('/issues/7/comments'))
        return json([
          {
            id: 1,
            user: null,
            body: 'Question',
            html_url: pull.html_url,
            created_at: '2026-09-20T10:30:00Z',
          },
        ])
      if (path.endsWith('/files'))
        return json(
          url.searchParams.get('page') === '1'
            ? [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 }]
            : [],
        )
      if (path.endsWith('.diff')) return new Response(patch)
      if (path.endsWith('/status'))
        return json({
          state: 'failure',
          total_count: 1,
          statuses: [
            { context: 'build', status: 'failure', target_url: `${repo.html_url}/actions/runs/2` },
          ],
        })
      throw new Error(`Unexpected fixture request: ${request.method} ${request.path}`)
    },
  )
  return { adapter: new GiteaForge(http, repository), requests }
}
const lineComment = {
  number: 7,
  headSha,
  path: 'src/a.ts',
  side: 'additions' as const,
  start: 1,
  end: 1,
  body: 'Please fix',
}
const writes = (requests: Request[]) => requests.filter((r) => r.method !== 'GET')

describe('Forgejo and Gitea', () => {
  it('discovers repositories without a binding and keeps custom server subpaths', async () => {
    const { adapter } = fixture('gitea', '1.27.3', undefined, '')
    expect(await adapter.repositories(1)).toMatchObject({
      page: 1,
      hasMore: false,
      repositories: [{ fullName: 'team/project', cloneUrl: repo.clone_url }],
    })
    await expect(adapter.repository()).rejects.toMatchObject({ status: 400 })
  })

  it('does not truncate server-capped pages and maps action-required states', async () => {
    const { adapter } = fixture('forgejo', '16.0.5', (r) =>
      r.path === '/repos/team/project/pulls?state=open&sort=recentupdate&limit=50&page=2'
        ? new Response(JSON.stringify([{ ...pull, number: 8 }]))
        : undefined,
    )
    expect(await adapter.list('open', 1)).toMatchObject({
      hasMore: true,
      pulls: [
        {
          provider: 'forgejo',
          viewerReviewRequested: true,
          checksState: 'FAILURE',
          reviewDecision: 'CHANGES_REQUESTED',
        },
      ],
    })
  })

  it('loads discussion, review outcomes, resolved code comments and file patches', async () => {
    const { adapter } = fixture()
    const detail = await adapter.detail(7)
    expect(detail.pull).toMatchObject({
      headSha,
      baseSha,
      cloneUrl: repo.clone_url,
      headRef: 'refs/pull/7/head',
      connectionId: 'forge',
      reviewers: ['dominic', 'old-team'],
    })
    expect(detail.capabilities).toMatchObject({
      inlineRange: false,
      draft: false,
      mergeMethods: ['merge', 'squash'],
    })
    expect(detail.capabilities?.actions).toEqual(expect.arrayContaining(['reply', 'resolve']))
    expect(detail.comments.map((c) => c.kind)).toEqual(['comment', 'review', 'inline'])
    expect(detail.comments[1].state).toBe('CHANGES_REQUESTED')
    expect(detail.comments[2]).toMatchObject({
      id: 'inline-42',
      threadId: '42',
      resolved: true,
      canResolve: true,
      commitId: headSha,
      line: 1,
    })
    expect(detail.comments[2].replyTo).toBeUndefined()
    expect(detail.files[0].patch).toContain('-old\n+new')
    expect(detail.fileBaseUrl).toBe(`${repo.html_url}/src/commit/${headSha}/`)
    expect(detail.warnings).toEqual([])
  })

  it('keeps repository-scoped PATs usable and reports missing optional data', async () => {
    const { adapter } = fixture('forgejo', '16.0.5', (r) =>
      ['/user', '/version'].includes(r.path) || r.path.includes('/status')
        ? new Response('', { status: 403 })
        : undefined,
    )
    const detail = await adapter.detail(7)
    expect(detail.pull.title).toBe(pull.title)
    expect(detail.capabilities?.inlineRange).toBe(false)
    expect(detail.capabilities?.actions).not.toContain('resolve')
    expect(detail.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Server version'),
        expect.stringContaining('personalized'),
        expect.stringContaining('Checks:'),
      ]),
    )
  })

  it('does not invent counts or drop readable discussion when diff fetch fails', async () => {
    const { adapter } = fixture('gitea', '1.27.3', (r) => {
      if (r.path === '/repos/team/project/pulls/7')
        return new Response(
          JSON.stringify({
            ...pull,
            additions: undefined,
            deletions: undefined,
            changed_files: undefined,
          }),
        )
      if (r.path.endsWith('.diff')) return new Response('', { status: 500 })
    })
    const detail = await adapter.detail(7)
    expect(detail.pull).toMatchObject({ additions: null, deletions: null, changedFiles: null })
    expect(detail.files[0]).toMatchObject({ path: 'src/a.ts', patch: undefined })
    expect(detail.comments).toHaveLength(3)
    expect(detail.warnings).toEqual([expect.stringContaining('Diff:')])
  })

  it('loads all check pages when the server caps the page size', async () => {
    const { adapter } = fixture('gitea', '1.27.3', (r) => {
      if (!r.path.includes('/status?')) return
      const page = new URL(r.path, 'https://fixture.test').searchParams.get('page')
      return new Response(
        JSON.stringify({
          state: 'failure',
          total_count: 2,
          statuses: [{ context: page === '1' ? 'build' : 'test', status: 'failure' }],
        }),
      )
    })
    expect((await adapter.detail(7)).checks.map((c) => c.name)).toEqual(['build', 'test'])
  })

  it('does not leave a dismissed latest review blocking the PR', async () => {
    const { adapter } = fixture('gitea', '1.27.3', (r) => {
      if (r.path.includes('/reviews?') && r.path.endsWith('page=1'))
        return new Response(
          JSON.stringify([
            review,
            { ...review, id: 31, dismissed: true, submitted_at: '2026-09-20T12:00:00Z' },
          ]),
        )
    })
    expect((await adapter.list('open', 1)).pulls[0].reviewDecision).toBeNull()
  })

  it.each([
    ['gitea', '1.27.3'],
    ['forgejo', '15.0.9'],
  ] as const)('rejects multiline comments on %s %s without a write', async (provider, version) => {
    const { adapter, requests } = fixture(provider, version)
    await expect(adapter.comment({ ...lineComment, end: 3 })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('single-line'),
    })
    expect(writes(requests)).toEqual([])
  })

  it('uses Forgejo 16 line ranges and pins the comment to the reviewed commit', async () => {
    const { adapter, requests } = fixture('forgejo', '16.0.5')
    await adapter.comment({ ...lineComment, side: 'deletions', start: 10, end: 12 })
    expect(writes(requests)).toEqual([
      {
        path: '/repos/team/project/pulls/7/reviews',
        method: 'POST',
        body: {
          event: 'COMMENT',
          commit_id: headSha,
          comments: [
            {
              body: 'Please fix',
              path: 'src/a.ts',
              old_position: 10,
              new_position: 0,
              extra_lines_count: 2,
            },
          ],
        },
      },
    ])
  })

  it('blocks stale-head comments and actions before any write', async () => {
    const { adapter, requests } = fixture()
    await expect(adapter.comment({ ...lineComment, headSha: baseSha })).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      adapter.act({ number: 7, headSha: baseSha, action: 'merge', method: 'squash' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(writes(requests)).toEqual([])
  })

  it.each([
    ['gitea', '1.25.0'],
    ['forgejo', '16.0.5'],
  ] as const)(
    'does not pretend unsupported review endpoints exist on %s %s',
    async (provider, version) => {
      const { adapter, requests } = fixture(provider, version)
      await expect(
        adapter.act({ number: 7, headSha, action: 'resolve', threadId: '42', resolved: true }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        adapter.act({ number: 7, headSha, action: 'reply', commentId: 'inline-42', body: 'Reply' }),
      ).rejects.toMatchObject({ status: 400 })
      expect(writes(requests)).toEqual([])
    },
  )

  it('resolves only a comment verified to belong to this PR and uses the explicit reply route', async () => {
    const { adapter, requests } = fixture()
    await expect(
      adapter.act({ number: 7, headSha, action: 'resolve', threadId: '999', resolved: true }),
    ).rejects.toMatchObject({ status: 400 })
    expect(writes(requests)).toEqual([])
    await adapter.act({ number: 7, headSha, action: 'resolve', threadId: '42', resolved: false })
    await adapter.act({
      number: 7,
      headSha,
      action: 'reply',
      commentId: 'inline-42',
      body: 'Fixed',
    })
    expect(writes(requests).map((r) => r.path)).toEqual([
      '/repos/team/project/pulls/comments/42/unresolve',
      '/repos/team/project/pulls/7/comments/42/replies',
    ])
  })

  it('creates PRs, edits with content-version locking and submits actual review outcomes', async () => {
    const { adapter, requests } = fixture()
    await expect(
      adapter.create({ title: 'New', body: 'Details', head: 'feature', base: 'main', draft: true }),
    ).rejects.toMatchObject({ status: 400 })
    await adapter.create({
      title: 'New',
      body: 'Details',
      head: 'feature',
      base: 'main',
      draft: false,
    })
    await adapter.act({
      number: 7,
      headSha,
      action: 'edit',
      title: 'Renamed',
      body: '',
      base: 'release',
    })
    await adapter.act({
      number: 7,
      headSha,
      action: 'review',
      event: 'request-changes',
      body: 'Needs tests',
    })
    expect(writes(requests).map((r) => r.body)).toEqual([
      { title: 'New', body: 'Details', head: 'feature', base: 'main' },
      { title: 'Renamed', body: '', base: 'release', content_version: 3 },
      { body: 'Needs tests', commit_id: headSha, event: 'REQUEST_CHANGES' },
    ])
  })

  it('adds and removes only the specified reviewers without replacing existing requests', async () => {
    const { adapter, requests } = fixture()
    await adapter.act({
      number: 7,
      headSha,
      action: 'reviewers',
      operation: 'add',
      reviewers: ['new-user'],
      teams: ['new-team'],
    })
    expect(writes(requests)).toHaveLength(1)
    await adapter.act({
      number: 7,
      headSha,
      action: 'reviewers',
      operation: 'remove',
      reviewers: ['dominic'],
      teams: [],
    })
    expect(writes(requests)).toEqual([
      {
        path: '/repos/team/project/pulls/7/requested_reviewers',
        method: 'POST',
        body: { reviewers: ['new-user'], team_reviewers: ['new-team'] },
      },
      {
        path: '/repos/team/project/pulls/7/requested_reviewers',
        method: 'DELETE',
        body: { reviewers: ['dominic'], team_reviewers: [] },
      },
    ])
  })

  it('posts discussion and closes or reopens through the correct resources', async () => {
    const { adapter, requests } = fixture()
    await adapter.act({ number: 7, headSha, action: 'comment', body: 'Looks good' })
    await adapter.act({ number: 7, headSha, action: 'close' })
    await adapter.act({ number: 7, headSha, action: 'reopen' })
    expect(writes(requests)).toEqual([
      {
        path: '/repos/team/project/issues/7/comments',
        method: 'POST',
        body: { body: 'Looks good' },
      },
      { path: '/repos/team/project/pulls/7', method: 'PATCH', body: { state: 'closed' } },
      { path: '/repos/team/project/pulls/7', method: 'PATCH', body: { state: 'open' } },
    ])
  })

  it('gates Gitea 1.26 resolve independently from 1.27 replies', async () => {
    const { adapter, requests } = fixture('gitea', '1.26.0')
    await adapter.act({ number: 7, headSha, action: 'resolve', threadId: '42', resolved: true })
    await expect(
      adapter.act({ number: 7, headSha, action: 'reply', commentId: 'inline-42', body: 'Fixed' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(writes(requests)).toHaveLength(1)
  })

  it.each([
    ['forgejo', '16.0.5', 'Do', 'MergeMessageField'],
    ['gitea', '1.25.0', 'Do', 'MergeMessageField'],
    ['gitea', '1.27.3', 'do', 'merge_message_field'],
  ] as const)(
    'uses the documented %s %s merge payload and verifies the result',
    async (provider, version, field, message) => {
      const { adapter, requests } = fixture(provider, version)
      await expect(
        adapter.act({ number: 7, headSha, action: 'merge', method: 'rebase' }),
      ).rejects.toMatchObject({ status: 400 })
      expect(
        await adapter.act({
          number: 7,
          headSha,
          action: 'merge',
          method: 'squash',
          message: 'Fix checks',
        }),
      ).toMatchObject({ status: 'merged' })
      expect(writes(requests)).toEqual([
        {
          path: '/repos/team/project/pulls/7/merge',
          method: 'POST',
          body: { [field]: 'squash', [message]: 'Fix checks', head_commit_id: headSha },
        },
      ])
    },
  )

  it('never claims a merge succeeded from an empty HTTP response alone', async () => {
    const { adapter } = fixture('gitea', '1.27.3', (r) =>
      r.path.endsWith('/merge') ? new Response(null, { status: 200 }) : undefined,
    )
    await expect(
      adapter.act({ number: 7, headSha, action: 'merge', method: 'merge' }),
    ).rejects.toMatchObject({ status: 409 })
  })
})
