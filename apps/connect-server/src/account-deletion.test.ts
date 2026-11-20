import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AccountStore, hash } from './store.js'
import { PushStore } from './push-store.js'
import { createConnectServer } from './server.js'

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
  const url = (path: string) => `http://127.0.0.1:${address.port}${path}`
  return { store, pushes, deletion, session, request, url }
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
  const started = await f.request(token)
  expect(started.status).toBe(409)
  // Clients trust only this explicit signal. A bare 409 comes from a Connect without durable retry.
  expect(await started.json()).toEqual({
    error: expect.stringContaining('Connect finishes it'),
    deletion: 'durable',
  })
  const servers = await fetch(f.url('/v1/servers'), {
    headers: { Authorization: 'Bearer ' + token },
  })
  expect(servers.status).toBe(409)
  expect(await servers.json()).toMatchObject({ deletion: 'durable' })
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

async function durableServer(
  path: string,
  now: () => number,
  deleteIdentity: (id: string) => Promise<void>,
) {
  const store = new AccountStore(path, now)
  const server = createConnectServer({
    store,
    origin: 'http://connect.test',
    authorizationOrigin: 'https://auth.test',
    authorize: async () => '',
    exchange: async () => ({ id: '', name: '' }),
    deleteIdentity,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  let open = true
  const close = () =>
    new Promise<void>((resolve) => {
      if (!open) return resolve()
      open = false
      server.close(() => {
        store.db.close()
        resolve()
      })
      server.closeAllConnections()
    })
  dispose.push(close)
  const remove = (token: string) =>
    fetch(`http://127.0.0.1:${address.port}/v1/account`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    })
  return { store, close, remove }
}
const users = (store: AccountStore) =>
  store.db.prepare('SELECT id FROM users WHERE id=?').all('person')

it('finishes a deletion after an Auth outage, session expiry and a Connect restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'connect-deletion-')), 'accounts.sqlite')
  dispose.push(() => rmSync(dirname(path), { recursive: true, force: true }))
  let clock = Date.now()
  const now = () => clock
  const unavailable = vi.fn<(id: string) => Promise<void>>(async () => {
    throw new Error('Auth unavailable')
  })
  const first = await durableServer(path, now, unavailable)
  const login = first.store.createLogin()
  first.store.approve(login.login, { id: 'person', name: 'Person' })
  first.store.link('person', { id: 'server', name: 'Private', address: 'http://vpn:8080' })
  expect((await first.remove(login.token)).status).toBe(409)
  expect(unavailable).toHaveBeenCalledWith('person', expect.anything())

  // The session expires while Auth is still down. The client can no longer retry.
  clock += 31 * 86400_000
  first.store.cleanup()
  expect((await first.remove(login.token)).status).toBe(401)
  expect(users(first.store)).toHaveLength(1)
  await first.close()

  const recovered = vi.fn<(id: string) => Promise<void>>(async () => {})
  const second = await durableServer(path, now, recovered)
  await vi.waitFor(() => expect(users(second.store)).toEqual([]))
  expect(recovered).toHaveBeenCalledWith('person', expect.anything())
  expect(second.store.db.prepare('SELECT * FROM servers WHERE user=?').all('person')).toEqual([])
  expect(second.store.pendingDeletions()).toEqual([])
  const retry = second.store.createLogin()
  expect(() => second.store.approve(retry.login, { id: 'person', name: 'Person' })).toThrow(
    'deletion',
  )
})

it('waits for a deletion attempt before shutdown reports that the store can close', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'connect-deletion-')), 'accounts.sqlite')
  dispose.push(() => rmSync(dirname(path), { recursive: true, force: true }))
  const seed = new AccountStore(path)
  seed.approve(seed.createLogin().login, { id: 'person', name: 'Person' })
  seed.beginDeletion('person')
  seed.db.close()
  let finish = () => {}
  let begin = () => {}
  const started = new Promise<void>((resolve) => {
    begin = resolve
  })
  const f = await durableServer(path, Date.now, () => {
    begin()
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  await started
  let closed = false
  const closing = f.close().then(() => {
    closed = true
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(closed).toBe(false)
  finish()
  await closing
  const reopened = new AccountStore(path)
  dispose.push(() => reopened.db.close())
  expect(users(reopened)).toEqual([])
})

it('recovers deletions that an older Connect recorded only as a hashed marker', () => {
  const directory = mkdtempSync(join(tmpdir(), 'connect-deletion-'))
  dispose.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'accounts.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE deleted_accounts(id TEXT PRIMARY KEY);`)
  legacy.prepare('INSERT INTO users VALUES(?,?)').run('person', 'Person')
  legacy.prepare('INSERT INTO users VALUES(?,?)').run('other', 'Other')
  legacy.prepare('INSERT INTO deleted_accounts VALUES(?)').run(hash('person'))
  legacy.close()
  const store = new AccountStore(path)
  dispose.push(() => store.db.close())
  expect(store.pendingDeletions()).toEqual(['person'])
})

it('restores pending deletions that a rolled-back Connect started after the table existed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'connect-deletion-'))
  dispose.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'accounts.sqlite')
  const current = new AccountStore(path, () => 5000)
  for (const id of ['retrying', 'rolled-back', 'finished', 'active'])
    current.approve(current.createLogin().login, { id, name: id })
  current.beginDeletion('retrying')
  current.attemptDeletion('retrying')
  current.db.close()
  // The older Connect knows only the hashed marker. It starts one deletion and finishes another.
  const legacy = new DatabaseSync(path)
  for (const id of ['rolled-back', 'finished'])
    legacy.prepare('INSERT INTO deleted_accounts(id) VALUES(?)').run(hash(id))
  legacy.prepare('DELETE FROM users WHERE id=?').run('finished')
  legacy.close()
  for (let start = 0; start < 2; start++) {
    const upgraded = new AccountStore(path)
    expect(upgraded.pendingDeletions()).toEqual(['rolled-back', 'retrying'])
    expect(
      upgraded.db
        .prepare('SELECT user,attempted FROM pending_account_deletions ORDER BY user')
        .all(),
    ).toEqual([
      { user: 'retrying', attempted: 5000 },
      { user: 'rolled-back', attempted: 0 },
    ])
    expect(upgraded.deleting('finished')).toBe(true)
    expect(upgraded.deleting('active')).toBe(false)
    upgraded.db.close()
  }
})

it('retries the least recently attempted account so one failure cannot block the others', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'connect-deletion-'))
  dispose.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'accounts.sqlite')
  let clock = Date.now()
  const seed = new AccountStore(path, () => clock)
  for (const id of ['broken', 'person']) {
    seed.approve(seed.createLogin().login, { id, name: id })
    seed.beginDeletion(id)
  }
  seed.db.close()
  const deletion = vi.fn<(id: string) => Promise<void>>(async (id) => {
    if (id === 'broken') throw new Error('Auth rejected this account')
  })
  // Each start runs one pass. Closing waits for that pass.
  for (let restart = 0; restart < 2; restart++) {
    clock += 1000
    await (await durableServer(path, () => clock, deletion)).close()
  }
  expect(deletion.mock.calls.map(([id]) => id)).toEqual(['broken', 'person', 'broken'])
  const store = new AccountStore(path)
  dispose.push(() => store.db.close())
  expect(store.pendingDeletions()).toEqual(['broken'])
})
