import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { Effect, Fiber } from 'effect'
import { startRuntime } from '../../index.js'
import { RuntimeServices } from '../../services.js'
import { acpRoute } from './acp-routes.js'
import * as acp from '../../agents/providers/acp/acp-connection.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function setup() {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const call = (path: string, input: unknown = {}, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/agents/acp/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const installations = [
    {
      id: 'first',
      registryId: 'first',
      name: 'First agent',
      version: '1.0.0',
      distribution: 'npx' as const,
      installedAt: new Date().toISOString(),
    },
  ]
  vi.spyOn(runtime.services.acpInstallations, 'list').mockReturnValue(installations)
  vi.spyOn(runtime.services.acpInstallations, 'launch').mockReturnValue({
    command: '/managed/agent',
    args: ['--acp'],
    env: { BASE: 'base', OVERRIDE: 'old' },
  })
  return { runtime, call, installations }
}
it('requires pairing credentials even on HTTP and does not expose auth launch secrets', async () => {
  const { call } = await setup()
  const inspect = vi.spyOn(acp, 'inspectAcp').mockResolvedValue({
    agentInfo: undefined,
    canLogout: false,
    authMethods: [
      {
        type: 'terminal',
        id: 'login',
        name: 'Sign in',
        args: ['secret-arg'],
        env: { TOKEN: 'private-token' },
      },
    ],
  })
  expect((await call('inspect', { id: 'first' }, 'invalid')).status).toBe(401)
  expect(inspect).not.toHaveBeenCalled()
  const response = await call('inspect', { id: 'first' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    canLogout: false,
    authMethods: [{ id: 'login', name: 'Sign in', type: 'terminal' }],
  })
})
it('runs terminal auth with appended args and merged env instead of calling authenticate', async () => {
  const { runtime, call } = await setup()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue({
    agentInfo: undefined,
    canLogout: false,
    authMethods: [
      { type: 'terminal', id: 'login', name: 'Sign in', args: ['login'], env: { OVERRIDE: 'new' } },
    ],
  })
  const authenticate = vi.spyOn(acp, 'authenticateAcp').mockResolvedValue()
  const terminal = { id: 'terminal', taskId: 'acp:first', title: 'Sign in', exited: false }
  const create = vi.spyOn(runtime.services.terminals, 'createCommand').mockReturnValue(terminal)
  const response = await call('authenticate', { id: 'first', methodId: 'login' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, terminal })
  expect(create).toHaveBeenCalledWith(
    'acp:first',
    homedir(),
    { command: '/managed/agent', args: ['--acp', 'login'], env: { BASE: 'base', OVERRIDE: 'new' } },
    'First agent · Sign in',
  )
  expect(authenticate).not.toHaveBeenCalled()
  vi.spyOn(runtime.services.terminals, 'list').mockReturnValue([terminal])
  expect(await (await call('inspect', { id: 'first' })).json()).toEqual({
    authMethods: [],
    canLogout: false,
    terminal,
  })
  expect((await call('authenticate', { id: 'first', methodId: 'login' })).status).toBe(409)
  expect((await call('remove', { id: 'first' })).status).toBe(409)
})
it('prevents uninstall of saved profiles and authenticates agent methods through ACP', async () => {
  const { runtime, call } = await setup()
  runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: [
      {
        id: 'profile',
        name: 'My agent',
        provider: 'acp',
        acpInstallationId: 'first',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
      },
    ],
  }))
  const remove = vi.spyOn(runtime.services.acpInstallations, 'remove').mockResolvedValue()
  expect((await call('remove', { id: 'first' })).status).toBe(409)
  expect(remove).not.toHaveBeenCalled()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue({
    agentInfo: undefined,
    canLogout: false,
    authMethods: [{ id: 'browser', name: 'Browser' }],
  })
  const authenticate = vi.spyOn(acp, 'authenticateAcp').mockResolvedValue()
  expect((await call('authenticate', { id: 'first', methodId: 'browser' })).status).toBe(200)
  expect(authenticate).toHaveBeenCalledWith(
    expect.objectContaining({ command: '/managed/agent' }),
    'browser',
    expect.any(AbortSignal),
  )
  expect((await call('authenticate', { id: 'first', methodId: 'missing' })).status).toBe(400)
})
it('returns paginated agent sessions and only deletes an explicitly selected session', async () => {
  const { call } = await setup()
  const list = vi.spyOn(acp, 'listAcpSessions').mockResolvedValue({
    sessions: [{ sessionId: 's1', cwd: '/workspace', title: 'Earlier work' }],
    nextCursor: 'next',
    canDelete: true,
  })
  const remove = vi.spyOn(acp, 'deleteAcpSession').mockResolvedValue()
  const response = await call('sessions', { id: 'first', cursor: 'page2' })
  expect(await response.json()).toEqual({
    sessions: [{ sessionId: 's1', cwd: '/workspace', title: 'Earlier work' }],
    nextCursor: 'next',
    canDelete: true,
  })
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ command: '/managed/agent' }),
    { cursor: 'page2' },
    expect.any(AbortSignal),
  )
  expect(remove).not.toHaveBeenCalled()
  expect((await call('sessions/delete', { id: 'first', sessionId: 's1' })).status).toBe(200)
  expect(remove).toHaveBeenCalledWith(
    expect.objectContaining({ command: '/managed/agent' }),
    's1',
    expect.any(AbortSignal),
  )
})
const browserAuth = {
  agentInfo: undefined,
  canLogout: false,
  authMethods: [{ id: 'browser', name: 'Browser' }],
}
it('releases the authentication lock when ACP authentication fails', async () => {
  const { call } = await setup()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  const authenticate = vi
    .spyOn(acp, 'authenticateAcp')
    .mockRejectedValueOnce(new Error('login failed'))
    .mockResolvedValueOnce()
  expect((await call('authenticate', { id: 'first', methodId: 'browser' })).status).toBe(500)
  expect((await call('authenticate', { id: 'first', methodId: 'browser' })).status).toBe(200)
  expect(authenticate).toHaveBeenCalledTimes(2)
})
it('releases the authentication lock when ACP authentication is interrupted', async () => {
  const { runtime, call } = await setup()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  let finish = () => {}
  const hanging = new Promise<void>((resolve) => {
    finish = resolve
  })
  let started = () => {}
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(acp, 'authenticateAcp').mockImplementation(() => {
    started()
    return hanging
  })
  const request = Readable.from([
    Buffer.from(JSON.stringify({ id: 'first', methodId: 'browser' })),
  ]) as IncomingMessage
  request.method = 'POST'
  const fiber = Effect.runFork(
    acpRoute(request, '/api/agents/acp/authenticate').pipe(
      Effect.provideService(RuntimeServices, runtime.services),
    ),
  )
  await startedPromise
  await Effect.runPromise(Fiber.interrupt(fiber))
  finish()
  vi.spyOn(acp, 'authenticateAcp').mockResolvedValue()
  expect((await call('authenticate', { id: 'first', methodId: 'browser' })).status).toBe(200)
})

