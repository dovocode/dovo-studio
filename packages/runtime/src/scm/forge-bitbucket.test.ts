import { expect, it } from 'vitest'
import type { PullAction } from '@dovo/protocol'
import { ForgeHttp } from './forge-http.js'
import { BitbucketForge } from './forge-bitbucket.js'

const sha = 'a'.repeat(40)
const user = { uuid: '{author}', display_name: 'Dominic' }
const repository = {
  uuid: '{repo}',
  name: 'Studio',
  full_name: 'team/studio',
  mainbranch: { name: 'main' },
  links: {
    html: { href: 'https://bitbucket.org/team/studio' },
    clone: [
      { name: 'ssh', href: 'git@bitbucket.org:team/studio.git' },
      { name: 'https', href: 'https://dominic@bitbucket.org/team/studio.git' },
    ],
  },
}
const pull = {
  id: 7,
  title: 'Improve review',
  description: 'PR description',
  state: 'OPEN',
  author: user,
  updated_on: '2026-09-20T08:00:00Z',
  source: { branch: { name: 'fix' }, commit: { hash: sha }, repository },
  destination: { branch: { name: 'main' }, commit: { hash: 'b'.repeat(40) }, repository },
  reviewers: [user],
  participants: [{ user, approved: true, participated_on: '2026-09-20T07:00:00Z' }],
  links: { html: { href: 'https://bitbucket.org/team/studio/pull-requests/7' } },
}
const comment = {
  id: 9,
  content: { raw: 'Please clarify' },
  user,
  created_on: '2026-09-20T07:00:00Z',
  inline: { path: 'a.ts', to: 1, from: null },
  resolution: { user },
}
const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
type Call = { url: URL; method: string; body: unknown }
function fixture(
  handler?: (call: Call) => { data: unknown; status?: number } | undefined,
  name = 'team/studio',
) {
  const calls: Call[] = []
  const http = new ForgeHttp(
    {
      id: 'bb',
      name: 'Bitbucket',
      provider: 'bitbucket',
      baseUrl: 'https://api.bitbucket.org/2.0',
      credential: 'token',
      username: 'dominic@example.com',
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
        if (call.method !== 'GET') data = call.url.pathname.endsWith('/comments') ? comment : pull
        else if (call.url.pathname.endsWith('/user')) data = user
        else if (call.url.pathname.endsWith('/pullrequests/7')) data = pull
        else if (call.url.pathname.endsWith('/comments')) data = { values: [comment] }
        else if (call.url.pathname.endsWith('/statuses'))
          data = {
            values: [
              { key: 'test', name: 'Tests', state: 'SUCCESSFUL', url: 'https://ci.example.com/7' },
            ],
          }
        else if (call.url.pathname.endsWith('/diffstat'))
          data = {
            values: [
              {
                status: 'modified',
                lines_added: 1,
                lines_removed: 1,
                old: { path: 'a.ts' },
                new: { path: 'a.ts' },
              },
            ],
          }
        else if (call.url.pathname.endsWith('/diff')) data = diff
        else if (call.url.pathname.endsWith('/studio')) data = repository
        else throw new Error(`Unexpected request ${call.url}`)
      }
      return new Response(
        status === 204 ? null : typeof data === 'string' ? data : JSON.stringify(data),
        { status },
      )
    },
  )
  return { forge: new BitbucketForge(http, name), calls }
}

it('discovers repositories through the current workspace API, not the retired global API', async () => {
  const { forge, calls } = fixture(({ url }) => {
    if (url.pathname.endsWith('/user/workspaces'))
      return { data: { values: [{ workspace: { slug: 'team' } }] } }
    if (url.pathname.endsWith('/repositories/team')) return { data: { values: [repository] } }
  }, '')
  expect(await forge.repositories(1)).toMatchObject({
    repositories: [{ fullName: 'team/studio' }],
    hasMore: false,
  })
  expect(calls.map((call) => call.url.pathname)).toEqual([
    '/2.0/user/workspaces',
    '/2.0/repositories/team',
  ])
  await expect(forge.repository()).rejects.toThrow('Choose a Bitbucket repository')
})

it('normalizes Bitbucket repository, rich PR details and checkout identity without clone credentials', async () => {
  const { forge } = fixture()
  expect(await forge.repository()).toMatchObject({
    id: '{repo}',
    fullName: 'team/studio',
    cloneUrl: 'https://bitbucket.org/team/studio.git',
    defaultBranch: 'main',
  })
  const detail = await forge.detail(7)
  expect(detail.pull).toMatchObject({
    provider: 'bitbucket',
    headSha: sha,
    headRef: 'refs/heads/fix',
    cloneUrl: 'https://bitbucket.org/team/studio.git',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
  })
  expect(detail.fileBaseUrl).toBe(`https://bitbucket.org/team/studio/src/${sha}/`)
  expect(detail.comments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: '9', kind: 'inline', threadId: '9', resolved: true, line: 1 }),
      expect.objectContaining({ kind: 'review', state: 'APPROVED' }),
    ]),
  )
  expect(detail.checks).toEqual([
    { name: 'Tests', status: 'SUCCESS', url: 'https://ci.example.com/7' },
  ])
  expect(detail.files[0]?.patch).toContain('+new')
  expect(detail.capabilities?.actions).not.toContain('reopen')
})

