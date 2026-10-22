import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, githubConnectionCheckSchema } from '@dovo/protocol'
import { fixture } from '../../../testing/fixture.js'
import { runtimeIntegration } from '../../../testing/integration.js'
import { startRuntime } from '../../../index.js'

vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function setup() {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const owner = 'github-check-owner-token-with-at-least-32-characters'
  let userStatus = 200
  let repoStatus = 200
  let actionsStatus = 200
  let login = 'work-user'
  const clientFetch = fetch
  const provider = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    expect(url.origin).toBe('https://github.example')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-fixture-token')
    if (url.pathname === '/api/v3/user')
      return Response.json(
        userStatus === 200 ? { id: 7, login } : { message: 'private-fixture-token' },
        { status: userStatus },
      )
    if (url.pathname === '/api/v3/repos/team/app/actions/runs')
      return Response.json(
        actionsStatus === 200
          ? { total_count: 0, workflow_runs: [] }
          : { message: 'private-fixture-token' },
        { status: actionsStatus },
      )
    if (url.pathname === '/api/v3/repos/team/app')
      return Response.json(
        repoStatus === 200 ? { full_name: 'team/app' } : { message: 'private-fixture-token' },
        { status: repoStatus },
      )
    throw new Error(`Unexpected provider request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', provider)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanup.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const connection = s.forges.save({
    provider: 'github',
    name: 'Work',
    baseUrl: 'https://github.example',
    credential: 'token',
    token: 'private-fixture-token',
  })
  const request = async (input: object) => {
    const response = await clientFetch(
      `http://127.0.0.1:${runtime.port}/api/scm/connections/github/read`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    return { status: response.status, body: (await response.json()) as unknown }
  }
  const check = async (input: object) => {
    const response = await request(input)
    expect(response.status).toBe(200)
    expect(JSON.stringify(response.body)).not.toContain('private-fixture-token')
    return decode(githubConnectionCheckSchema, response.body)
  }
  const bind = () =>
    s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) => ({
        ...repo,
        forge: {
          connectionId: connection.id,
          repository: 'team/app',
          revision: connection.revision,
        },
      })),
    }))
  return {
    s,
    connection,
    check,
    request,
    bind,
    provider,
    directory: f.directory,
    userStatus: (status: number) => {
      userStatus = status
    },
    actionsStatus: (status: number) => {
      actionsStatus = status
    },
    repoStatus: (status: number) => {
      repoStatus = status
    },
    login: (value: string) => {
      login = value
    },
  }
}

it('verifies a saved account without claiming repository or write access and explicitly refreshes identity', async () => {
  const f = await setup()
  const before = f.s.store.get()
  const input = { connectionId: f.connection.id }
  expect(await f.check(input)).toMatchObject({
    status: 'verified',
    stage: 'account',
    host: 'github.example',
    login: 'work-user',
  })
  await f.check(input)
  expect(f.provider).toHaveBeenCalledTimes(1)
  f.login('changed-user')
  expect(await f.check({ ...input, refresh: true })).toMatchObject({ login: 'changed-user' })
  expect(f.provider).toHaveBeenCalledTimes(2)
  expect(f.s.store.get()).toEqual(before)
  expect(f.s.forges.list()).toEqual([f.connection])
})

it('checks a bound repository separately and retains verified identity when repository access is denied', async () => {
  const f = await setup()
  f.bind()
  const input = { connectionId: f.connection.id, repositoryId: 'repo', refresh: true }
  expect(await f.check(input)).toMatchObject({
    status: 'verified',
    stage: 'actions',
    login: 'work-user',
    repository: 'team/app',
  })
  f.repoStatus(404)
  const denied = await f.check(input)
  expect(denied).toMatchObject({ status: 'failed', stage: 'repository', login: 'work-user' })
  expect(denied.message).toContain('organization SSO')
})

