import { afterEach, expect, it, vi } from 'vite-plus/test'
import { AccountClient } from './account-client.js'
const token = 'a'.repeat(43),
  origin = 'https://connect.test'
const directory = {
  user: { id: 'person', name: 'Dominic' },
  servers: [{ id: 'stable', name: 'Server', address: 'http://vpn:5000' }],
}
afterEach(() => vi.unstubAllGlobals())
function fixture({ saveFails = false, pending = false } = {}) {
  const calls: Array<{
    path: string
    method: string
    body: unknown
    authorization: string | null
  }> = []
  let saved: string | null = null
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname
        calls.push({
          path,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
          authorization: new Headers(init.headers).get('Authorization'),
        })
        if (path === '/v1/login' && init.method === 'POST')
          return Response.json({
            token,
            code: 'ABC12345',
            url: origin + '/auth/start?id=login',
            expiresAt: Date.now() + 300000,
          })
        if (path === '/v1/login') return Response.json({ ready: !pending })
        if (path === '/v1/servers' && init.method === 'GET') return Response.json(directory)
        return Response.json({ ok: true })
      },
    ),
  )
  const open = vi.fn<(url: string) => Promise<void>>(async () => {})
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        if (saveFails && value) throw new Error('Keychain locked')
        saved = value
      },
    },
    open,
    origin,
  )
  return { client, calls, open, saved: () => saved }
}
it('restores secure sessions and never copies runtime credentials to the directory', async () => {
  const f = fixture()
  await f.client.load()
  expect(f.client.snapshot().directory).toBeNull()
  await f.client.signIn()
  expect(f.saved()).toBe(token)
  expect(f.client.snapshot().directory).toEqual(directory)
  await f.client.link({ id: 'stable', name: 'Server', address: 'http://vpn:5000' })
  expect(f.calls.find((call) => call.method === 'PUT')?.body).toEqual(directory.servers[0])
  expect(f.open).toHaveBeenCalledWith(origin + '/auth/start?id=login')
  await f.client.signOut()
  expect(f.saved()).toBeNull()
  expect(f.client.snapshot().directory).toBeNull()
})
it('revokes an approved login if secure session storage fails', async () => {
  const f = fixture({ saveFails: true })
  await f.client.signIn()
  expect(f.saved()).toBeNull()
  expect(f.client.snapshot().directory).toBeNull()
  expect(f.client.snapshot().error).toBe('Keychain locked')
  expect(f.calls.some((call) => call.path === '/v1/session' && call.method === 'DELETE')).toBe(true)
})
it('cancels pending sign-in and revokes its ticket', async () => {
  const f = fixture({ pending: true })
  const complete = f.client.signIn()
  await vi.waitFor(() => expect(f.client.snapshot().login?.code).toBe('ABC12345'))
  f.client.cancel()
  await complete
  expect(f.saved()).toBeNull()
  expect(f.client.snapshot().busy).toBe(false)
  expect(f.client.snapshot().login).toBeNull()
  expect(f.calls.some((call) => call.path === '/v1/session' && call.method === 'DELETE')).toBe(true)
})
it('clears a revoked session instead of treating account login as runtime pairing', async () => {
  const f = fixture()
  await f.client.signIn()
  vi.stubGlobal('fetch', async () => Response.json({ error: 'expired' }, { status: 401 }))
  await f.client.refresh()
  expect(f.saved()).toBeNull()
  expect(f.client.snapshot().directory).toBeNull()
  expect(f.calls.every((call) => call.path.startsWith('/v1/'))).toBe(true)
})
it('refreshes directory presence without starting an account operation or fetching publications', async () => {
  const f = fixture()
  await f.client.signIn()
  const updated = {
    ...directory,
    servers: [{ ...directory.servers[0], internet: { online: true, publicKey: 'b'.repeat(64) } }],
  }
  const fetch = vi.fn<() => Promise<Response>>(async () => Response.json(updated))
  vi.stubGlobal('fetch', fetch)
  expect(await f.client.refreshDirectory(new AbortController().signal)).toEqual(updated)
  expect(f.client.snapshot().directory).toEqual(updated)
  expect(f.client.snapshot().busy).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([200, 409])(
  'ignores a directory response with HTTP %i arriving after cancellation or sign-out',
  async (status) => {
    const f = fixture()
    await f.client.signIn()
    let respond: (response: Response) => void = () => {
      throw new Error('No pending request')
    }
    vi.stubGlobal('fetch', (url: string) =>
      new URL(url).pathname === '/v1/servers'
        ? new Promise<Response>((resolve) => {
            respond = resolve
          })
        : Promise.resolve(Response.json({ ok: true })),
    )
    const controller = new AbortController()
    const refresh = f.client.refreshDirectory(controller.signal)
    controller.abort()
    respond(Response.json(directory))
    await expect(refresh).rejects.toThrow('cancelled')
    const afterSignOut = f.client.refreshDirectory()
    await f.client.signOut()
    respond(Response.json(directory, { status }))
    await expect(afterSignOut).rejects.toThrow('Account refresh cancelled')
    expect(f.client.snapshot().deletionPending).toBe(false)
    expect(f.client.snapshot().directory).toBeNull()
    expect(f.client.sessionId()).toBeNull()
  },
)
it('does not replace account authorization when the broker denies renewed computer access', async () => {
  const f = fixture()
  await f.client.signIn()
  const session = f.client.sessionId()
  const request = vi.fn<() => Promise<Response>>(async () =>
    Response.json({ error: 'revoked' }, { status: 403 }),
  )
  vi.stubGlobal('fetch', request)
  await expect(
    f.client.connectInternet(
      { ...directory.servers[0]!, internet: { online: true, publicKey: 'key' } },
      new Uint8Array(32).fill(3),
      new AbortController().signal,
    ),
  ).rejects.toThrow('Account service is unavailable')
  expect(request).toHaveBeenCalledTimes(1)
  expect(f.client.sessionId()).toBe(session)
  expect(f.saved()).toBe(token)
})
it('does not commit an account when cancelled during secure storage', async () => {
  const f = fixture()
  let saved: string | null = null,
    finish: (() => void) | undefined
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        if (value)
          await new Promise<void>((resolve) => {
            finish = resolve
          })
        saved = value
      },
    },
    async () => {},
    origin,
  )
  const completed = client.signIn()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  client.cancel()
  finish!()
  await completed
  expect(saved).toBeNull()
  expect(client.snapshot().directory).toBeNull()
  expect(f.calls.some((call) => call.path === '/v1/session' && call.method === 'DELETE')).toBe(true)
})
it('deletes the hosted account before clearing secure storage and signed-in state', async () => {
  const f = fixture()
  await f.client.signIn()
  await f.client.deleteAccount()
  expect(f.calls.find((call) => call.path === '/v1/account')).toMatchObject({
    method: 'DELETE',
    body: { confirm: 'DELETE' },
    authorization: 'Bearer ' + token,
  })
  expect(f.saved()).toBeNull()
  expect(f.client.snapshot().directory).toBeNull()
})
it('restores the deletion retry flow after restarting without discarding its secure session', async () => {
  let saved: string | null = token
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push(url)
      if (url.endsWith('/v1/servers'))
        return Response.json({ error: 'Deletion pending' }, { status: 409 })
      expect(init?.method).toBe('DELETE')
      return Response.json({ ok: true })
    }),
  )
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value
      },
    },
    async () => {},
    origin,
  )
  await client.load()
  expect(client.snapshot().deletionPending).toBe(true)
  expect(saved).toBe(token)
  await client.deleteAccount()
  expect(client.snapshot().deletionPending).toBe(false)
  expect(saved).toBeNull()
  expect(calls).toEqual([origin + '/v1/servers', origin + '/v1/account'])
})