it('keeps browser sign-in alive across requests and exposes its progress without spawning probes', async () => {
  const { call } = await setup()
  const inspect = vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  let finish = () => {}
  vi.spyOn(acp, 'authenticateAcp').mockImplementation((_launch, _method, _signal, output) => {
    output?.('Open https://accounts.example.test/sign-in?state=abc\n')
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  expect(
    (await call('authenticate', { id: 'first', methodId: 'browser', background: true })).status,
  ).toBe(200)
  inspect.mockClear()
  const progress = await (await call('inspect', { id: 'first' })).json()
  expect(progress.authentication.status).toBe('waiting')
  expect(progress.authentication.urls).toEqual(['https://accounts.example.test/sign-in?state=abc'])
  expect(inspect).not.toHaveBeenCalled()
  expect(
    (await call('authenticate', { id: 'first', methodId: 'browser', background: true })).status,
  ).toBe(409)
  finish()
  await vi.waitFor(async () =>
    expect((await (await call('inspect', { id: 'first' })).json()).authentication.status).toBe(
      'completed',
    ),
  )
})

it('cancels browser sign-in and releases the installation lock', async () => {
  const { call } = await setup()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  vi.spyOn(acp, 'authenticateAcp').mockImplementation(
    (_launch, _method, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
  )
  expect(
    (await call('authenticate', { id: 'first', methodId: 'browser', background: true })).status,
  ).toBe(200)
  expect((await call('authenticate/cancel', { id: 'first' })).status).toBe(200)
  await vi.waitFor(async () => {
    const progress = await (await call('inspect', { id: 'first' })).json()
    expect(progress.authentication).toMatchObject({ status: 'failed', error: 'Sign-in cancelled.' })
  })
  vi.spyOn(acp, 'authenticateAcp').mockResolvedValue()
  expect((await call('authenticate', { id: 'first', methodId: 'browser' })).status).toBe(200)
})

it('forwards only callbacks matching the active OAuth redirect and state', async () => {
  const { call } = await setup()
  let finish = () => {}
  const received: string[] = []
  const callback = createServer((request, response) => {
    received.push(request.url ?? '')
    response.end('Signed in')
    finish()
  })
  await new Promise<void>((resolve) => callback.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        callback.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = callback.address()
  if (!address || typeof address === 'string') throw new Error('No callback listener')
  const redirect = `http://127.0.0.1:${address.port}/oauth/callback`
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  vi.spyOn(acp, 'authenticateAcp').mockImplementation((_launch, _method, _signal, output) => {
    output?.(
      `Open https://accounts.example.test/sign-in?redirect_uri=${encodeURIComponent(redirect)}&state=correct\n`,
    )
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  expect(
    (await call('authenticate', { id: 'first', methodId: 'browser', background: true })).status,
  ).toBe(200)
  for (const url of [
    `${redirect}?code=secret&state=wrong`,
    `http://127.0.0.1:12345/oauth/callback?code=secret&state=correct`,
    `${redirect}/other?code=secret&state=correct`,
    'https://example.test?code=secret&state=correct',
  ])
    expect((await call('authenticate/callback', { id: 'first', url })).ok).toBe(false)
  expect(received).toEqual([])
  expect(
    (
      await call('authenticate/callback', {
        id: 'first',
        url: `${redirect}?code=secret&state=correct`,
      })
    ).status,
  ).toBe(200)
  expect(received).toEqual(['/oauth/callback?code=secret&state=correct'])
  const completed = await (await call('inspect', { id: 'first' })).json()
  expect(completed.authentication).toMatchObject({ status: 'completed', output: '', urls: [] })
})

it('stops an outstanding browser sign-in when the runtime closes', async () => {
  const { runtime, call } = await setup()
  vi.spyOn(acp, 'inspectAcp').mockResolvedValue(browserAuth)
  let stopped = false
  vi.spyOn(acp, 'authenticateAcp').mockImplementation(
    (_launch, _method, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            stopped = true
            reject(new Error('aborted'))
          },
          { once: true },
        )
      }),
  )
  expect(
    (await call('authenticate', { id: 'first', methodId: 'browser', background: true })).status,
  ).toBe(200)
  await runtime.close()
  expect(stopped).toBe(true)
})
