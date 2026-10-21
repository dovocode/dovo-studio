import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { hostedAuth, ownerMappings } from './hosted-auth.js'
import { AccountStore } from './store.js'
import { createConnectServer } from './server.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture() {
  let app: ReturnType<typeof createConnectServer> | undefined
  const ingress = createServer((req, res) => app?.emit('request', req, res))
  ingress.listen(0, '127.0.0.1')
  await once(ingress, 'listening')
  const address = ingress.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const origin = `http://127.0.0.1:${address.port}`
  const store = new AccountStore(':memory:')
  const identity = await hostedAuth({
    path: ':memory:',
    origin,
    secret: 'test-secret-with-at-least-thirty-two-characters',
    github: { clientId: 'test-github-client', clientSecret: 'test-github-secret' },
    owners: { '123': 'existing-owner' },
  })
  cleanup.push(() => {
    identity.close()
    store.db.close()
  })
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        ingress.close(() => resolve())
        ingress.closeAllConnections()
        app?.closeAllConnections()
      }),
  )
  app = createConnectServer({
    ...identity,
    store,
    origin,
    identityHandler: identity.handle,
    deleteIdentity: identity.deleteIdentity,
  })
  const cookies = new Map<string, string>()
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '))
    const response = await fetch(origin + path, { ...init, redirect: 'manual', headers })
    for (const header of response.headers.getSetCookie()) {
      const [key, ...value] = header.split(';')[0]!.split('=')
      cookies.set(key!, value.join('='))
    }
    return response
  }
  let subject = 123
  const realFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({
          access_token: 'github-test-token',
          token_type: 'bearer',
          scope: 'read:user,user:email',
        })
      if (url === 'https://api.github.com/user')
        return Response.json({
          id: subject,
          login: `test-${subject}`,
          name: 'Verified User',
          email: `${subject}@example.test`,
          avatar_url: '',
        })
      if (url === 'https://api.github.com/user/emails')
        return Response.json([{ email: `${subject}@example.test`, verified: true, primary: true }])
      if (!url.startsWith(origin + '/')) throw new Error('Unexpected external request')
      return realFetch(input, init)
    }),
  )
  async function login(artifacts = false) {
    const { login, token } = store.createLogin(artifacts ? 'https://artifacts.test' : undefined)
    expect((await request(`/auth/start?id=${login.id}`)).status).toBe(200)
    const authorize = await request('/auth/authorize', {
      method: 'POST',
      headers: { Origin: origin },
    })
    expect(authorize.status).toBe(303)
    const url = new URL(authorize.headers.get('location')!)
    expect(url.origin).toBe('https://github.com')
    expect(store.login(login.id)?.identityCookies).toBeUndefined()
    const callback = await request(
      `/api/auth/callback/github?state=${url.searchParams.get('state')}&code=test-code`,
    )
    expect(callback.status).toBe(302)
    const completion = new URL(callback.headers.get('location')!, origin)
    expect(completion.pathname).toBe('/auth/callback')
    const result = await request(completion.pathname + completion.search)
    expect(result.status).toBe(200)
    return { token, completion }
  }
  return {
    store,
    identity,
    request,
    login,
    cookies,
    subject: (id: number) => {
      subject = id
    },
  }
}

it('completes GitHub sign-in with browser-bound consent and retains explicitly mapped ownership', async () => {
  const f = await fixture()
  const { token, completion } = await f.login()
  expect(f.store.directory(token)?.user.id).toBe('existing-owner')
  expect((await f.request(completion.pathname + completion.search)).status).toBe(400)
  expect((await f.request('/v1/servers')).status).toBe(401) // Browser session is not a runtime/account capability.
  f.store.revoke(token)
  expect(f.store.directory(token)).toBeUndefined()
})

it('keeps artifact-only sign-in scoped and deletes the hosted identity along with its grants', async () => {
  const f = await fixture()
  const { token } = await f.login(true)
  expect(f.store.directory(token)).toBeUndefined()
  expect(f.store.artifactSession(token)?.user.id).toBe('existing-owner')
  const normal = await f.login()
  const deleted = await f.request('/v1/account', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + normal.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE', userId: 'some-other-user' }),
  })
  expect(deleted.status).toBe(200)
  expect(f.store.artifactSession(token)).toBeUndefined()
  expect(f.store.directory(normal.token)).toBeUndefined()
  expect(f.identity.db.prepare('SELECT count(*) AS n FROM user').get()?.n).toBe(0)
  expect(f.identity.db.prepare('SELECT count(*) AS n FROM account').get()?.n).toBe(0)
  expect(f.identity.db.prepare('SELECT count(*) AS n FROM session').get()?.n).toBe(0)
})

it('rejects cross-origin consent and completion without a hosted browser session', async () => {
  const f = await fixture()
  const { login } = f.store.createLogin()
  await f.request(`/auth/start?id=${login.id}`)
  expect(
    (
      await f.request('/auth/authorize', {
        method: 'POST',
        headers: { Origin: 'https://attacker.test' },
      })
    ).status,
  ).toBe(403)
  await f.request('/auth/authorize', {
    method: 'POST',
    headers: { Origin: new URL((await f.request('/health')).url).origin },
  })
  const pending = f.store.login(login.id)!
  expect(
    (await f.request(`/auth/callback?state=${pending.state}&code=${pending.verifier}`)).status,
  ).toBe(401)
})

it('does not map another GitHub subject to the existing owner', async () => {
  const f = await fixture()
  f.subject(456)
  const { token } = await f.login()
  expect(f.store.directory(token)?.user.id).toMatch(/^auth:/)
  expect(f.store.directory(token)?.user.id).not.toBe('existing-owner')
})

it('rejects a revoked hosted browser session even if its signed cookie remains', async () => {
  const f = await fixture()
  await f.login()
  const pending = f.store.createLogin().login
  pending.verifier = 'pending-code'
  const headers = { cookie: [...f.cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
  await expect(f.identity.exchange(pending, 'wrong-code', headers)).rejects.toThrow('did not match')
  f.identity.db.prepare('DELETE FROM session').run()
  await expect(f.identity.exchange(pending, pending.verifier, headers)).rejects.toThrow(
    'Sign in again',
  )
})

it('validates explicit ownership mappings without email or display-name matching', () => {
  expect(ownerMappings([{ githubId: '123', accountId: 'old-owner' }])).toEqual({
    '123': 'old-owner',
  })
  for (const value of [
    null,
    {},
    [{ githubId: '__proto__', accountId: 'owner' }],
    [{ githubId: '123', accountId: '' }],
    [
      { githubId: '123', accountId: 'one' },
      { githubId: '123', accountId: 'two' },
    ],
    [
      { githubId: '123', accountId: 'one' },
      { githubId: '456', accountId: 'one' },
    ],
  ])
    expect(() => ownerMappings(value)).toThrow('mapping')
})

it('sets secure HttpOnly OAuth cookies on the hosted production origin', async () => {
  const identity = await hostedAuth({
    path: ':memory:',
    origin: 'https://connect.example.test',
    secret: 'test-only-thirty-two-character-or-longer-secret',
    github: { clientId: 'test-client', clientSecret: 'test-secret' },
  })
  cleanup.push(() => identity.close())
  const store = new AccountStore(':memory:')
  cleanup.push(() => store.db.close())
  const { login } = store.createLogin()
  await identity.authorize(login)
  expect(login.identityCookies?.length).toBeGreaterThan(0)
  for (const cookie of login.identityCookies ?? []) {
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toMatch(/SameSite=Lax/i)
  }
})
