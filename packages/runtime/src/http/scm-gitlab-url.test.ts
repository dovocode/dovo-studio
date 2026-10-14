import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, forgeSourceIdentitySchema, pullDetailSchema } from '@dovo/protocol'
import { startRuntime } from '../index'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
})

it('opens an unlinked public GitLab MR through its chosen account and guards subsequent writes', async () => {
  const owner = 'gitlab-url-fixture-owner-token-with-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanup.push(() => runtime.close())
  const connection = runtime.services.forges.save({
    name: 'GitLab',
    provider: 'gitlab',
    baseUrl: 'https://gitlab.com',
    credential: 'token',
    token: 'fixture-private-token',
  })
  const clientFetch = fetch
  const sha = 'a'.repeat(40)
  const url = 'https://gitlab.com/team/sub/app/-/merge_requests/42'
  const projectPath = '/api/v4/projects/team%2Fsub%2Fapp'
  const writes: string[] = []
  let accountId = 7
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input))
      expect(target.origin).toBe('https://gitlab.com')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-private-token')
      if (init?.method !== 'GET') writes.push(target.pathname)
      if (target.pathname === '/api/v4/user')
        return Response.json({ id: accountId, username: 'viewer' })
      if (target.pathname === projectPath)
        return Response.json({
          id: 99,
          name: 'App',
          path_with_namespace: 'team/sub/app',
          web_url: 'https://gitlab.com/team/sub/app',
          http_url_to_repo: 'https://gitlab.com/team/sub/app.git',
          default_branch: 'main',
        })
      if (target.pathname.endsWith('/notes') || target.pathname.endsWith('/diffs'))
        return Response.json([])
      expect(target.pathname).toBe(`${projectPath}/merge_requests/42`)
      return Response.json({
        iid: 42,
        title: 'Change',
        description: 'Body',
        web_url: url,
        state: 'opened',
        author: { id: 7, username: 'viewer' },
        labels: [],
        updated_at: '',
        source_branch: 'topic',
        target_branch: 'main',
        sha,
        source_project_id: 99,
        diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: sha },
      })
    }),
  )
  const call = async (path: string, input: Record<string, unknown>) => {
    const response = await clientFetch(`http://127.0.0.1:${runtime.port}/api/scm/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, data: (await response.json()) as unknown }
  }
  const source = decode(
    forgeSourceIdentitySchema,
    (await call('source/identity', { repositoryId: url })).data,
  )
  const detail = await call('pulls/detail', {
    repositoryId: url,
    number: 42,
    expectedReaderIdentity: source.readerIdentity,
  })
  expect(detail.status).toBe(200)
  expect(decode(pullDetailSchema, detail.data)).toMatchObject({
    destination: source.destination,
    pull: { number: 42, provider: 'gitlab', connectionId: connection.id },
  })
  runtime.services.forges.save({
    ...connection,
    name: 'Other account',
    token: 'fixture-private-token',
  })
  accountId = 8
  const rejected = await call('pulls/action', {
    repositoryId: url,
    connectionId: connection.id,
    number: 42,
    action: 'close',
    headSha: sha,
    expectedDestination: source.destination,
  })
  expect(rejected.status).toBe(409)
  expect(writes).toEqual([])
  const current = decode(
    forgeSourceIdentitySchema,
    (await call('source/identity', { repositoryId: url, connectionId: connection.id })).data,
  )
  expect(
    (
      await call('pulls/action', {
        repositoryId: url,
        connectionId: connection.id,
        number: 42,
        action: 'close',
        headSha: sha,
        expectedDestination: current.destination,
      })
    ).status,
  ).toBe(200)
  expect(writes).toEqual([`${projectPath}/merge_requests/42`])
})