it('clears a pending deletion when its session expires because Connect finishes it', async () => {
  let saved: string | null = token
  let deletion = 409
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'Deletion pending', deletion: 'durable' }, { status: deletion }),
    ),
  )
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value
      },
    },
    async () => {},
    origin,
  )
  await client.load()
  await client.deleteAccount()
  expect(client.snapshot()).toMatchObject({
    deletionPending: true,
    error: expect.stringContaining('Connect finishes it'),
  })
  deletion = 401
  await client.deleteAccount()
  expect(client.snapshot()).toMatchObject({ deletionPending: false, directory: null, error: '' })
  expect(client.sessionId()).toBeFalsy()
  expect(saved).toBeNull()
})
it.each([
  ['no deletion signal', { error: 'Deletion pending' }],
  ['an unknown deletion signal', { error: 'Deletion pending', deletion: 'eventual' }],
  ['a body that is not JSON', 'Conflict'],
])('reports a 409 with %s as a deletion that needs this session', async (_case, body) => {
  let saved: string | null = token
  let deletion = 409
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      typeof body === 'string'
        ? new Response(body, { status: deletion })
        : Response.json(body, { status: deletion }),
    ),
  )
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value
      },
    },
    async () => {},
    origin,
  )
  await client.load()
  expect(client.snapshot()).toMatchObject({
    deletionPending: true,
    error: 'Account deletion has started. Retry to finish deleting your account.',
  })
  await client.deleteAccount()
  expect(client.snapshot().error).toBe(
    'Account deletion has started. Retry to finish deleting your account.',
  )
  expect(saved).toBe(token)
  // An older Connect cannot finish without the session, so its 401 does not confirm deletion.
  deletion = 401
  await client.deleteAccount()
  expect(client.snapshot()).toMatchObject({
    deletionPending: false,
    directory: null,
    error: expect.stringContaining('before it confirmed account deletion'),
  })
  expect(client.sessionId()).toBeNull()
  expect(saved).toBeNull()
})
it('keeps the account session when deletion is refused without a pending deletion', async () => {
  const f = fixture()
  await f.client.signIn()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ error: 'Expired' }, { status: 401 })),
  )
  await f.client.deleteAccount()
  expect(f.client.snapshot().error).toBe('Sign in again to see your computers.')
  expect(f.saved()).toBe(token)
})