it('reports authentication, missing environment tokens, permission and rate-limit failures without exposing provider bodies', async () => {
  const f = await setup()
  const input = { connectionId: f.connection.id, refresh: true }
  f.userStatus(401)
  expect((await f.check(input)).message).toContain('token')
  f.userStatus(403)
  expect((await f.check(input)).message).toContain('SSO')
  f.userStatus(429)
  expect((await f.check(input)).message).toContain('rate limit')
  const environment = f.s.forges.save({
    provider: 'github',
    name: 'Environment',
    baseUrl: 'https://github.example',
    credential: 'environment',
    tokenEnv: 'DOVO_TEST_MISSING_GITHUB_TOKEN',
  })
  vi.stubEnv('DOVO_TEST_MISSING_GITHUB_TOKEN', '')
  expect((await f.check({ connectionId: environment.id })).message).toContain('token')
})

it('uses the checkout context and sole configured Enterprise credential for automatic GitHub detection', async () => {
  const f = await setup()
  await f.s.git.command(f.directory, [
    'remote',
    'add',
    'origin',
    'https://github.example/team/app.git',
  ])
  const discover = vi.spyOn(f.s.git, 'github')
  const credential = vi.spyOn(f.s.git, 'githubCredential')
  expect(await f.check({ repositoryId: 'repo', refresh: true })).toMatchObject({
    status: 'verified',
    login: 'work-user',
    host: 'github.example',
    repository: 'team/app',
  })
  expect(discover).not.toHaveBeenCalled()
  expect(credential).not.toHaveBeenCalled()
  expect(f.provider).toHaveBeenCalled()
})

it('rejects unknown sources and mismatched project bindings before contacting GitHub', async () => {
  const f = await setup()
  expect((await f.request({ repositoryId: 'missing' })).status).toBe(404)
  expect((await f.request({ connectionId: f.connection.id, repositoryId: 'repo' })).status).toBe(
    409,
  )
  f.bind()
  expect((await f.request({ repositoryId: 'repo' })).status).toBe(409)
  expect(f.provider).not.toHaveBeenCalled()
})

it('reports network and checkout discovery failures with recovery guidance', async () => {
  const f = await setup()
  f.provider.mockRejectedValueOnce(new TypeError('private-fixture-token'))
  expect((await f.check({ connectionId: f.connection.id })).message).toContain('network')
  vi.spyOn(f.s.git, 'github').mockRejectedValue(new Error('private-fixture-token'))
  const discovery = await f.check({ repositoryId: 'repo' })
  expect(discovery).toMatchObject({ status: 'failed', stage: 'discovery' })
  expect(discovery.message).toContain('Git remote')
})

it('rejects a project rebound while repository access is being checked', async () => {
  const f = await setup()
  f.bind()
  const provider = f.provider.getMockImplementation()!
  f.provider.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.includes('/repos/'))
      f.s.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((repo) => ({ ...repo, forge: undefined })),
      }))
    return provider(input, init)
  })
  expect((await f.request({ connectionId: f.connection.id, repositoryId: 'repo' })).status).toBe(
    409,
  )
})

it('does not report success if a connection changes while GitHub is responding', async () => {
  const f = await setup()
  f.provider.mockImplementationOnce(async () => {
    f.s.forges.save({ ...f.connection, name: 'Changed' })
    return Response.json({ id: 7, login: 'work-user' })
  })
  expect((await f.request({ connectionId: f.connection.id })).status).toBe(409)
})

for (const status of [403, 404, 429]) {
  it(`reports Actions access failure ${status} separately from repository access`, async () => {
    const f = await setup()
    f.bind()
    f.actionsStatus(status)
    const result = await f.check({ connectionId: f.connection.id, repositoryId: 'repo' })
    expect(result).toMatchObject({ status: 'failed', stage: 'actions', login: 'work-user' })
    expect(result.message).toContain(status === 429 ? 'rate limit' : 'Actions read access')
  })
}
