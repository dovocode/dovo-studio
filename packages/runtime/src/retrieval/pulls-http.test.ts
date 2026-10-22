import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, pullPageSchema, repositorySchema, type PullPage } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { GithubTransport } from '../scm/git/github-transport.js'
import { PullRequests } from '../scm/pulls/pulls.js'
import { runtimeIntegration } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const close of closers.splice(0).reverse()) await close()
})
const token = 'paired-pr-test-owner-token-at-least-32-characters'
async function host(role: 'server' | 'laptop', name: string) {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  closers.push(runtime.close)
  runtime.services.preferences.save({ runtimeIcon: role })
  const connection = runtime.services.forges.save({
    name: 'GitHub',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: name + '-provider-secret',
  })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      decode(repositorySchema, {
        id: 'repo',
        name: 'Project',
        path: '/fixture-' + name,
        branch: 'main',
        forge: { connectionId: connection.id, repository: 'team/app' },
      }),
    ],
  }))
  const post = (path: string, input: unknown, auth = token) =>
    fetch(`http://127.0.0.1:${runtime.port}` + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { ...runtime, post, connection }
}
async function pair(
  caller: Awaited<ReturnType<typeof host>>,
  owner: Awaited<ReturnType<typeof host>>,
) {
  const response = await caller.post('/api/retrieval/peers', {
    sessionId: 'fleet',
    peers: [
      {
        id: 'paired-server',
        name: 'Server',
        connection: {
          address: `http://127.0.0.1:${owner.port}`,
          token,
          runtimeId: owner.services.runtimeId,
        },
      },
    ],
  })
  expect(response.status).toBe(200)
  caller.services.preferences.save({ preferredRetrievalHost: owner.services.runtimeId })
}
const page: PullPage = {
  pulls: [
    {
      number: 614,
      title: 'Current PR',
      url: 'https://github.com/team/app/pull/614',
      state: 'open',
      draft: false,
      author: 'dominic',
      updatedAt: '2026-10-20',
      head: 'topic',
      base: 'main',
      labels: [],
    },
  ],
  hasMore: false,
  page: 1,
}
function authentication() {
  return vi.spyOn(GithubTransport.prototype, 'send').mockImplementation(async (request) => {
    if (request.path === 'user') return JSON.stringify({ id: 7, login: 'dominic' })
    throw Error('Unexpected provider operation: ' + request.path)
  })
}
it('does not ask a paired server with a different account to execute default PR reads', async () => {
  const transport = authentication()
  transport.mockImplementation(async (request, credential) => {
    if (request.path === 'user')
      return JSON.stringify({
        id: credential === 'server-provider-secret' ? 8 : 7,
        login: 'dominic',
      })
    throw Error('Unexpected provider operation: ' + request.path)
  })
  const list = vi.spyOn(PullRequests.prototype, 'list').mockResolvedValue(page)
  const laptop = await host('laptop', 'laptop'),
    server = await host('server', 'server')
  await pair(laptop, server)
  laptop.services.preferences.save({ preferredRetrievalHost: '' })
  const peer = vi.spyOn(server.services.pulls, 'servePeer')
  const input = { repositoryId: 'repo', state: 'open', page: 1, refresh: true }
  expect((await laptop.post('/api/scm/pulls/overview', input)).status).toBe(200)
  expect(peer).not.toHaveBeenCalled()
  expect(list).toHaveBeenCalledTimes(1)
  laptop.services.preferences.save({ preferredRetrievalHost: server.services.runtimeId })
  vi.spyOn(server.services.git, 'githubCredential').mockResolvedValue({
    host: 'github.com',
    token: 'server-provider-secret',
  })
  expect((await laptop.post('/api/scm/pulls/overview', input)).status).toBe(409)
  expect(peer).toHaveBeenCalledTimes(1)
  expect(list).toHaveBeenCalledTimes(1)
})
it('uses authenticated P2P for lists and actions, one owner cache across gateways, and invalidates after writes', async () => {
  authentication()
  const list = vi.spyOn(PullRequests.prototype, 'list').mockResolvedValue(page)
  const act = vi
    .spyOn(PullRequests.prototype, 'act')
    .mockResolvedValue({ number: 614, url: page.pulls[0]!.url, status: 'updated' })
  const laptop = await host('laptop', 'laptop'),
    other = await host('laptop', 'other'),
    server = await host('server', 'server')
  await pair(laptop, server)
  await pair(other, server)
  const receive = vi.spyOn(server.services.pulls, 'servePeer')
  const read = async (caller: typeof laptop, refresh = false) => {
    const response = await caller.post('/api/scm/pulls/overview', {
      repositoryId: 'repo',
      state: 'open',
      page: 1,
      refresh,
    })
    expect(response.status).toBe(200)
    return decode(pullPageSchema, await response.json())
  }
  const [a, b] = await Promise.all([read(laptop), read(other)])
  expect(a.pulls[0]?.number).toBe(614)
  expect(b.pulls[0]?.number).toBe(614)
  expect(a.cachedAt).toBe(b.cachedAt)
  expect(list).toHaveBeenCalledTimes(1)
  expect(receive).toHaveBeenCalledTimes(2)
  // A true refresh bypasses both the gateway and owner's caches.
  await read(laptop, true)
  expect(list).toHaveBeenCalledTimes(2)
  const identity = await laptop.services.pulls.sourceIdentity('/fixture-laptop')
  const response = await laptop.post('/api/scm/pulls/action', {
    repositoryId: 'repo',
    action: 'close',
    number: 614,
    headSha: 'a'.repeat(40),
    expectedDestination: identity.destination,
  })
  expect(response.status).toBe(200)
  expect(act).toHaveBeenCalledTimes(1)
  expect(
    receive.mock.calls.some(
      ([input]) =>
        typeof input === 'object' &&
        input !== null &&
        'operation' in input &&
        JSON.stringify(input.operation).includes('close'),
    ),
  ).toBe(true)
  await read(laptop, true)
  expect(list).toHaveBeenCalledTimes(3)
  const diagnostic = await (await laptop.post('/api/retrieval/host', {})).text()
  expect(diagnostic).not.toContain('provider-secret')
  expect((await server.post('/api/scm/pulls/peer', {}, 'wrong-token')).status).toBe(401)
})
it('checks the selected runtime and account before touching even a warmed owner cache or issuing a write', async () => {
  const transport = authentication()
  const list = vi.spyOn(PullRequests.prototype, 'list').mockResolvedValue(page)
  const act = vi.spyOn(PullRequests.prototype, 'act')
  const laptop = await host('laptop', 'laptop'),
    server = await host('server', 'server')
  await pair(laptop, server)
  const identity = await laptop.services.pulls.sourceIdentity('/fixture-laptop')
  const request = {
    owner: server.services.runtimeId,
    scope: {
      provider: 'github',
      instance: 'https://github.com',
      repository: 'team/app',
      readerIdentity: identity.readerIdentity,
    },
    operation: { kind: 'list', state: 'open', page: 1, background: false },
  }
  expect((await server.post('/api/scm/pulls/peer', request)).status).toBe(200)
  expect(
    (await server.post('/api/scm/pulls/peer', { ...request, owner: 'wrong-server' })).status,
  ).toBe(409)
  transport.mockImplementation(async () => JSON.stringify({ id: 8, login: 'someone-else' }))
  server.services.forges.save({ ...server.connection, token: 'rotated-server-secret' })
  // The fallback CLI credential also has to identify as the requested account.
  vi.spyOn(server.services.git, 'githubCredential').mockResolvedValue({
    host: 'github.com',
    token: 'other-account',
  })
  expect((await server.post('/api/scm/pulls/peer', request)).status).toBe(409)
  expect(
    (
      await server.post('/api/scm/pulls/peer', {
        ...request,
        operation: {
          kind: 'act',
          input: { action: 'close', number: 614, headSha: 'a'.repeat(40) },
        },
      })
    ).status,
  ).toBe(409)
  expect(list).toHaveBeenCalledTimes(1)
  expect(act).not.toHaveBeenCalled()
})