it('keeps account sessions out of paired setup and revokes a grant when completion fails', async () => {
  const f = fixture()
  await f.client.signIn()
  const setup = {
    id: 'setup',
    registration: {
      id: 'runtime',
      name: 'Server',
      identity: 'key',
      publicKey: 'a'.repeat(64),
      timestamp: Date.now(),
      signature: 'signed',
    },
  }
  const prepare = vi.fn<(hash: string) => Promise<typeof setup>>(async () => setup)
  const complete = vi.fn<(id: string, grant: string) => Promise<void>>(async () => {
    throw new Error('Device revoked')
  })
  const fetchBefore = fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (new URL(url instanceof Request ? url.url : url).pathname === '/v1/internet/hosts')
        return Response.json({ grant: 'scoped-host-grant' })
      return fetchBefore(url, init)
    }),
  )
  await expect(f.client.enablePairedInternet('runtime', prepare, complete)).rejects.toThrow(
    'Device revoked',
  )
  expect(prepare.mock.calls[0][0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(prepare.mock.calls[0][0]).not.toBe(token)
  expect(complete).toHaveBeenCalledWith('setup', 'scoped-host-grant')
  expect(f.calls.at(-1)).toMatchObject({
    path: '/v1/internet/host',
    method: 'DELETE',
    authorization: 'Bearer scoped-host-grant',
  })
})

it('refuses another runtime or a signout during setup before issuing its account grant', async () => {
  const f = fixture()
  await f.client.signIn()
  const setup = {
    id: 'setup',
    registration: {
      id: 'other',
      name: 'Server',
      identity: 'key',
      publicKey: 'a'.repeat(64),
      timestamp: Date.now(),
      signature: 'signed',
    },
  }
  const complete = vi.fn<() => Promise<void>>(async () => {})
  await expect(
    f.client.enablePairedInternet('runtime', async () => setup, complete),
  ).rejects.toThrow('different computer')
  setup.registration.id = 'runtime'
  await expect(
    f.client.enablePairedInternet(
      'runtime',
      async () => {
        await f.client.signOut()
        return setup
      },
      complete,
    ),
  ).rejects.toThrow('cancelled')
  expect(complete).not.toHaveBeenCalled()
  expect(f.calls.some((call) => call.path === '/v1/internet/hosts')).toBe(false)
})

it('forgets the saved account before waiting for remote sign-out while offline', async () => {
  const f = fixture()
  await f.client.signIn()
  let fail!: () => void
  const remote = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () =>
      new Promise<Response>((_resolve, reject) => {
        fail = () => reject(new TypeError('Offline'))
      }),
  )
  vi.stubGlobal('fetch', remote)
  const signingOut = f.client.signOut()
  await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1))
  expect(f.saved()).toBeNull()
  expect(f.client.sessionId()).toBeNull()
  expect(f.client.snapshot().directory).toBeNull()
  expect(new Headers(remote.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer ' + token)
  fail()
  await signingOut
  expect(f.client.snapshot().error).toContain('could not confirm revocation')
  await f.client.load()
  expect(f.client.sessionId()).toBeNull()
  expect(remote).toHaveBeenCalledTimes(1)
})

it('keeps the session available when secure storage cannot remove it', async () => {
  const client = new AccountClient(
    {
      read: async () => token,
      write: async () => {
        throw new Error('Storage is locked')
      },
    },
    async () => {},
    origin,
  )
  const remote = vi.fn<typeof fetch>(async () => Response.json(directory))
  vi.stubGlobal('fetch', remote)
  await client.load()
  await client.signOut()
  expect(client.snapshot().error).toBe('Storage is locked')
  expect(client.snapshot().directory).toEqual(directory)
  expect(client.sessionId()).toBeTruthy()
  expect(remote).toHaveBeenCalledTimes(1)
})

it('can finish sign-out after an offline restart when the remote session has expired', async () => {
  let saved: string | null = token
  const client = new AccountClient(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value
      },
    },
    async () => {},
    origin,
  )
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Offline')
  })
  await client.load()
  expect(client.sessionId()).toBeTruthy()
  expect(client.snapshot().directory).toBeNull()
  vi.stubGlobal('fetch', async () => Response.json({}, { status: 401 }))
  await client.signOut()
  expect(saved).toBeNull()
  expect(client.sessionId()).toBeNull()
  expect(client.snapshot().error).toBe('')
})
