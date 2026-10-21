import { afterEach, expect, test } from 'vite-plus/test'
import { once } from 'node:events'
import { decode, responses, snapshotSchema, conversationPageSchema } from '@dovo/protocol'
import { createDemoServer } from './server.js'
import { DemoSessions } from './sessions.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function fixture() {
  let now = Date.now()
  const password = 'dedicated-fictional-review-password'
  const server = createDemoServer({ origin: 'http://review.test', password, now: () => now })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No listener')
  const base = `http://127.0.0.1:${address.port}`
  const request = (path: string, init?: RequestInit) =>
    fetch(base + path, { ...init, redirect: 'manual' })
  const post = (path: string, input: unknown, token = '') =>
    request(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const login = async () => {
    const res = await request('/login', {
      method: 'POST',
      headers: { Origin: 'http://review.test' },
      body: new URLSearchParams({ password }),
    })
    expect(res.status).toBe(303)
    return res.headers.get('set-cookie')!.split(';')[0]!
  }
  const code = async () => {
    const cookie = await login()
    const res = await request('/code', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://review.test' },
    })
    const match = (await res.text()).match(/<code>(\d{8})<\/code>/)
    if (!match) throw new Error('No pairing code')
    return match[1]!
  }
  const pair = async () => {
    const proof = decode(
      responses.pairRequest,
      await (
        await post('/api/pair/request', {
          protocolVersion: 2,
          code: await code(),
          name: 'Review phone',
        })
      ).json(),
    )
    const claim = decode(responses.pairClaim, await (await post('/api/pair/claim', proof)).json())
    expect(claim.status).toBe('approved')
    expect(decode(responses.ok, await (await post('/api/pair/confirm', proof)).json()).ok).toBe(
      true,
    )
    return claim.token!
  }
  return {
    request,
    post,
    login,
    code,
    pair,
    advance: (ms: number) => {
      now += ms
    },
  }
}
test('review page is gated, origin checked and never publishes codes anonymously', async () => {
  const f = await fixture()
  expect(await (await f.request('/')).text()).toContain('Simulated review environment')
  expect(
    (await f.request('/code', { method: 'POST', headers: { Origin: 'http://review.test' } }))
      .status,
  ).toBe(401)
  expect(
    (
      await f.request('/login', {
        method: 'POST',
        headers: { Origin: 'http://evil.test' },
        body: 'password=no',
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await f.request('/login', {
        method: 'POST',
        headers: { Origin: 'http://review.test' },
        body: 'password=no',
      })
    ).status,
  ).toBe(401)
  const cookie = await f.login()
  expect(
    (
      await f.request('/code', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://evil.test' },
      })
    ).status,
  ).toBe(403)
  f.advance(8 * 60 * 60_000)
  expect(
    (
      await f.request('/code', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://review.test' },
      })
    ).status,
  ).toBe(401)
})
test('real wire schemas accept pairing, snapshots, history and fictional file reads', async () => {
  const f = await fixture(),
    token = await f.pair()
  const snapshot = decode(
    snapshotSchema,
    await (
      await f.request('/api/snapshot?scope=threads&history=paged', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json(),
  )
  expect(snapshot.workspace.tasks).toHaveLength(3)
  expect(snapshot.workspace.agents).toEqual([])
  expect(snapshot.devices).toEqual([])
  const id = snapshot.workspace.tasks[0]!.id
  const page = decode(
    conversationPageSchema,
    await (await f.post('/api/tasks/history', { id }, token)).json(),
  )
  expect(page.messages).toHaveLength(2)
  const file = decode(
    responses.projectFile,
    await (await f.post('/api/tasks/files/read', { id, path: 'src/greeting.ts' }, token)).json(),
  )
  expect(file.contents).toContain('name.trim()')
  expect((await f.post('/api/tasks/files/read', { id, path: '/etc/passwd' }, token)).status).toBe(
    404,
  )
  expect((await f.request('/api/snapshot')).status).toBe(401)
  expect((await f.post('/api/tasks/run', { id }, token)).status).toBe(403)
  expect((await f.post('/api/terminals/create', {}, token)).status).toBe(403)
  expect(
    (
      await f.post(
        '/api/tasks/files/write',
        { id, path: 'src/greeting.ts', contents: 'changed' },
        token,
      )
    ).status,
  ).toBe(403)
  expect((await f.post('/api/sync/ticket', {}, token)).status).toBe(403)
  expect((await f.post('/api/account/session', {}, token)).status).toBe(403)
})
test('codes are single-use and expire; tokens expire and disappear on reconstruction', async () => {
  let now = 0
  const demo = new DemoSessions(() => now)
  const code = demo.code(),
    proof = demo.pair(code)
  expect(() => demo.pair(code)).toThrow('invalid or expired')
  const claim = demo.claim(proof.id, proof.secret, 'claim')
  expect(claim).toHaveProperty('token')
  expect(() => demo.claim(proof.id, 'wrong', 'confirm')).toThrow('expired')
  now += 120_000
  expect(() => demo.claim(proof.id, proof.secret, 'claim')).toThrow('expired')
  const next = demo.pair(demo.code())
  const result = demo.claim(next.id, next.secret, 'claim')
  if (!('token' in result) || !result.token) throw new Error('Missing token')
  demo.claim(next.id, next.secret, 'confirm')
  expect(demo.device(result.token).workspace.tasks).toHaveLength(3)
  expect(() => new DemoSessions(() => now).device(result.token!)).toThrow('Pair')
  now += 24 * 60 * 60_000
  expect(() => demo.device(result.token!)).toThrow('Pair')
  const expired = demo.code()
  now += 120_000
  expect(() => demo.pair(expired)).toThrow('expired')
})
test('devices have independent fictional state, and cancelling revokes the token', () => {
  const demo = new DemoSessions()
  const one = demo.pair(demo.code()),
    two = demo.pair(demo.code())
  const a = demo.claim(one.id, one.secret, 'claim'),
    b = demo.claim(two.id, two.secret, 'claim')
  if (!('token' in a) || !a.token || !('token' in b) || !b.token) throw new Error('Missing tokens')
  demo.device(a.token).workspace.tasks[0]!.title = 'local-only'
  expect(demo.device(b.token).workspace.tasks[0]!.title).toBe('Make greetings feel personal')
  demo.claim(one.id, one.secret, 'cancel')
  expect(() => demo.device(a.token!)).toThrow('Pair')
})
test('rejects malformed and oversized bodies; bounds login requests', async () => {
  const f = await fixture()
  expect((await f.request('/api/pair/request', { method: 'POST', body: '{' })).status).toBe(400)
  expect(
    (await f.request('/api/pair/request', { method: 'POST', body: 'a'.repeat(9000) })).status,
  ).toBe(413)
  for (let i = 0; i < 60; i++)
    await f.request('/login', {
      method: 'POST',
      headers: { Origin: 'http://review.test' },
      body: 'password=no',
    })
  expect(
    (
      await f.request('/login', {
        method: 'POST',
        headers: { Origin: 'http://review.test' },
        body: 'password=no',
      })
    ).status,
  ).toBe(429)
})
