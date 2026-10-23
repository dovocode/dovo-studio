import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { ArtifactStore } from '../../artifact-server/src/store.js'
import { createArtifactServer } from '../../artifact-server/src/server.js'
import { createAuth } from '../../auth-server/src/auth.js'
import { createAuthServer } from '../../auth-server/src/server.js'
import { ownerMappings } from '../../auth-server/src/owners.js'
import { remoteIdentity } from './remote-identity.js'
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
  const authIngress = createServer((req, res) => authApp?.emit('request', req, res))
  let authApp: ReturnType<typeof createAuthServer> | undefined
  authIngress.listen(0, '127.0.0.1')
  await once(authIngress, 'listening')
  const authAddress = authIngress.address()
  if (!authAddress || typeof authAddress === 'string') throw new Error('Missing auth address')
  const authOrigin = `http://127.0.0.1:${authAddress.port}`
  const clientSecret = 'test-connect-client-secret-at-least-thirty-two-characters'
  const serviceKey = randomBytes(32).toString('base64url')
  const identity = await createAuth({
    path: ':memory:',
    origin: authOrigin,
    secret: 'test-secret-with-at-least-thirty-two-characters',
    github: { clientId: 'test-github-client', clientSecret: 'test-github-secret' },
    owners: { '123': 'existing-owner' },
    connectOrigin: origin,
    clientId: 'dovo-connect',
    clientSecret,
  })
  authApp = createAuthServer(identity, { origin: authOrigin, serviceKey })
  const provider = remoteIdentity({
    issuer: authOrigin + '/api/auth',
    origin,
    clientId: 'dovo-connect',
    clientSecret,
    serviceKey,
  })
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        authIngress.close(() => resolve())
        authIngress.closeAllConnections()
      }),
  )
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
    ...provider,
    store,
    origin,
    artifacts: { origin: 'https://artifacts.test', key: serviceKey },
  })
  const cookies = new Map<string, string>()
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'text/html')
    headers.set('sec-fetch-mode', 'navigate')
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '))
    const response = await fetch(path.startsWith('http:') ? path : origin + path, {
      ...init,
      redirect: 'manual',
      headers,
    })
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
      if (!url.startsWith(origin + '/') && !url.startsWith(authOrigin + '/'))
        throw new Error('Unexpected external request')
      return realFetch(input, init)
    }),
  )
  async function login(artifacts = false, beforeComplete?: () => void) {
    const { login, token } = store.createLogin(artifacts ? 'https://artifacts.test' : undefined)
    expect((await request(`/auth/start?id=${login.id}`)).status).toBe(200)
    const authorize = await request('/auth/authorize', {
      method: 'POST',
      headers: { Origin: origin },
    })
    expect(authorize.status).toBe(303)
    const oidc = new URL(authorize.headers.get('location')!)
    expect(oidc.origin).toBe(authOrigin)
    const authorization = await request(oidc.href)
    expect([200, 302]).toContain(authorization.status)
    const signIn = new URL(
      authorization.headers.get('location') ?? (await authorization.json()).url,
      authOrigin,
    )
    let returned = signIn
    if (signIn.origin === authOrigin) {
      expect((await request(signIn.href)).status).toBe(200)
      const github = await request(signIn.href, { method: 'POST', headers: { Origin: authOrigin } })
      expect(github.status).toBe(303)
      const url = new URL(github.headers.get('location')!)
      expect(url.origin).toBe('https://github.com')
      const callback = await request(
        `${authOrigin}/api/auth/callback/github?state=${url.searchParams.get('state')}&code=test-code`,
      )
      expect(callback.status).toBe(302)
      returned = new URL(callback.headers.get('location')!, authOrigin)
    }
    // Better Auth resumes the saved OIDC authorization after GitHub creates its session.
    for (let step = 0; returned.origin === authOrigin && step < 5; step++) {
      const response = await request(returned.href)
      expect([200, 302, 303]).toContain(response.status)
      returned = new URL(
        response.headers.get('location') ?? (await response.json()).url,
        authOrigin,
      )
    }
    expect(returned.origin).toBe(origin)
    const completion = returned
    expect(completion.pathname).toBe('/auth/callback')
    beforeComplete?.()
    const result = await request(completion.pathname + completion.search)
    if (!beforeComplete) expect(result.status).toBe(200)
    return { token, completion, result }
  }
  return {
    store,
    identity,
    authOrigin,
    origin,
    serviceKey,
    realFetch,
    provider,
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
  expect(f.store.directory(token)?.user.name).toBe('Verified User')
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
  ).toBe(502)
})

it('does not map another GitHub subject to the existing owner', async () => {
  const f = await fixture()
  f.subject(456)
  const { token } = await f.login()
  expect(f.store.directory(token)?.user.id).toMatch(/^auth:/)
  expect(f.store.directory(token)?.user.id).not.toBe('existing-owner')
})

