import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { GithubApiError, GithubTransport } from '../scm/git/github-transport.js'
import { runtimeIntegration } from '../testing/integration.js'
vi.setConfig(runtimeIntegration)
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
})
const secret = 'retrieval-test-owner-token-at-least-32-characters'
async function host(role: 'server' | 'laptop') {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: secret, port: 0 })
  closers.push(runtime.close)
  runtime.services.preferences.save({ runtimeIcon: role })
  const post = (path: string, input: unknown, token = secret) =>
    fetch(`http://127.0.0.1:${runtime.port}` + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { ...runtime, post }
}
it('routes real authenticated HTTP reads to the server, deduplicates them and keeps mutations on the caller', async () => {
  const laptop = await host('laptop')
  const server = await host('server')
  const send = vi
    .spyOn(GithubTransport.prototype, 'send')
    .mockImplementation(async (request, token) =>
      request.path === 'user'
        ? JSON.stringify({ id: 7 })
        : JSON.stringify({ token, method: request.method }),
    )
  const serverAccount = { host: 'github.com', token: 'server-provider-token' }
  vi.spyOn(server.services.git, 'githubCredential').mockResolvedValue(serverAccount)
  const response = await laptop.post('/api/retrieval/peers', {
    sessionId: 'fleet',
    peers: [
      {
        id: 'server',
        name: 'Server',
        connection: {
          address: `http://127.0.0.1:${server.port}`,
          token: secret,
          runtimeId: server.services.runtimeId,
        },
      },
    ],
  })
  expect(response.status).toBe(200)
  const account = { host: 'github.com', token: 'laptop-provider-token' }
  const read = () =>
    laptop.services.git.githubAccount(
      ['api', 'repos/team/app/pulls'],
      undefined,
      undefined,
      account,
    )
  const results = await Promise.all([read(), read()])
  expect(results.map((result) => JSON.parse(result).token)).toEqual([
    'server-provider-token',
    'server-provider-token',
  ])
  expect(
    send.mock.calls.filter(([request]) => request.path === 'repos/team/app/pulls'),
  ).toHaveLength(1)
  expect(
    await laptop.services.git.githubAccount(
      ['api', 'repos/team/app/issues', '--method', 'POST'],
      undefined,
      undefined,
      account,
    ),
  ).toContain('laptop-provider-token')
  await read()
  expect(
    send.mock.calls.filter(([request]) => request.path === 'repos/team/app/pulls'),
  ).toHaveLength(2)
  const diagnostic = await (await laptop.post('/api/retrieval/host', {})).text()
  expect(diagnostic).not.toMatch(/provider-token|Authorization/)
  expect((await laptop.post('/api/retrieval/host', {}, 'wrong-token')).status).toBe(401)
  const reader = await laptop.services.git.retrievalReader(account)
  const mutation = await server.post('/api/retrieval/read', {
    provider: 'github',
    instance: 'github.com',
    reader,
    args: ['api', 'repos/team/app/issues', '--method', 'POST'],
  })
  expect(mutation.ok).toBe(false)
  send.mockImplementation(async () => {
    throw new GithubApiError(429, 'Rate limited')
  })
  const limited = 'repos/team/app/actions/runs'
  await expect(
    laptop.services.git.githubAccount(['api', limited], undefined, undefined, account),
  ).rejects.toMatchObject({ status: 429 })
  expect(send.mock.calls.filter(([request]) => request.path === limited)).toHaveLength(1)
})
it('rejects a different remote account before serving even a warmed cache', async () => {
  const server = await host('server')
  vi.spyOn(server.services.git, 'githubCredential').mockResolvedValue({
    host: 'github.com',
    token: 'other',
  })
  vi.spyOn(server.services.git, 'retrievalReader').mockResolvedValue('b'.repeat(64))
  const read = vi.spyOn(server.services.git, 'githubAccount')
  const request = {
    provider: 'github' as const,
    instance: 'github.com',
    reader: 'a'.repeat(64),
    args: ['api', 'repos/private/app/pulls'],
  }
  await server.services.retrieval.serve(request, async () => 'private cached response')
  const response = await server.post('/api/retrieval/read', request)
  expect(response.status).toBe(409)
  expect(await response.text()).not.toContain('private cached response')
  expect(read).not.toHaveBeenCalled()
})