it('routes GitLab PRs over an HTTP pairing and uses only the owner credential for repository traffic', async () => {
  const laptop = await host('laptop', 'laptop'),
    server = await host('server', 'server')
  for (const [runtime, name] of [
    [laptop, 'laptop'],
    [server, 'server'],
  ] as const) {
    const connection = runtime.services.forges.save({
      name: 'GitLab',
      provider: 'gitlab',
      baseUrl: 'http://gitlab.example:3000',
      credential: 'token',
      token: name + '-gitlab-secret',
    })
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: [
        decode(repositorySchema, {
          id: 'repo',
          name: 'GitLab project',
          path: '/gitlab-' + name,
          branch: 'main',
          forge: { connectionId: connection.id, repository: 'team/sub/app' },
        }),
      ],
    }))
  }
  await pair(laptop, server)
  const realFetch = fetch
  const repositoryRequests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.hostname === '127.0.0.1') return realFetch(input, init)
      expect(url.origin).toBe('http://gitlab.example:3000')
      if (url.pathname.endsWith('/user')) return Response.json({ id: 7, username: 'dominic' })
      repositoryRequests.push(new Headers(init?.headers).get('authorization') ?? '')
      expect(url.pathname).toBe('/api/v4/projects/team%2Fsub%2Fapp/merge_requests')
      return Response.json([
        {
          iid: 614,
          title: 'GitLab PR',
          web_url: 'http://gitlab.example:3000/team/sub/app/-/merge_requests/614',
          state: 'opened',
          author: { id: 7, username: 'dominic' },
          labels: [],
          updated_at: '2026-10-20',
          source_branch: 'topic',
          target_branch: 'main',
          sha: 'a'.repeat(40),
          source_project_id: 1,
        },
      ])
    }),
  )
  const response = await laptop.post('/api/scm/pulls/overview', {
    repositoryId: 'repo',
    page: 1,
    state: 'open',
  })
  expect(response.status).toBe(200)
  expect(decode(pullPageSchema, await response.json()).pulls[0]?.title).toBe('GitLab PR')
  expect(repositoryRequests).toEqual(['Bearer server-gitlab-secret'])
})

