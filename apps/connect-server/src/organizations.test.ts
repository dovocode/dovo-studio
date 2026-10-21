import { afterEach, expect, it } from 'vite-plus/test'
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { once } from 'node:events'
import { internetPublicKey, internetRegistrationPayload } from '@dovo/protocol'
import { organizations } from './organizations.js'
import { AccountStore, hash } from './store.js'
import { createConnectServer } from './server.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const turnSecret = 'test-organization-coturn-secret-1234567890'
const definition = {
  id: 'company',
  name: 'Company',
  issuer: 'https://sso.example.com/tenant',
  clientId: 'dovo',
  requiredClaim: { name: 'groups', values: ['relay-users'] },
  relay: { urls: ['turn:relay.example.com'], secret: turnSecret },
}

it('validates administrator organization configuration and detects authorization policy changes', () => {
  const [org] = organizations([definition], 'https://connect.test')
  expect(org?.provider.authorizationOrigin).toBe('https://sso.example.com')
  expect(
    organizations([{ ...definition, clientId: 'another' }], 'https://connect.test')[0]?.policy,
  ).not.toBe(org?.policy)
  expect(
    organizations(
      [{ ...definition, relay: { ...definition.relay, secret: turnSecret + 'rotated' } }],
      'https://connect.test',
    )[0]?.policy,
  ).toBe(org?.policy)
  for (const value of [
    [definition, definition],
    [{ ...definition, issuer: 'http://untrusted.test' }],
    [{ ...definition, endpointOrigins: ['https://other.test/path'] }],
    [{ ...definition, sessionHours: 24 }],
    [{ ...definition, relay: { ...definition.relay, secret: 'short' } }],
  ])
    expect(() => organizations(value, 'https://connect.test')).toThrow(
      /Organization|OIDC|HTTPS|sessionHours|relay/,
    )
})

it('binds browser selection to organization login and auto-distributes scoped TURN credentials with host grants', async () => {
  const store = new AccountStore(':memory:')
  cleanup.push(() => store.db.close())
  const [org] = organizations([definition], 'https://connect.test')
  if (!org) throw new Error('Missing organization')
  org.provider = {
    authorizationOrigin: 'https://sso.example.com',
    authorize: async (login) => {
      login.state = 'company-state'
      return 'https://sso.example.com/authorize'
    },
    exchange: async () => ({
      id: 'oidc:company:member',
      name: 'Member',
      organization: { id: org.id, name: org.name, policy: org.policy },
      sessionExpiresAt: Date.now() + 3600_000,
    }),
  }
  const server = createConnectServer({
    store,
    origin: 'https://connect.test',
    organizations: [org],
    authorizationOrigin: 'https://auth.test',
    authorize: async () => {
      throw new Error('Wrong provider')
    },
    exchange: async () => {
      throw new Error('Wrong provider')
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('Missing port')
  const request = (path: string, init?: RequestInit) =>
    fetch('http://127.0.0.1:' + bound.port + path, { redirect: 'manual', ...init })
  const { login, token } = store.createLogin()
  const start = await request('/auth/start?id=' + login.id)
  expect(await start.text()).toContain('Sign in with Company SSO')
  const cookie = start.headers.get('set-cookie')!.split(';')[0]!
  const headers = { Cookie: cookie, Origin: 'https://connect.test' }
  expect(
    (await request('/auth/authorize?organization=untrusted', { method: 'POST', headers })).status,
  ).toBe(400)
  expect(
    (
      await request('/auth/authorize?organization=company', { method: 'POST', headers })
    ).headers.get('location'),
  ).toBe('https://sso.example.com/authorize')
  expect(
    (await request('/auth/callback?state=wrong&code=code', { headers: { Cookie: cookie } })).status,
  ).toBe(400)
  expect(
    (await request('/auth/callback?state=company-state&code=code', { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200)
  expect(store.directory(token)?.user.organization).toEqual({ id: org.id, name: org.name })
  const keys = generateKeyPairSync('ed25519')
  const identity = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const registration = {
    id: 'paired-server',
    name: 'Paired server',
    identity,
    publicKey: internetPublicKey(randomBytes(32)),
    timestamp: Date.now(),
  }
  const signature = sign(
    null,
    Buffer.from(internetRegistrationPayload('https://connect.test', hash(token), registration)),
    keys.privateKey,
  ).toString('base64url')
  const result = await request('/v1/internet/hosts', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...registration, signature }),
  })
  const grantResult: unknown = await result.json()
  if (
    !grantResult ||
    typeof grantResult !== 'object' ||
    !('grant' in grantResult) ||
    typeof grantResult.grant !== 'string'
  )
    throw new Error('Missing grant')
  const hostHeaders = { Authorization: 'Bearer ' + grantResult.grant }
  const inbox = await request('/v1/internet/host', { headers: hostHeaders })
  const policy = (await inbox.json()) as {
    organizationRelay: {
      name: string
      relay: {
        provider: string
        expiresAt: number
        iceServers: Array<{ urls: string[]; username: string; credential: string }>
      }
    }
  }
  expect(policy.organizationRelay.name).toBe('Company')
  expect(policy.organizationRelay.relay.provider).toBe('custom')
  const credentials = policy.organizationRelay.relay.iceServers[0]!
  expect(credentials.urls).toEqual(['turn:relay.example.com:3478?transport=udp'])
  expect(credentials.credential).toBe(
    createHmac('sha1', turnSecret).update(credentials.username).digest('base64'),
  )
  expect(JSON.stringify(policy)).not.toContain(turnSecret)
  expect((await request('/v1/servers', { headers: hostHeaders })).status).toBe(401)
  // No organization policy is attached to a personal session, even if names match.
  const personal = store.createLogin()
  store.approve(personal.login, { id: 'personal', name: 'Member' })
  expect(store.directory(personal.token)?.user.organization).toBeUndefined()
  org.issue = async () => {
    throw new Error('Quota exceeded')
  }
  const unavailable = await request('/v1/internet/host', { headers: hostHeaders })
  expect(unavailable.status).toBe(200)
  expect(await unavailable.json()).toMatchObject({
    organizationRelay: { name: 'Company', unavailable: true },
  })
  expect(store.sessionUser(token)).toBe('oidc:company:member')
  store.revoke(token)
  expect((await request('/v1/internet/host', { headers: hostHeaders })).status).toBe(401)
})

it('invalidates organization sessions when configuration changes and honors bounded expiry', () => {
  let now = Date.now()
  const store = new AccountStore(':memory:', () => now)
  try {
    store.configureOrganizations(new Map([['company', 'v1']]))
    const member = store.createLogin()
    store.approve(member.login, {
      id: 'member',
      name: 'Member',
      organization: { id: 'company', name: 'Company', policy: 'v1' },
      sessionExpiresAt: now + 900_000,
    })
    expect(store.sessionUser(member.token)).toBe('member')
    now += 900_001
    expect(store.sessionUser(member.token)).toBeUndefined()
    const renewed = store.createLogin()
    store.approve(renewed.login, {
      id: 'member',
      name: 'Member',
      organization: { id: 'company', name: 'Company', policy: 'v1' },
      sessionExpiresAt: now + 900_000,
    })
    store.configureOrganizations(new Map([['company', 'v2']]))
    expect(store.sessionUser(renewed.token)).toBeUndefined()
  } finally {
    store.db.close()
  }
})
