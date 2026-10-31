import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { forgeConnectionSchema, pullDetailSchema, pullPageSchema } from '@dovo/protocol'
import { fixture } from '../../../testing/fixture.js'
import { startRuntime } from '../../../index.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
async function setup(withAttributes = false) {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const owner = 'forge-routing-fixture-owner-token-with-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: owner,
    port: 0,
  })
  cleanup.push(() => runtime.close())
  const services = runtime.services
  f.workspace.repositories[0]!.path = await realpath(f.directory)
  services.store.update(() => f.workspace)
  if (withAttributes) {
    await writeFile(join(f.directory, '.gitattributes'), '*.dat binary linguist-generated\n')
    await services.git.command(f.directory, ['add', '.gitattributes'])
    await services.git.command(f.directory, ['commit', '-m', 'PR attributes'])
  }
  const sha = (await services.git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  const clientFetch = fetch
  const writes: Array<{
    path: string
    body: unknown
  }> = []
  const user = {
    uuid: '{me}',
    display_name: 'Me',
  }
  const repository = {
    uuid: '{repo}',
    name: 'Studio',
    full_name: 'team/studio',
    links: {
      html: {
        href: 'https://bitbucket.org/team/studio',
      },
    },
  }
  let title = 'Provider PR'
  let optionalFailure = false
  const current = () => ({
    id: 7,
    title,
    description: 'Reference context',
    state: 'OPEN',
    author: user,
    updated_on: '2026-09-20T08:00:00Z',
    source: {
      branch: {
        name: 'feature',
      },
      commit: {
        hash: sha,
      },
      repository,
    },
    destination: {
      branch: {
        name: 'main',
      },
      commit: {
        hash: sha,
      },
      repository,
    },
    reviewers: [],
    participants: [],
    links: {
      html: {
        href: 'https://bitbucket.org/team/studio/pull-requests/7',
      },
    },
  })
  const provider = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    expect(url.origin).toBe('https://api.bitbucket.org')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('me@example.com:fixture-private-token').toString('base64')}`,
    )
    if (init?.method !== 'GET') {
      writes.push({
        path: url.pathname,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      return Response.json({
        id: 1,
      })
    }
    if (url.pathname.endsWith('/user')) return Response.json(user)
    if (url.pathname.endsWith('/pullrequests'))
      return Response.json({
        values: [current()],
      })
    if (url.pathname.endsWith('/pullrequests/7')) return Response.json(current())
    if (url.pathname.endsWith('/studio')) return Response.json(repository)
    if (url.pathname.endsWith('/diff')) return new Response('')
    if (optionalFailure && /\/(comments|statuses)$/.test(url.pathname))
      return Response.json(
        {},
        {
          status: 403,
        },
      )
    if (url.pathname.endsWith('/comments'))
      return Response.json({
        values: [
          {
            id: 4,
            content: {
              raw: 'Cached discussion',
            },
            user,
            created_on: '2026-09-20T08:00:00Z',
          },
        ],
      })
    if (url.pathname.endsWith('/statuses'))
      return Response.json({
        values: [
          {
            key: 'test',
            name: 'Tests',
            state: 'SUCCESSFUL',
            url: 'https://ci.example.com/7',
          },
        ],
      })
    if (url.pathname.endsWith('/diffstat'))
      return Response.json({
        values: withAttributes
          ? [
              {
                new: { path: 'generated.dat' },
                status: 'modified',
                lines_added: 1,
                lines_removed: 0,
              },
            ]
          : [],
      })
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', provider)
  const request = async (path: string, body: unknown) => {
    const response = await clientFetch(`http://127.0.0.1:${runtime.port}/api/scm/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return {
      status: response.status,
      data: (await response.json()) as unknown,
    }
  }
  const saved = await request('connections/save', {
    name: 'Bitbucket',
    provider: 'bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    username: 'me@example.com',
    credential: 'token',
    token: 'fixture-private-token',
  })
  expect(saved.status).toBe(200)
  const connection = decode(forgeConnectionSchema, saved.data)
  const bound = await request('repositories/forge/bind', {
    repositoryId: 'repo',
    forge: {
      connectionId: connection.id,
      repository: 'team/studio',
    },
  })
  expect(bound.status).toBe(200)
  return {
    services,
    f,
    request,
    connection,
    sha,
    writes,
    setTitle: (value: string) => {
      title = value
    },
    failOptional: () => {
      optionalFailure = true
    },
  }
}
it('includes PR revision attributes in provider detail responses and the cached schema', async () => {
  const { request, f } = await setup(true)
  await writeFile(join(f.directory, '.gitattributes'), '*.dat diff -linguist-generated\n')
  const first = await request('pulls/detail', { repositoryId: 'repo', number: 7 })
  expect(first.status).toBe(200)
  const detail = decode(pullDetailSchema, first.data)
  expect(detail.files[0].attributes).toEqual({ binary: true, generated: true, vendored: false })
  expect(detail.warnings).toEqual([])
  const cached = await request('pulls/detail', { repositoryId: 'repo', number: 7 })
  expect(decode(pullDetailSchema, cached.data).files[0].attributes).toEqual(
    detail.files[0].attributes,
  )
})
it('routes a bound provider through HTTP, keeps credentials private, invalidates account caches and rejects stale mutations', async () => {
  const { services, request, connection, sha, writes, setTitle } = await setup()
  const listed = await request('pulls/overview', {
    repositoryId: 'repo',
    state: 'open',
  })
  expect(listed.status).toBe(200)
  expect(decode(pullPageSchema, listed.data).pulls[0]).toMatchObject({
    provider: 'bitbucket',
    title: 'Provider PR',
    viewerIsAuthor: true,
  })
  const first = await request('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
  })
  expect(decode(pullDetailSchema, first.data).pull.connectionId).toBe(connection.id)
  const action = await request('pulls/action', {
    repositoryId: 'repo',
    number: 7,
    headSha: sha,
    action: 'comment',
    body: 'A useful comment',
  })
  expect(action.status).toBe(200)
  expect(writes).toEqual([
    {
      path: '/2.0/repositories/team/studio/pullrequests/7/comments',
      body: {
        content: {
          raw: 'A useful comment',
        },
      },
    },
  ])
  const stale = await request('pulls/action', {
    repositoryId: 'repo',
    number: 7,
    headSha: 'f'.repeat(40),
    action: 'close',
  })
  expect(stale.status).toBe(409)
  expect(writes).toHaveLength(1)
  setTitle('Updated account result')
  const edited = await request('connections/save', {
    ...connection,
    name: 'Renamed account',
  })
  expect(edited.status).toBe(200)
  const refreshed = await request('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
  })
  expect(decode(pullDetailSchema, refreshed.data).pull.title).toBe('Updated account result')
  expect(JSON.stringify((await request('connections/read', {})).data)).not.toContain(
    'fixture-private-token',
  )
  expect(JSON.stringify(services.store.get())).not.toContain('fixture-private-token')
  expect(JSON.stringify(services.db.prepare('SELECT value FROM pull_cache').all())).not.toContain(
    'fixture-private-token',
  )
})
it('preserves provider checkout metadata through task creation and an isolated worktree', async () => {
  const { services, request, connection, sha, f } = await setup()
  const fetchHead = vi
    .spyOn(services.git, 'fetchPull')
    .mockImplementation(async (cwd, _repository, _number, ref) => {
      await services.git.command(cwd, ['update-ref', ref, sha])
    })
  const created = await request('pulls/task', {
    repositoryId: 'repo',
    number: 7,
    headSha: sha,
    agentId: 'agent',
    objective: 'Review the provider PR',
    run: false,
  })
  expect(created.status).toBe(200)
  const id = decode(
    mutableStruct({
      id: Schema.String,
    }),
    created.data,
  ).id
  expect(services.store.task(id).pullRequest).toMatchObject({
    provider: 'bitbucket',
    connectionId: connection.id,
    cloneUrl: 'https://bitbucket.org/team/studio.git',
    headRef: 'refs/heads/feature',
    headSha: sha,
  })
  const directory = await services.checkouts.directory(id)
  cleanup.push(() =>
    rm(directory, {
      recursive: true,
      force: true,
    }),
  )
  expect(directory).not.toBe(f.directory)
  expect((await services.git.command(directory, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
  expect(fetchHead).toHaveBeenCalledWith(
    await realpath(f.directory),
    'https://bitbucket.org/team/studio',
    7,
    expect.stringMatching(/^refs\/dovo\/pull-tasks\//),
    expect.objectContaining({
      provider: 'bitbucket',
      connectionId: connection.id,
      headRef: 'refs/heads/feature',
    }),
    expect.any(AbortSignal),
  )
  expect(await services.pulls.identity(directory)).toMatch(/^[a-f0-9]{64}$/)
})
it('rejects an adapter captured before connection rotation without sending the new credential to the old host', async () => {
  const { services, connection } = await setup()
  const captured = services.pulls.adapter(connection.id, 'team/studio')
  services.forges.save({
    ...connection,
    provider: 'azure-devops',
    baseUrl: 'https://dev.azure.com/other-organization',
    username: undefined,
    token: 'rotated-private-token',
  })
  const count = vi.mocked(fetch).mock.calls.length
  await expect(captured.repository()).rejects.toMatchObject({
    status: 409,
  })
  expect(vi.mocked(fetch).mock.calls).toHaveLength(count)
})
it('retains cached same-head discussions and checks when optional provider reads temporarily fail', async () => {
  const { request, failOptional } = await setup()
  await request('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
  })
  failOptional()
  const result = await request('pulls/detail', {
    repositoryId: 'repo',
    number: 7,
    refresh: true,
  })
  expect(result.status).toBe(200)
  const detail = decode(pullDetailSchema, result.data)
  expect(detail.comments).toEqual([
    expect.objectContaining({
      body: 'Cached discussion',
    }),
  ])
  expect(detail.checks).toEqual([
    expect.objectContaining({
      name: 'Tests',
      status: 'SUCCESS',
    }),
  ])
  expect(detail.warnings).toContain('Unavailable sections are showing the last cached data.')
})
it('opens unlinked GitHub PRs using URL targets without adding a project, with cached reads and guarded actions', async () => {
  const { services, request } = await setup()
  const first = decode(
    pullDetailSchema,
    (await request('pulls/detail', { repositoryId: 'repo', number: 7 })).data,
  )
  const url = 'https://github.com/foreign/project/pull/7'
  const detail = {
    ...first,
    destination: 'account',
    pull: {
      ...first.pull,
      destination: 'account',
      url,
      repositoryUrl: 'https://github.com/foreign/project',
      provider: 'github' as const,
    },
  }
  type UrlTarget = ReturnType<typeof services.pulls.urlTarget>
  const read = vi.fn<UrlTarget['detail']>().mockResolvedValue(detail)
  const act = vi.fn<UrlTarget['act']>().mockResolvedValue({ number: 7, url, status: 'submitted' })
  vi.spyOn(services.pulls, 'urlTarget').mockReturnValue({
    cwd: '/unused',
    sourceContext: vi.fn<UrlTarget['sourceContext']>(),
    feedback: read,
    identity: async () => 'account',
    sourceIdentity: async () => ({ readerIdentity: 'reader', destination: 'account' }),
    guard: async () => {},
    detail: read,
    status: vi.fn<UrlTarget['status']>().mockResolvedValue(detail),
    section: vi.fn<UrlTarget['section']>().mockResolvedValue(detail),
    act,
    comment: async () => ({ url }),
  })
  const before = services.store.get().repositories
  expect((await request('pulls/detail', { repositoryId: url, number: 7 })).status).toBe(200)
  expect((await request('pulls/detail', { repositoryId: url, number: 7 })).status).toBe(200)
  expect(read).toHaveBeenCalledTimes(1)
  expect((await request('pulls/detail', { repositoryId: url, number: 8 })).status).toBe(400)
  expect(
    (await request('pulls/detail', { repositoryId: url, number: 7, taskId: 'task' })).status,
  ).toBe(400)
  expect((await request('pulls/task', { repositoryId: url, number: 7 })).status).toBe(400)
  expect(
    (
      await request('pulls/action', {
        repositoryId: url,
        number: 7,
        action: 'comment',
        headSha: detail.pull.headSha,
        body: 'Hello',
      })
    ).status,
  ).toBe(200)
  expect(act).toHaveBeenCalledTimes(1)
  await request('pulls/detail', { repositoryId: url, number: 7, refresh: true })
  expect(read).toHaveBeenCalledTimes(2)
  expect(services.store.get().repositories).toEqual(before)
})
it.each(['origin', 'upstream'])(
  'routes an unbound %s remote through its sole configured provider without GitHub discovery',
  async (remote) => {
    const { services: s, f } = await setup()
    await s.git.command(f.directory, [
      'remote',
      'add',
      remote,
      'https://bitbucket.org/team/studio.git',
    ])
    s.store.update((value) => ({
      ...value,
      repositories: value.repositories.map((repo) => ({ ...repo, forge: undefined })),
    }))
    const github = vi.spyOn(s.git, 'github')
    const scope = await s.pulls.sourceContext(f.directory)
    expect(scope.provider).toBe('bitbucket')
    expect(scope.repository).toBe('team/studio')
    expect(github).not.toHaveBeenCalled()
  },
)
it('keeps unbound repositories without remotes as empty issue and pipeline sources', async () => {
  const { services: s } = await setup()
  s.store.update((value) => ({
    ...value,
    repositories: value.repositories.map((repo) => ({ ...repo, forge: undefined })),
  }))
  const github = vi.spyOn(s.git, 'github')
  await expect(s.forgeWork.request('repo', 'options', {})).resolves.toMatchObject({
    issues: false,
    pipelines: false,
  })
  await expect(s.forgeWork.request('repo', 'issues/list', {})).resolves.toEqual({ items: [] })
  await expect(s.forgeWork.request('repo', 'pipelines/list', {})).resolves.toEqual({ items: [] })
  expect(github).not.toHaveBeenCalled()
})
it('requires a binding when multiple remotes have no origin', async () => {
  const { services: s, f } = await setup()
  await s.git.command(f.directory, [
    'remote',
    'add',
    'upstream',
    'https://bitbucket.org/team/studio.git',
  ])
  await s.git.command(f.directory, ['remote', 'add', 'fork', 'https://github.com/me/studio.git'])
  s.store.update((value) => ({
    ...value,
    repositories: value.repositories.map((repo) => ({ ...repo, forge: undefined })),
  }))
  const github = vi.spyOn(s.git, 'github')
  await expect(s.pulls.sourceContext(f.directory)).rejects.toThrow(
    'Multiple source control remotes',
  )
  expect(github).not.toHaveBeenCalled()
})
it('asks for a provider binding on unknown private hosts instead of attempting GitHub authentication', async () => {
  const { services: s, f } = await setup()
  await s.git.command(f.directory, [
    'remote',
    'add',
    'origin',
    'http://git.internal.example/team/studio.git',
  ])
  s.store.update((value) => ({
    ...value,
    repositories: value.repositories.map((repo) => ({ ...repo, forge: undefined })),
  }))
  const github = vi.spyOn(s.git, 'github')
  await expect(s.pulls.sourceContext(f.directory)).rejects.toThrow('source control provider')
  expect(github).not.toHaveBeenCalled()
})