it('follows opaque next URLs and does not invent page URLs', async () => {
  const { forge, calls } = fixture(({ url }) =>
    url.pathname.endsWith('/pullrequests')
      ? {
          data: url.searchParams.has('cursor')
            ? { values: [{ ...pull, id: 8, state: 'MERGED' }] }
            : {
                values: [pull],
                next: 'https://api.bitbucket.org/2.0/repositories/team/studio/pullrequests?cursor=opaque',
              },
        }
      : undefined,
  )
  const result = await forge.list('closed', 2)
  expect(result).toMatchObject({ page: 2, hasMore: false, pulls: [{ number: 8, state: 'merged' }] })
  expect(calls.find((call) => call.url.searchParams.has('cursor'))?.url.search).toBe(
    '?cursor=opaque',
  )
  expect(calls[0]?.url.searchParams.getAll('state')).toEqual(['MERGED', 'DECLINED', 'SUPERSEDED'])
})

it('rejects hostile pagination links without sending credentials', async () => {
  const { forge, calls } = fixture(({ url }) =>
    url.pathname.endsWith('/pullrequests')
      ? { data: { values: [pull], next: 'https://attacker.example/pulls' } }
      : undefined,
  )
  await expect(forge.list('open', 2)).rejects.toThrow('unsafe API URL')
  expect(calls.every((call) => call.url.hostname === 'api.bitbucket.org')).toBe(true)
  expect(calls.filter((call) => call.url.pathname.endsWith('/pullrequests'))).toHaveLength(1)
})

it('keeps useful detail and unknown counts when optional data fails', async () => {
  const { forge } = fixture(({ url }) =>
    /\/(diff|diffstat|statuses)$/.test(url.pathname) ? { data: {}, status: 403 } : undefined,
  )
  const result = await forge.detail(7)
  expect(result.pull.additions).toBeNull()
  expect(result.pull.deletions).toBeNull()
  expect(result.comments.length).toBeGreaterThan(0)
  expect(result.warnings).toHaveLength(3)
})

it('never mutates after a stale head or unsupported action', async () => {
  const { forge, calls } = fixture()
  await expect(forge.act({ action: 'close', number: 7, headSha: 'c'.repeat(40) })).rejects.toThrow(
    'changed',
  )
  await expect(forge.act({ action: 'reopen', number: 7, headSha: sha })).rejects.toThrow(
    'does not support',
  )
  await expect(
    forge.act({ action: 'merge', number: 7, headSha: sha, method: 'rebase' }),
  ).rejects.toThrow('rebase')
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
})

it('creates inline comments with the correct old/new line anchor and rejects unsupported ranges', async () => {
  const { forge, calls } = fixture()
  const input = {
    number: 7,
    headSha: sha,
    path: 'a.ts',
    side: 'deletions' as const,
    start: 2,
    end: 2,
    body: 'Old line',
  }
  await forge.comment(input)
  expect(calls.at(-1)?.body).toEqual({
    content: { raw: 'Old line' },
    inline: { path: 'a.ts', from: 2 },
  })
  await expect(forge.comment({ ...input, end: 3 })).rejects.toThrow('single-line')
})

it('maps every supported Bitbucket write family to its documented method and body', async () => {
  const { forge, calls } = fixture()
  const actions: PullAction[] = [
    { action: 'comment', body: 'Discussion', number: 7, headSha: sha },
    { action: 'reply', body: 'Reply', commentId: '9', number: 7, headSha: sha },
    { action: 'resolve', threadId: '9', resolved: false, number: 7, headSha: sha },
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
      reviewers: ['{reviewer}'],
      teams: [],
      number: 7,
      headSha: sha,
    },
    { action: 'close', number: 7, headSha: sha },
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
        source: { branch: { name: 'topic' } },
        destination: { branch: { name: 'main' } },
        draft: true,
      },
    },
    { path: '/7/comments', method: 'POST', body: { content: { raw: 'Discussion' } } },
    { path: '/7/comments', method: 'POST', body: { content: { raw: 'Reply' }, parent: { id: 9 } } },
    { path: '/7/comments/9/resolve', method: 'DELETE', body: undefined },
    { path: '/7/comments', method: 'POST', body: { content: { raw: 'Fix this' } } },
    { path: '/7/request-changes', method: 'POST', body: undefined },
    {
      path: '/7',
      method: 'PUT',
      body: {
        title: 'New title',
        description: 'New body',
        destination: { branch: { name: 'release' } },
      },
    },
    {
      path: '/7',
      method: 'PUT',
      body: { reviewers: [{ uuid: '{author}' }, { uuid: '{reviewer}' }] },
    },
    { path: '/7/decline', method: 'POST', body: undefined },
  ])
})

it('reports a 202 merge as queued, never as merged', async () => {
  const { forge } = fixture(({ url, method }) =>
    method === 'POST' && url.pathname.endsWith('/merge')
      ? { data: { task_id: 'queued-task' }, status: 202 }
      : undefined,
  )
  expect(
    await forge.act({ action: 'merge', number: 7, headSha: sha, method: 'squash' }),
  ).toMatchObject({ status: 'queued', number: 7 })
})

it('removes only the selected Bitbucket reviewers and preserves everyone omitted', async () => {
  const { forge, calls } = fixture(({ url, method }) =>
    method === 'GET' && url.pathname.endsWith('/pullrequests/7')
      ? {
          data: { ...pull, reviewers: [user, { uuid: '{other}', display_name: 'Other reviewer' }] },
        }
      : undefined,
  )
  await forge.act({
    action: 'reviewers',
    operation: 'remove',
    reviewers: [user.uuid],
    teams: [],
    number: 7,
    headSha: sha,
  })
  expect(calls.at(-1)?.body).toEqual({ reviewers: [{ uuid: '{other}' }] })
})
