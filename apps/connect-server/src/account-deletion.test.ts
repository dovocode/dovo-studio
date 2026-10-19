import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { AccountStore } from './store.js'
import { PushStore } from './push-store.js'
import { createConnectServer } from './server.js'
import { identityDeletion } from './delete-identity.js'

const dispose: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const close of dispose.splice(0).reverse()) await close()
})
async function fixture(configured = true) {
  const store = new AccountStore(':memory:')
  dispose.push(() => store.db.close())
  const pushes = new PushStore(store)
  const deletion = vi.fn<(id: string) => Promise<void>>(async () => {})
  const server = createConnectServer({
    store,
    origin: 'http://connect.test',
    authorizationOrigin: 'https://auth.test',
    authorize: async () => '',
    exchange: async () => ({ id: '', name: '' }),
    ...(configured ? { deleteIdentity: deletion } : {}),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  dispose.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const session = (id: string) => {
    const value = store.createLogin()
    store.approve(value.login, { id, name: id })
    return value.token
  }
  const request = (token: string, confirm = 'DELETE') =>
    fetch(`http://127.0.0.1:${address.port}/v1/account`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm, userId: 'other' }),
    })
  return { store, pushes, deletion, session, request }
}
it('deletes only the authenticated identity and all its sessions, directory and push grants', async () => {
  const f = await fixture()
  const first = f.session('person'),
    second = f.session('person'),
    other = f.session('other')
  f.store.link('person', { id: 'server', name: 'Private', address: 'http://vpn:8080' })
  const grant = f.pushes.subscribe(first, {
    runtimeId: 'server',
    token: 'a'.repeat(64),
    platform: 'ios',
    environment: 'production',
  })
  expect((await f.request(first, 'no')).status).toBe(400)
  expect((await f.request('invalid')).status).toBe(401)
  expect(f.deletion).not.toHaveBeenCalled()
  expect((await f.request(first)).status).toBe(200)
  expect(f.deletion).toHaveBeenCalledWith('person', expect.objectContaining({ verified: false }))
  expect(f.store.directory(first)).toBeUndefined()
  expect(f.store.directory(second)).toBeUndefined()
  expect(f.pushes.subscription(grant.token)).toBeUndefined()
  expect(f.store.db.prepare('SELECT * FROM servers WHERE user=?').all('person')).toEqual([])
  expect(f.store.db.prepare('SELECT * FROM users WHERE id=?').all('person')).toEqual([])
  expect(f.store.directory(other)?.user.id).toBe('other')
  expect(() => f.session('person')).toThrow('deletion')
})
it('blocks access and delivery after provider failure while permitting a deletion retry', async () => {
  const f = await fixture()
  const token = f.session('person')
  const grant = f.pushes.subscribe(token, {
    runtimeId: 'server',
    token: 'a'.repeat(64),
    platform: 'ios',
    environment: 'production',
  })
  f.deletion.mockRejectedValueOnce(new Error('Provider unavailable'))
  expect((await f.request(token)).status).toBe(409)
  expect(f.store.directory(token)).toBeUndefined()
  expect(f.pushes.subscription(grant.token)).toBeUndefined()
  expect((await f.request(token)).status).toBe(200)
  expect(f.deletion).toHaveBeenCalledTimes(2)
})
it('does not lock the account if identity deletion is unconfigured', async () => {
  const f = await fixture(false),
    token = f.session('person')
  expect((await f.request(token)).status).toBe(503)
  expect(f.store.directory(token)?.user.id).toBe('person')
})
it('uses server credentials and verified identity ownership; refuses admin and mismatched identities', async () => {
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  const remove = identityDeletion({
    issuer: 'https://auth.test',
    organization: 'dovo',
    clientId: 'private-app',
    clientSecret: 'secret',
  })
  const user = { owner: 'dovo', name: 'person', id: 'uuid', isAdmin: false, isGlobalAdmin: false }
  fetchMock
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: user }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: 'Affected' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: null }))
  await remove('uuid', { verified: false, verify: () => {} })
  expect(fetchMock.mock.calls[0][0]).toEqual(
    new URL('https://auth.test/api/get-user?owner=dovo&userId=uuid'),
  )
  expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ owner: 'dovo', name: 'person' }))
  for (const invalid of [
    { ...user, owner: 'other' },
    { ...user, id: 'other' },
    { ...user, isAdmin: true },
    { ...user, isGlobalAdmin: true },
  ]) {
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'ok', data: invalid }))
    await expect(remove('uuid', { verified: true, verify: () => {} })).rejects.toThrow(
      'administrator-assisted',
    )
  }
  fetchMock.mockResolvedValueOnce(Response.json({ status: 'ok', data: null }))
  await expect(remove('uuid', { verified: true, verify: () => {} })).resolves.toBeUndefined()
  fetchMock.mockResolvedValueOnce(Response.json({ status: 'error', data: null }))
  await expect(remove('uuid', { verified: true, verify: () => {} })).rejects.toThrow(
    'Retry deletion',
  )
})

it('purges a soft-deleted Casdoor identity and verifies it is absent before completing', async () => {
  const user = { owner: 'dovo', name: 'person', id: 'uuid', isAdmin: false, isGlobalAdmin: false }
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: user }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: 'Affected' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: { ...user, isDeleted: true } }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: 'Affected' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: null }))
  vi.stubGlobal('fetch', fetchMock)
  await identityDeletion({
    issuer: 'https://auth.test',
    organization: 'dovo',
    clientId: 'app',
    clientSecret: 'private',
  })('uuid', { verified: false, verify: () => {} })
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
})

it('accepts deployed Casdoor responses without the optional global-admin flag only within the configured organization', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        status: 'ok',
        data: { owner: 'dovo', name: 'person', id: 'uuid', isAdmin: false },
      }),
    )
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: 'Affected' }))
    .mockResolvedValueOnce(Response.json({ status: 'ok', data: null }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    identityDeletion({
      issuer: 'https://auth.test',
      organization: 'dovo',
      clientId: 'app',
      clientSecret: 'private',
    })('uuid', { verified: false, verify: () => {} }),
  ).resolves.toBeUndefined()
})

it('refuses a missing out-of-organization identity unless a previous verified deletion can be resumed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ status: 'ok', data: null })),
  )
  const remove = identityDeletion({
    issuer: 'https://auth.test',
    organization: 'dovo',
    clientId: 'app',
    clientSecret: 'secret',
  })
  await expect(remove('uuid', { verified: false, verify: () => {} })).rejects.toThrow(
    'administrator-assisted',
  )
  await expect(remove('uuid', { verified: true, verify: () => {} })).resolves.toBeUndefined()
})