it('rejects unauthenticated identity deletion on the separate service', async () => {
  const f = await fixture()
  await f.login()
  expect(
    (await f.request(f.authOrigin + '/internal/identities/existing-owner', { method: 'DELETE' }))
      .status,
  ).toBe(401)
  expect(f.identity.db.prepare('SELECT count(*) AS n FROM user').get()?.n).toBe(1)
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

it('refuses a pending authorization code after the auth browser session is revoked', async () => {
  const f = await fixture()
  const { token, result } = await f.login(false, () => {
    f.identity.db.prepare('DELETE FROM session').run()
  })
  expect(result.status).toBe(502)
  expect(f.store.directory(token)).toBeUndefined()
})

it('does not host Better Auth endpoints on Connect', async () => {
  const f = await fixture()
  expect((await f.request('/api/auth/get-session')).status).toBe(401)
  expect((await f.request(f.authOrigin + '/sign-in?client_id=attacker')).status).toBe(400)
  expect(
    (await f.request(f.authOrigin + '/resume?redirect_uri=https://attacker.test')).status,
  ).toBe(400)
})

it('checks the auth-page origin and rejects tampered signed login destinations', async () => {
  const f = await fixture()
  const { login } = f.store.createLogin()
  const oidc = await f.provider.authorize(login)
  const response = await f.request(oidc)
  const destination = response.headers.get('location') ?? (await response.json()).url
  const signIn = new URL(destination, f.authOrigin)
  expect(
    (await f.request(signIn.href, { method: 'POST', headers: { Origin: 'https://attacker.test' } }))
      .status,
  ).toBe(403)
  signIn.searchParams.set('redirect_uri', 'https://attacker.test/callback')
  expect((await f.request(signIn.href)).status).toBe(400)
})

it('preserves publications, invitations, links and existing grants through Connect identity migration', async () => {
  const f = await fixture()
  const artifacts = new ArtifactStore(':memory:')
  cleanup.push(() => artifacts.db.close())
  const oldOwner = f.store.createLogin()
  f.store.approve(oldOwner.login, { id: 'existing-owner', name: 'Previous owner' })
  const invited = f.store.createLogin()
  f.store.approve(invited.login, { id: 'existing-recipient', name: 'Recipient' })
  const publication = artifacts.publish('existing-owner', {
    sourceId: randomUUID(),
    revision: 1,
    title: 'Before migration',
    format: 'html',
    content: '<p>Saved report</p>',
  })
  artifacts.invite(publication.id, 'existing-owner', 'existing-recipient')
  const link = artifacts.link(publication.id, 'existing-owner', 3600)
  const grant = (token: string) => {
    const result = f.store.artifactGrant(token, 'https://artifacts.test')
    if (!result) throw new Error('Missing grant')
    return result.token
  }
  const oldGrant = grant(oldOwner.token)
  const recipientGrant = grant(invited.token)
  const server = createArtifactServer({
    store: artifacts,
    origin: 'https://artifacts.test',
    connectOrigin: f.origin,
    serviceKey: f.serviceKey,
    viewerScript: '',
  }).server
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing artifact port')
  const path = `http://127.0.0.1:${address.port}/v1/publications/${publication.id}`
  const read = (suffix = '', token?: string, share = false) =>
    f.realFetch(path + suffix, {
      headers: token ? { Authorization: (share ? 'DovoShare ' : 'Bearer ') + token } : {},
    })
  const migrated = await f.login(true)
  expect(f.store.artifactSession(migrated.token)?.user.id).toBe('existing-owner')
  expect(f.store.directory(migrated.token)).toBeUndefined()
  const access = await read('/access', migrated.token)
  expect(access.status).toBe(200)
  expect(await access.json()).toMatchObject({
    invites: [{ userId: 'existing-recipient' }],
    links: [{ id: link.id }],
  })
  expect((await read('', oldGrant)).status).toBe(200)
  expect((await read('', recipientGrant)).status).toBe(200)
  expect((await read('', link.token, true)).status).toBe(200)
  expect((await read('/access', recipientGrant)).status).toBe(404)
  f.cookies.clear()
  f.subject(456)
  const unrelated = await f.login(true)
  expect((await read('', unrelated.token)).status).toBe(404)
  expect((await read('/access', unrelated.token)).status).toBe(404)
  f.store.revoke(oldOwner.token)
  expect(f.store.artifactSession(oldGrant)).toBeUndefined()
  expect((await read('', oldGrant)).status).toBe(404)
  expect((await read('/access', migrated.token)).status).toBe(200)
  expect((await read('', recipientGrant)).status).toBe(200)
  expect((await read('', link.token, true)).status).toBe(200)
})
