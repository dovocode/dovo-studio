import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { startRuntime } from '../index.js'
import * as acp from '../agents/providers/acp-connection.js'

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
  const inspect = vi
    .spyOn(acp, 'inspectAcp')
    .mockResolvedValue({
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
  const list = vi
    .spyOn(acp, 'listAcpSessions')
    .mockResolvedValue({
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
