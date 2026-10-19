import { afterEach, describe, expect, it } from 'vite-plus/test'
import { once } from 'node:events'
import { AccountStore, hash } from './store.js'
import { createConnectServer } from './server.js'
const resources: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose()
})
async function fixture(trustedProxies: string[] = []) {
  let clock = Date.now()
  const store = new AccountStore(':memory:', () => clock)
  resources.push(() => store.db.close())
  const origin = 'http://connect.test'
  const server = createConnectServer({
    store,
    origin,
    trustedProxies,
    authorizationOrigin: 'https://auth.test',
    authorize: async (login) => {
      login.state = 'verified-state'
      login.nonce = 'nonce'
      login.verifier = 'verifier'
      return 'https://auth.test/authorize'
    },
    exchange: async (login) => {
      expect(login.nonce).toBe('nonce')
      return { id: login.code === 'USERB' ? 'user-b' : 'user-a', name: 'Dominic' }
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  resources.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const base = 'http://127.0.0.1:' + address.port
  const request = (path: string, options: RequestInit = {}) =>
    fetch(base + path, { redirect: 'manual', ...options })
  const login = async () => {
    const response = await request('/v1/login', { method: 'POST' })
    expect(response.status).toBe(200)
    const value = (await response.json()) as {
      token: string
      url: string
      code: string
      expiresAt: number
    }
    return {
      ...value,
      id: new URL(value.url).searchParams.get('id')!,
      headers: { Authorization: 'Bearer ' + value.token },
    }
  }
  const approve = async (value: Awaited<ReturnType<typeof login>>) => {
    const start = await request('/auth/start?id=' + value.id)
    const cookie = start.headers.get('set-cookie')!.split(';')[0]
    const authorize = await request('/auth/authorize', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
    })
    expect(authorize.status).toBe(303)
    const result = await request('/auth/callback?state=verified-state&code=provider-code', {
      headers: { Cookie: cookie },
    })
    expect(result.status).toBe(200)
    return cookie
  }
  return { store, login, approve, request, advance: (ms: number) => (clock += ms) }
}
describe('optional account discovery', () => {
  it('permits only the configured identity origin in the browser form policy', async () => {
    const f = await fixture(),
      login = await f.login()
    const page = await f.request('/auth/start?id=' + login.id)
    expect(page.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; form-action 'self' https://auth.test; frame-ancestors 'none'; base-uri 'none'",
    )
    await f.approve(login)
  })

  it('isolates verified accounts while sharing a quota across sessions of the same account', async () => {
    const f = await fixture()
    const session = (id: string) => {
      const { login, token } = f.store.createLogin()
      f.store.approve(login, { id, name: id })
      return { Authorization: 'Bearer ' + token }
    }
    const first = session('first'),
      sameAccount = session('first'),
      second = session('second')
    for (let index = 0; index < 300; index++)
      expect((await f.request('/v1/servers', { headers: first })).status).toBe(200)
    expect((await f.request('/v1/servers', { headers: sameAccount })).status).toBe(429)
    expect((await f.request('/v1/servers', { headers: second })).status).toBe(200)
    f.advance(60_001)
    expect((await f.request('/v1/servers', { headers: first })).status).toBe(200)
  })

  it('does not let arbitrary bearer tokens or spoofed forwarded IPs bypass anonymous limits', async () => {
    const f = await fixture()
    for (let index = 0; index < 300; index++)
      expect(
        (
          await f.request('/v1/servers', {
            headers: {
              Authorization: 'Bearer ' + index.toString().padStart(43, '0'),
              'X-Forwarded-For': `203.0.113.${index % 250}`,
            },
          })
        ).status,
      ).toBe(401)
    expect(
      (
        await f.request('/v1/login', {
          method: 'POST',
          headers: { 'X-Forwarded-For': '198.51.100.1' },
        })
      ).status,
    ).toBe(429)
  })

  it('isolates anonymous clients forwarded by an explicitly trusted proxy', async () => {
    const f = await fixture(['127.0.0.1'])
    for (let index = 0; index < 300; index++)
      expect(
        (await f.request('/v1/servers', { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status,
      ).toBe(401)
    expect(
      (await f.request('/v1/servers', { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status,
    ).toBe(429)
    expect(
      (await f.request('/v1/servers', { headers: { 'X-Forwarded-For': '203.0.113.2' } })).status,
    ).toBe(401)
  })
  it('preserves public health, API preflight and bounded JSON errors across route groups', async () => {
    const f = await fixture()
    const health = await f.request('/health')
    expect(await health.json()).toEqual({
      ok: true,
      service: 'dovo-connect',
      accountRequired: false,
    })
    expect(health.headers.get('Cache-Control')).toBe('no-store')
    const preflight = await f.request('/v1/servers', { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')

    const login = await f.login()
    await f.approve(login)
    const malformed = await f.request('/v1/servers', {
      method: 'PUT',
      headers: login.headers,
      body: '{',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid request' })
    const oversized = await f.request('/v1/servers', {
      method: 'PUT',
      headers: login.headers,
      body: JSON.stringify({ name: 'x'.repeat(16_384) }),
    })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ error: 'Request is too large' })
    expect((await f.request('/v1/servers', { headers: login.headers })).status).toBe(200)
  })
  it('requires browser confirmation and keeps account login separate from runtime pairing', async () => {
    const f = await fixture(),
      login = await f.login()
    expect((await f.request('/v1/servers', { headers: login.headers })).status).toBe(401)
    expect(await (await f.request('/v1/login', { headers: login.headers })).json()).toEqual({
      ready: false,
    })
    const cookie = await f.approve(login)
    expect(await (await f.request('/v1/login', { headers: login.headers })).json()).toEqual({
      ready: true,
    })
    expect(
      (
        await f.request('/auth/callback?state=verified-state&code=provider-code', {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(400)
    const link = {
      id: 'stable-runtime',
      name: 'Mac Studio',
      address: 'http://100.64.1.2:51464',
      token: 'must-never-be-stored',
    }
    expect(
      (
        await f.request('/v1/servers', {
          method: 'PUT',
          headers: { ...login.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(link),
        })
      ).status,
    ).toBe(200)
    const directory = await (await f.request('/v1/servers', { headers: login.headers })).json()
    expect(directory).toEqual({
      user: { id: 'user-a', name: 'Dominic' },
      servers: [{ id: link.id, name: link.name, address: link.address }],
    })
    expect(JSON.stringify(f.store.db.prepare('SELECT * FROM servers').all())).not.toContain(
      link.token,
    )
    expect((await f.request('/api/pair/code', { headers: login.headers })).status).toBe(404)
    expect(
      (
        await f.request('/v1/servers', {
          method: 'PUT',
          headers: login.headers,
          body: JSON.stringify({ ...link, address: 'http://token@private:51464' }),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await f.request('/v1/servers', {
          method: 'PUT',
          headers: login.headers,
          body: JSON.stringify({ ...link, address: 'http://127.0.0.1:51464' }),
        })
      ).status,
    ).toBe(400)
    await f.request('/v1/session', { method: 'DELETE', headers: login.headers })
    expect((await f.request('/v1/servers', { headers: login.headers })).status).toBe(401)
  })
  it('isolates directory rows and unlink operations by authenticated subject', async () => {
    const f = await fixture(),
      a = await f.login(),
      b = await f.login()
    await f.approve(a)
    const second = f.store.login(b.id)!
    second.code = 'USERB'
    f.store.saveLogin(second)
    await f.approve(b)
    for (const [session, name] of [
      [a, 'First'],
      [b, 'Second'],
    ] as const)
      expect(
        (
          await f.request('/v1/servers', {
            method: 'PUT',
            headers: session.headers,
            body: JSON.stringify({ id: 'same-id', name, address: 'http://internal:5000' }),
          })
        ).status,
      ).toBe(200)
    await f.request('/v1/servers/same-id', { method: 'DELETE', headers: a.headers })
    expect((await (await f.request('/v1/servers', { headers: a.headers })).json()).servers).toEqual(
      [],
    )
    expect(
      (await (await f.request('/v1/servers', { headers: b.headers })).json()).servers[0].name,
    ).toBe('Second')
  })
  it('rejects missing browser state, cross-origin confirmation, expiry and cancelled login', async () => {
    const f = await fixture(),
      login = await f.login()
    expect((await f.request('/auth/callback?state=verified-state&code=x')).status).toBe(400)
    const start = await f.request('/auth/start?id=' + login.id),
      cookie = start.headers.get('set-cookie')!.split(';')[0]
    expect(
      (
        await f.request('/auth/authorize', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: 'https://attacker.test' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await f.request('/auth/callback?state=wrong&code=x', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(400)
    f.advance(300_001)
    expect((await f.request('/auth/start?id=' + login.id)).status).toBe(410)
    expect((await f.request('/v1/login', { headers: login.headers })).status).toBe(401)
    const cancelled = await f.login()
    await f.request('/v1/session', { method: 'DELETE', headers: cancelled.headers })
    expect((await f.request('/auth/start?id=' + cancelled.id)).status).toBe(410)
  })
  it('persists session and directory metadata across reopening the database', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = mkdtempSync(join(tmpdir(), 'dovo-account-'))
    resources.push(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, 'db.sqlite'),
      a = new AccountStore(path),
      { login, token } = a.createLogin()
    a.approve(login, { id: 'person', name: 'Person' })
    a.link('person', { id: 'server', name: 'My server', address: 'http://vpn:5000' })
    a.db.close()
    const b = new AccountStore(path)
    resources.push(() => b.db.close())
    expect(b.directory(token)?.servers[0].id).toBe('server')
    expect(b.db.prepare('SELECT token FROM sessions').get()?.token).toBe(hash(token))
  })
})