it('routes details, sections, status, feedback, stacks, creation and inline comments through the same owner', async () => {
  authentication()
  const detail = {
    pull: {
      ...page.pulls[0]!,
      body: 'Body',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      repositoryUrl: 'https://github.com/team/app',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    comments: [],
    checks: [],
    files: [],
    warnings: [],
  }
  const details = vi.spyOn(PullRequests.prototype, 'detail').mockResolvedValue(detail)
  const sections = vi.spyOn(PullRequests.prototype, 'section').mockResolvedValue(detail)
  const status = vi.spyOn(PullRequests.prototype, 'status').mockResolvedValue(detail)
  const feedback = vi.spyOn(PullRequests.prototype, 'feedback').mockResolvedValue(detail)
  const stacks = vi.spyOn(PullRequests.prototype, 'nativeStack').mockResolvedValue(undefined)
  const create = vi
    .spyOn(PullRequests.prototype, 'create')
    .mockResolvedValue({ number: 614, url: page.pulls[0]!.url, status: 'created' })
  const comment = vi
    .spyOn(PullRequests.prototype, 'comment')
    .mockResolvedValue({ url: page.pulls[0]!.url + '#comment-1' })
  const laptop = await host('laptop', 'laptop'),
    server = await host('server', 'server')
  await pair(laptop, server)
  const receive = vi.spyOn(server.services.pulls, 'servePeer')
  const identity = await laptop.services.pulls.sourceIdentity('/fixture-laptop')
  const pulls = laptop.services.pulls
  const read = await pulls.detail('/fixture-laptop', 614, identity.destination)
  expect(read.destination).toBe(identity.destination)
  expect(read.pull.connectionId).toBe(laptop.connection.id)
  await pulls.section('/fixture-laptop', 614, 'overview', identity.destination)
  await pulls.status('/fixture-laptop', 614, false, identity.destination)
  await pulls.feedback('/fixture-laptop', 614, identity.destination)
  expect(await pulls.nativeStack('/fixture-laptop', 614, 7, identity.destination)).toBeUndefined()
  await pulls.create('/fixture-laptop', {
    title: 'New PR',
    body: '',
    head: 'topic',
    base: 'main',
    draft: false,
    expectedDestination: identity.destination,
  })
  await pulls.comment('/fixture-laptop', {
    number: 614,
    headSha: 'a'.repeat(40),
    path: 'app.ts',
    side: 'additions',
    start: 1,
    end: 1,
    body: 'Comment',
    expectedDestination: identity.destination,
  })
  expect(receive).toHaveBeenCalledTimes(7)
  for (const method of [details, sections, status, feedback, stacks, create, comment])
    expect(method).toHaveBeenCalledTimes(1)
})
