import { afterEach, expect, it } from 'vite-plus/test'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  artifactPublicationResponseSchema,
  artifactViewSchema,
  decode,
  SharingClient,
  encryptSuggestion,
  sharingReaderKeys,
  type AccountStorage,
} from '@dovo/protocol'
import { AccountStore } from '../../connect-server/src/store.js'
import { createConnectServer } from '../../connect-server/src/server.js'
import { ArtifactStore } from './store.js'
import { createArtifactServer } from './server.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function listen(server: Server) {
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
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  return 'http://127.0.0.1:' + address.port
}
async function fixture() {
  let now = Date.now()
  const accounts = new AccountStore(':memory:', () => now),
    store = new ArtifactStore(':memory:', () => now)
  cleanup.push(
    () => accounts.db.close(),
    () => store.db.close(),
  )
  const serviceKey = randomBytes(32).toString('base64url'),
    origin = 'https://artifacts.test'
  let broker: Server
  let ownerResponse: { status: number; body: unknown } | undefined
  const connectOrigin = await listen(
    createServer((req, res) => {
      if (ownerResponse && req.url === '/v1/artifacts/owners') {
        res.writeHead(ownerResponse.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ownerResponse.body))
        return
      }
      broker.emit('request', req, res)
    }),
  )
  broker = createConnectServer({
    store: accounts,
    origin: connectOrigin,
    artifacts: { origin, key: serviceKey },
    authorizationOrigin: 'https://sso.test',
    authorize: async () => 'https://sso.test',
    exchange: async () => ({ id: 'unused', name: 'Unused' }),
  })
  const app = createArtifactServer({ store, origin, connectOrigin, serviceKey, viewerScript: '' })
  const address = await listen(app.server)
  const login = (id: string) => {
    const result = accounts.createLogin()
    accounts.approve(result.login, { id, name: id })
    return result.token
  }
  const owner = login('owner'),
    invited = login('invited'),
    stranger = login('stranger')
  const grant = (token: string) => {
    const value = accounts.artifactGrant(token, origin)
    if (!value) throw new Error('Missing test grant')
    return value.token
  }
  const request = (
    path: string,
    method = 'GET',
    data?: unknown,
    token?: string,
    headers?: Record<string, string>,
  ) =>
    fetch(address + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
  const input = {
    sourceId: randomUUID(),
    revision: 1,
    title: 'Private report',
    format: 'html',
    content: '<h1>Private report</h1>',
  }
  const publish = async (data = input) => {
    const response = await request('/v1/publications', 'POST', data, grant(owner))
    expect(response.status).toBe(200)
    return decode(artifactPublicationResponseSchema, await response.json()).publication
  }
  return {
    accounts,
    store,
    owner,
    invited,
    stranger,
    grant,
    request,
    input,
    publish,
    app,
    origin,
    connectOrigin,
    serviceKey,
    ownerResponse: (response?: { status: number; body: unknown }) => {
      ownerResponse = response
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

it('serves the shared, keyboard-accessible hosted artifact shell', async () => {
  const f = await fixture()
  const page = await f.request('/')
  expect(page.status).toBe(200)
  const markup = await page.text()
  expect(markup).toContain('<meta name="color-scheme" content="dark">')
  expect(markup).toContain('--dovo-background:#080808;')
  expect(markup).toContain('--dovo-card:#101010;')
  expect(markup).toContain('--dovo-muted-foreground:#a1a1a1;')
  expect(markup).toContain('--dovo-border:#202020;')
  expect(markup).toContain('--dovo-primary:#7cc9ff;')
  expect(markup).toContain('--radius-md: var(--dovo-radius-control)')
  expect(markup).toContain('focus-visible\\:outline-ring')
  expect(markup).toContain('id="app"')
  expect(markup).toContain('id="status" role="status" aria-live="polite"')
  expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline'")
  expect(page.headers.get('Content-Security-Policy')).toContain("style-src 'unsafe-inline'")
})

it('publishes private, immutable, idempotent copies and grants only explicitly invited accounts', async () => {
  const f = await fixture(),
    owner = f.grant(f.owner),
    invited = f.grant(f.invited),
    stranger = f.grant(f.stranger)
  const publication = await f.publish(),
    path = '/v1/publications/' + publication.id
  expect((await f.publish()).id).toBe(publication.id)
  expect(
    (await f.request('/v1/publications', 'POST', { ...f.input, content: 'Changed' }, owner)).status,
  ).toBe(409)
  expect((await f.request(path)).status).toBe(404)
  expect((await f.request(path, 'GET', undefined, stranger)).status).toBe(404)
  expect((await f.request(path + '/access', 'GET', undefined, stranger)).status).toBe(404)
  expect((await f.request(path + '/invites', 'POST', { userId: 'invited' }, stranger)).status).toBe(
    404,
  )
  expect((await f.request(path + '/invites', 'POST', { userId: 'invited' }, owner)).status).toBe(
    200,
  )
  const viewed = await f.request(path, 'GET', undefined, invited)
  expect(viewed.status).toBe(200)
  const value = decode(artifactViewSchema, await viewed.json())
  expect(value.owner).toBe(false)
  expect(value.content).toContain('Private report')
  expect(value.content).toContain("connect-src 'none'")
  expect(JSON.stringify(value)).not.toMatch(/sourceId|taskId|runtimeId|owner-token/)
  expect((await f.request(path, 'DELETE', undefined, invited)).status).toBe(404)
  await f.request(path + '/invites', 'DELETE', { userId: 'invited' }, owner)
  expect((await f.request(path, 'GET', undefined, invited)).status).toBe(404)
})
it('returns source IDs only in the signed-in owners publication index', async () => {
  const f = await fixture()
  const publication = await f.publish()
  expect((await f.request('/v1/publications/sources')).status).toBe(401)
  const own = await f.request('/v1/publications/sources', 'GET', undefined, f.grant(f.owner))
  expect(await own.json()).toEqual({
    publications: [{ ...publication, sourceId: f.input.sourceId }],
  })
  const invitation = await f.request(
    '/v1/publications/' + publication.id + '/invites',
    'POST',
    { userId: 'invited' },
    f.grant(f.owner),
  )
  expect(invitation.status).toBe(200)
  expect(
    (await f.request('/v1/publications/' + publication.id, 'GET', undefined, f.grant(f.invited)))
      .status,
  ).toBe(200)
  const invited = await f.request('/v1/publications/sources', 'GET', undefined, f.grant(f.invited))
  expect(await invited.json()).toEqual({ publications: [] })
  const ordinary = await f.request('/v1/publications', 'GET', undefined, f.grant(f.owner))
  expect(JSON.stringify(await ordinary.json())).not.toContain('sourceId')
  await f.request('/v1/publications/' + publication.id, 'DELETE', undefined, f.grant(f.owner))
  const deleted = await f.request('/v1/publications/sources', 'GET', undefined, f.grant(f.owner))
  expect(await deleted.json()).toEqual({ publications: [] })
})

it('keeps link tokens hashed, publication-bound, expiring and independently revocable', async () => {
  const f = await fixture(),
    owner = f.grant(f.owner),
    publication = await f.publish()
  const other = await f.publish({ ...f.input, sourceId: randomUUID() }),
    path = '/v1/publications/' + publication.id
  const issued = await f.request(path + '/links', 'POST', { seconds: 3600 }, owner)
  const link = (await issued.json()) as { id: string; token: string; url: string }
  expect(link.url).toBe(f.origin + '/s/' + publication.id + '#share=' + link.token)
  expect(JSON.stringify(f.store.db.prepare('SELECT * FROM links').all())).not.toContain(link.token)
  const headers = { Authorization: 'DovoShare ' + link.token }
  expect((await f.request(path, 'GET', undefined, undefined, headers)).status).toBe(200)
  expect(
    (await f.request('/v1/publications/' + other.id, 'GET', undefined, undefined, headers)).status,
  ).toBe(404)
  expect((await f.request(path + '/access', 'GET', undefined, undefined, headers)).status).toBe(401)
  await f.request(path + '/links/' + link.id, 'DELETE', undefined, owner)
  expect((await f.request(path, 'GET', undefined, undefined, headers)).status).toBe(404)
  const expiring = f.store.link(publication.id, 'owner', 3600)
  f.advance(3600_001)
  expect(
    (
      await f.request(path, 'GET', undefined, undefined, {
        Authorization: 'DovoShare ' + expiring.token,
      })
    ).status,
  ).toBe(404)
})

it('rejects full account tokens, cross-service grants, revoked parents and expired scoped sessions', async () => {
  const f = await fixture(),
    publication = await f.publish(),
    path = '/v1/publications/' + publication.id
  expect((await f.request(path, 'GET', undefined, f.owner)).status).toBe(404)
  expect((await f.request('/v1/publications', 'POST', f.input, f.owner)).status).toBe(401)
  const scoped = f.grant(f.owner)
  expect(
    (
      await fetch(f.connectOrigin + '/v1/servers', {
        headers: { Authorization: 'Bearer ' + scoped },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(f.connectOrigin + '/v1/internet/connections?id=any', {
        headers: { Authorization: 'Bearer ' + scoped },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(f.connectOrigin + '/v1/internet/host', {
        headers: { Authorization: 'Bearer ' + scoped },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(f.connectOrigin + '/v1/push/servers', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + scoped },
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(f.connectOrigin + '/v1/artifacts/session', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + scoped },
      })
    ).status,
  ).toBe(401)
  const different = f.accounts.artifactGrant(f.owner, 'https://other.test')
  expect((await f.request('/v1/me', 'GET', undefined, different?.token)).status).toBe(401)
  f.accounts.revoke(f.owner)
  expect((await f.request('/v1/me', 'GET', undefined, scoped)).status).toBe(401)
  const other = f.grant(f.invited)
  f.advance(600_001)
  expect((await f.request('/v1/me', 'GET', undefined, other)).status).toBe(401)
})

it('requires same-origin cookie mutations, enforces quotas and deletes hosted copies after account deletion', async () => {
  const f = await fixture(),
    owner = f.grant(f.owner),
    publication = await f.publish(),
    path = '/v1/publications/' + publication.id
  const cookie = { Cookie: 'dovo-artifacts=' + owner, Origin: 'https://evil.test' }
  expect(
    (await f.request(path + '/invites', 'POST', { userId: 'stranger' }, undefined, cookie)).status,
  ).toBe(403)
  expect(
    (
      await f.request(path + '/invites', 'POST', { userId: 'stranger' }, undefined, {
        ...cookie,
        Authorization: 'bad',
      })
    ).status,
  ).toBe(403)
  const issued = f.store.link(publication.id, 'owner', 3600)
  f.accounts.deleteAccount('owner')
  expect(
    (
      await f.request(path, 'GET', undefined, undefined, {
        Authorization: 'DovoShare ' + issued.token,
      })
    ).status,
  ).toBe(404)
  expect(f.store.list('owner')).toEqual([])
  const tiny = new ArtifactStore(':memory:', Date.now, 10, 20)
  cleanup.push(() => tiny.db.close())
  expect(() => tiny.publish('owner', { ...f.input, format: 'html' })).toThrow(/quota/)
})

it('uses isolated browser sign-ins that cannot grant computer access', async () => {
  const f = await fixture()
  const response = await f.request('/auth/start', 'POST', {}, undefined, { Origin: f.origin })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')
  expect(cookie).toMatch(/__Host-dovo-artifacts=.*HttpOnly; SameSite=Lax.*Secure/)
  const login = f.accounts.db.prepare('SELECT value FROM logins ORDER BY rowid DESC LIMIT 1').get()
  if (typeof login?.value !== 'string') throw new Error('Missing pending browser login')
  const pending = f.accounts.login(JSON.parse(login.value).id)
  if (!pending) throw new Error('Missing scoped login')
  expect(pending.artifactsOrigin).toBe(f.origin)
  f.accounts.approve(pending, { id: 'viewer', name: 'Viewer' })
  const token = cookie?.match(/__Host-dovo-artifacts=([A-Za-z0-9_-]{43})/)?.[1]
  expect(f.accounts.sessionUser(token ?? '')).toBeUndefined()
  expect(f.accounts.artifactSession(token ?? '')?.user.id).toBe('viewer')
  expect((await f.request('/v1/me', 'GET', undefined, token)).status).toBe(200)
})

it('fails closed during account outages or malformed owner replies without deleting publications', async () => {
  const f = await fixture(),
    publication = await f.publish()
  const link = f.store.link(publication.id, 'owner', 3600)
  const view = () =>
    f.request('/v1/publications/' + publication.id, 'GET', undefined, undefined, {
      Authorization: 'DovoShare ' + link.token,
    })
  for (const response of [
    { status: 503, body: { error: 'Unavailable' } },
    { status: 200, body: [] },
    { status: 200, body: [{ id: 'different-owner', active: false }] },
    {
      status: 200,
      body: [
        { id: 'owner', active: false },
        { id: 'owner', active: false },
      ],
    },
  ]) {
    f.ownerResponse(response)
    expect((await view()).status).toBe(503)
    await expect(f.app.pruneOwners()).rejects.toThrow(
      /Account service unavailable|Invalid account status response/,
    )
    expect(f.store.list('owner')).toHaveLength(1)
  }
  f.ownerResponse()
  expect((await view()).status).toBe(200)
})

it('invalidates scoped organization sessions and derived grants on policy changes and shorter SSO expiry', async () => {
  const f = await fixture()
  f.accounts.configureOrganizations(new Map([['company', 'policy-one']]))
  const organization = { id: 'company', name: 'Company', policy: 'policy-one' }
  const parent = f.accounts.createLogin(),
    browser = f.accounts.createLogin(f.origin)
  f.accounts.approve(parent.login, { id: 'company-user', name: 'Company user', organization })
  f.accounts.approve(browser.login, { id: 'company-user', name: 'Company user', organization })
  const derived = f.grant(parent.token)
  expect((await f.request('/v1/me', 'GET', undefined, browser.token)).status).toBe(200)
  expect((await f.request('/v1/me', 'GET', undefined, derived)).status).toBe(200)
  f.accounts.configureOrganizations(new Map([['company', 'policy-two']]))
  expect((await f.request('/v1/me', 'GET', undefined, browser.token)).status).toBe(401)
  expect((await f.request('/v1/me', 'GET', undefined, derived)).status).toBe(401)
  const short = f.accounts.createLogin(f.origin)
  f.accounts.approve(short.login, {
    id: 'short-user',
    name: 'Short user',
    organization: { ...organization, policy: 'policy-two' },
    sessionExpiresAt: f.store.now() + 1000,
  })
  f.advance(1001)
  expect((await f.request('/v1/me', 'GET', undefined, short.token)).status).toBe(401)
})

it('rejects invalid link lifetimes and caps invitations, active links and request bodies', async () => {
  const f = await fixture(),
    owner = f.grant(f.owner),
    publication = await f.publish()
  const path = '/v1/publications/' + publication.id
  expect((await f.request(path + '/links', 'POST', { seconds: -1 }, owner)).status).toBe(400)
  expect((await f.request(path + '/links', 'POST', { seconds: 60 }, owner)).status).toBe(400)
  expect(
    (await f.request(path + '/invites', 'POST', { userId: 'x'.repeat(17_000) }, owner)).status,
  ).toBe(413)
  for (let n = 0; n < 100; n++) f.store.invite(publication.id, 'owner', 'invited-' + n)
  expect((await f.request(path + '/invites', 'POST', { userId: 'over-limit' }, owner)).status).toBe(
    429,
  )
  for (let n = 0; n < 10; n++) f.store.link(publication.id, 'owner', 3600)
  expect((await f.request(path + '/links', 'POST', { seconds: 3600 }, owner)).status).toBe(429)
})

it('binds feed writers to one owner, publication and audience; viewers receive data but cannot run or manage queries', async () => {
  const f = await fixture(),
    publication = await f.publish(),
    other = await f.publish({ ...f.input, sourceId: randomUUID() })
  const path = '/v1/publications/' + publication.id,
    owner = f.grant(f.owner)
  const writer = f.accounts.artifactGrant(f.owner, f.origin, publication.id)!
  const setup = (token = writer.token, auth = owner) =>
    f.request(path + '/feed', 'POST', { writer: token, seconds: 60, data: { count: 1 } }, auth)
  const registration = await setup()
  expect(registration.status).toBe(200)
  const { generation } = (await registration.json()) as { generation: string }
  expect(f.accounts.sessionUser(writer.token)).toBeUndefined()
  expect(f.accounts.artifactSession(writer.token)).toBeUndefined()
  expect(f.accounts.artifactGrant(writer.token, f.origin)).toBeUndefined()
  expect(f.store.db.prepare('SELECT writer FROM feeds').get()?.writer).not.toBe(writer.token)
  for (const suffix of ['', '/feed'])
    expect((await f.request(path + suffix, 'GET', undefined, writer.token)).status).toBe(404)
  expect((await f.request(path + '/access', 'GET', undefined, writer.token)).status).toBe(401)
  expect((await setup(writer.token, writer.token)).status).toBe(401)
  for (const wrong of [
    f.accounts.artifactGrant(f.owner, f.origin, other.id)!,
    f.accounts.artifactGrant(f.stranger, f.origin, publication.id)!,
  ])
    expect((await setup(wrong.token)).status).toBe(403)
  expect(
    (await setup(f.accounts.artifactGrant(f.owner, 'https://other.test', publication.id)!.token))
      .status,
  ).toBe(401)
  expect(
    (
      await f.request(
        '/v1/publications/' + other.id + '/feed/lease',
        'GET',
        undefined,
        writer.token,
      )
    ).status,
  ).toBe(401)
  expect((await f.request(path + '/feed/lease', 'GET', undefined, owner)).status).toBe(401)
  expect(
    (await f.request(path + '/feed/data', 'PUT', { generation, data: { count: 2 } }, writer.token))
      .status,
  ).toBe(200)
  f.store.invite(publication.id, 'owner', 'invited')
  const invited = f.grant(f.invited)
  expect(await (await f.request(path + '/feed', 'GET', undefined, invited)).json()).toMatchObject({
    enabled: true,
    data: { count: 2 },
  })
  expect((await setup(writer.token, invited)).status).toBe(404)
  expect(
    (await f.request(path + '/feed/data', 'PUT', { generation, data: {} }, invited)).status,
  ).toBe(401)
  const link = f.store.link(publication.id, 'owner', 3600)
  const view = () =>
    f.request(path + '/feed', 'GET', undefined, undefined, {
      Authorization: 'DovoShare ' + link.token,
    })
  expect((await view()).status).toBe(200)
  f.store.unlink(publication.id, 'owner', link.id)
  expect((await view()).status).toBe(404)
  f.store.uninvite(publication.id, 'owner', 'invited')
  expect((await f.request(path + '/feed', 'GET', undefined, invited)).status).toBe(404)
})

it('invalidates replaced or cleared writers, preserves newer generations and stops updates on parent revocation', async () => {
  const f = await fixture(),
    publication = await f.publish(),
    owner = f.grant(f.owner)
  const path = '/v1/publications/' + publication.id + '/feed'
  const first = f.accounts.artifactGrant(f.owner, f.origin, publication.id)!
  const register = async (writer: string, data: unknown) => {
    const response = await f.request(path, 'POST', { writer, seconds: 60, data }, owner)
    expect(response.status).toBe(200)
    return (await response.json()) as { generation: string }
  }
  const a = await register(first.token, 1),
    second = f.accounts.artifactGrant(f.owner, f.origin, publication.id)!,
    b = await register(second.token, 2)
  expect((await f.request(path + '/lease', 'GET', undefined, first.token)).status).toBe(401)
  expect(
    (await f.request(path + '/data', 'PUT', { generation: a.generation, data: 9 }, second.token))
      .status,
  ).toBe(409)
  expect((await f.request(path, 'DELETE', a, owner)).status).toBe(200)
  expect(f.store.feedData(publication.id).data).toBe(2)
  f.accounts.revoke(f.owner)
  expect((await f.request(path + '/data', 'PUT', { ...b, data: 3 }, second.token)).status).toBe(401)
  expect(f.store.feedData(publication.id).data).toBe(2)
  f.store.feedStop(publication.id, 'owner', b.generation)
  expect(f.store.feedData(publication.id)).toMatchObject({ enabled: false, data: null })
  expect(() => f.store.feedLease(publication.id, 'owner', second.token)).toThrow(
    'stopped or replaced',
  )
})

it('limits selected data and rejects writer expiry and organization policy revocation', async () => {
  const f = await fixture(),
    publication = await f.publish(),
    owner = f.grant(f.owner)
  const path = '/v1/publications/' + publication.id + '/feed',
    writer = f.accounts.artifactGrant(f.owner, f.origin, publication.id)!
  expect(
    (
      await f.request(
        path,
        'POST',
        { writer: writer.token, seconds: 60, data: 'x'.repeat(256 * 1024) },
        owner,
      )
    ).status,
  ).toBe(413)
  expect(
    (await f.request(path, 'POST', { writer: writer.token, seconds: 60, data: {} }, owner)).status,
  ).toBe(200)
  f.advance(30 * 86400_000 + 1)
  expect((await f.request(path + '/lease', 'GET', undefined, writer.token)).status).toBe(401)
  expect(f.store.feedData(publication.id).enabled).toBe(false)
  f.accounts.configureOrganizations(new Map([['company', 'one']]))
  const login = f.accounts.createLogin()
  f.accounts.approve(login.login, {
    id: 'company',
    name: 'Company',
    organization: { id: 'company', name: 'Company', policy: 'one' },
  })
  const scoped = f.accounts.artifactGrant(login.token, f.origin, publication.id)!
  expect(f.accounts.artifactSession(scoped.token, true)).toBeDefined()
  f.accounts.configureOrganizations(new Map([['company', 'two']]))
  expect(f.accounts.artifactSession(scoped.token, true)).toBeUndefined()
})

it('replaces previous publication writers without exhausting long-lived scope capacity', async () => {
  const f = await fixture(),
    publication = await f.publish()
  let previous: string | undefined
  for (let n = 0; n < 40; n++) {
    const next = f.accounts.artifactGrant(f.owner, f.origin, publication.id)!
    expect(f.accounts.artifactSession(next.token, true)).toBeDefined()
    expect(f.accounts.artifactSession(previous ?? '', true)).toBeUndefined()
    previous = next.token
  }
  expect(f.accounts.db.prepare('SELECT count(*) AS n FROM artifact_feed_grants').get()?.n).toBe(1)
})

it('keeps organisation content encrypted and follows membership on reads and prompt suggestions without changing the link', async () => {
  const f = await fixture()
  f.accounts.people.mutate('owner', { action: 'createOrganization', name: 'Product team' })
  const org = f.accounts.people.directory('owner').organizations[0]!
  f.accounts.people.mutate('owner', {
    action: 'inviteMember',
    organizationId: org.id,
    userId: 'invited',
  })
  let key: string | null = null
  const storage: AccountStorage = {
    read: async () => null,
    write: async () => {},
    readSharingKey: async () => key,
    writeSharingKey: async (value) => {
      key = value
    },
  }
  class TestSharing extends SharingClient {
    override async request(
      _origin: string,
      path: string,
      method = 'GET',
      body?: unknown,
    ): Promise<unknown> {
      const response = await f.request(path, method, body, f.grant(f.owner))
      if (!response.ok) throw new Error('Sharing HTTP ' + response.status)
      return response.json()
    }
  }
  const client = new TestSharing(
    storage,
    f.connectOrigin,
    () => ({ userId: 'owner', sessionId: 'owner' }),
    async () => '',
  )
  await client.recoveryKey(true)
  let share = await client.publish(f.origin, 'private-thread', {
    kind: 'thread',
    title: 'Encrypted roadmap',
    messages: [{ id: 'one', role: 'user', text: 'Private conversation' }],
  })
  share = await client.invite(f.origin, share, undefined, undefined, org.id)
  const access = share.record.grants[0]!.id
  const url = `/v2/shares/${share.record.id}/read?access=${access}`
  const invited = f.grant(f.invited),
    stranger = f.grant(f.stranger)
  expect((await f.request(url)).status).toBe(404)
  expect((await f.request(url, 'GET', undefined, invited)).status).toBe(404)
  f.accounts.people.mutate('invited', { action: 'acceptOrganization', organizationId: org.id })
  const read = await f.request(url, 'GET', undefined, invited)
  expect(read.status).toBe(200)
  const encrypted = await read.text()
  expect(encrypted).not.toContain('Private conversation')
  expect(encrypted).not.toContain('Encrypted roadmap')
  const suggestion = encryptSuggestion(
    {
      shareId: share.record.id,
      revision: share.record.packet.revision,
      name: 'Teammate',
      text: 'What should we build next?',
    },
    sharingReaderKeys(share.vault).suggestionKey,
  )
  const suggestionsUrl = `/v2/shares/${share.record.id}/suggestions?access=${access}`
  expect((await f.request(suggestionsUrl, 'POST', suggestion, invited)).status).toBe(200)
  expect((await f.request(url, 'GET', undefined, stranger)).status).toBe(404)
  f.accounts.people.mutate('owner', {
    action: 'removeMember',
    organizationId: org.id,
    userId: 'invited',
  })
  expect((await f.request(url, 'GET', undefined, invited)).status).toBe(404)
  expect((await f.request(suggestionsUrl, 'POST', suggestion, invited)).status).toBe(404)
  f.accounts.people.mutate('owner', {
    action: 'inviteMember',
    organizationId: org.id,
    userId: 'stranger',
  })
  f.accounts.people.mutate('stranger', { action: 'acceptOrganization', organizationId: org.id })
  expect((await f.request(url, 'GET', undefined, stranger)).status).toBe(200)
  f.accounts.people.mutate('owner', { action: 'deleteOrganization', organizationId: org.id })
  expect((await f.request(url, 'GET', undefined, stranger)).status).toBe(404)
})
