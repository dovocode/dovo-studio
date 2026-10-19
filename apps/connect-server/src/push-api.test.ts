import { afterEach, expect, it, vi } from 'vite-plus/test'
import { once } from 'node:events'
import { AccountStore } from './store.js'
import { createConnectServer } from './server.js'
import type { RelayNotification } from '@dovo/protocol'
const dispose: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close()
})
async function fixture(configured = true) {
  let now = Date.now()
  const store = new AccountStore(':memory:', () => now)
  dispose.push(() => store.db.close())
  const send = vi.fn<
    (value: RelayNotification) => Promise<{ delivered: boolean; invalidToken: boolean }>
  >(async () => ({
    delivered: true,
    invalidToken: false,
  }))
  const server = createConnectServer({
    store,
    origin: 'http://connect.test',
    authorizationOrigin: 'https://auth.test',
    authorize: async () => '',
    exchange: async () => ({ id: '', name: '' }),
    ...(configured ? { push: { send } } : {}),
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
  const request = (path: string, token: string, method = 'GET', body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const session = () => {
    const { login, token } = store.createLogin()
    store.approve(login, { id: 'person', name: 'Dominic' })
    return token
  }
  const registration = {
    runtimeId: 'server-a',
    platform: 'ios',
    token: 'a'.repeat(64),
    environment: 'sandbox',
  }
  const subscribe = async (token: string, runtimeId = registration.runtimeId) => {
    const response = await request('/v1/push/subscriptions', token, 'PUT', {
      ...registration,
      runtimeId,
    })
    expect(response.status).toBe(200)
    return ((await response.json()) as { token: string }).token
  }
  const message = (runtimeId = registration.runtimeId): RelayNotification => ({
    token: registration.token,
    platform: 'ios',
    environment: 'sandbox',
    id: 'b'.repeat(64),
    title: 'Needs input',
    body: 'Choose a branch',
    data: { runtimeId, taskId: 'thread', kind: 'input' },
  })
  return {
    store,
    send,
    request,
    session,
    subscribe,
    message,
    registration,
    advance: (ms: number) => {
      now += ms
    },
  }
}
it('permits only the registered phone and server, without granting runtime or account access', async () => {
  const f = await fixture(),
    session = f.session(),
    grant = await f.subscribe(session)
  expect(grant).not.toBe(session)
  expect((await f.request('/v1/servers', grant)).status).toBe(401)
  expect((await f.request('/v1/push/send', session, 'POST', f.message())).status).toBe(401)
  for (const body of [
    f.message('server-b'),
    { ...f.message(), token: 'c'.repeat(64) },
    { ...f.message(), environment: 'production' },
  ])
    expect((await f.request('/v1/push/send', grant, 'POST', body)).status).toBe(403)
  expect(f.send).not.toHaveBeenCalled()
  expect((await f.request('/v1/push/send', grant, 'POST', f.message())).status).toBe(200)
  expect(f.send).toHaveBeenCalledWith(f.message())
  expect(
    JSON.stringify(f.store.db.prepare('SELECT * FROM push_subscriptions').all()),
  ).not.toContain(grant)
  expect(
    (
      await f.request('/v1/push/subscriptions', session, 'PUT', {
        ...f.registration,
        token: 'invalid',
      })
    ).status,
  ).toBe(400)
})
it('revokes a disabled server immediately and keeps other servers and phone sessions independent', async () => {
  const f = await fixture(),
    first = f.session(),
    second = f.session()
  const a = await f.subscribe(first),
    b = await f.subscribe(first, 'server-b'),
    otherPhone = await f.subscribe(second)
  expect(
    (await f.request('/v1/push/servers', first, 'PUT', { runtimeIds: ['server-b'] })).status,
  ).toBe(200)
  expect((await f.request('/v1/push/send', a, 'POST', f.message())).status).toBe(401)
  expect((await f.request('/v1/push/send', b, 'POST', f.message('server-b'))).status).toBe(200)
  expect((await f.request('/v1/push/send', otherPhone, 'POST', f.message())).status).toBe(200)
  await f.request('/v1/session', first, 'DELETE')
  expect((await f.request('/v1/push/send', b, 'POST', f.message('server-b'))).status).toBe(401)
  expect((await f.request('/v1/push/send', otherPhone, 'POST', f.message())).status).toBe(200)
  f.advance(31 * 86400_000)
  expect((await f.request('/v1/push/send', otherPhone, 'POST', f.message())).status).toBe(401)
})
it('rotates grants and invalidates a rejected native token without affecting the replacement', async () => {
  const f = await fixture(),
    session = f.session(),
    old = await f.subscribe(session),
    next = await f.subscribe(session)
  expect((await f.request('/v1/push/send', old, 'POST', f.message())).status).toBe(401)
  f.send.mockResolvedValueOnce({ delivered: false, invalidToken: true })
  expect(await (await f.request('/v1/push/send', next, 'POST', f.message())).json()).toEqual({
    delivered: false,
    invalidToken: true,
  })
  expect((await f.request('/v1/push/send', next, 'POST', f.message())).status).toBe(401)
  const replacement = await f.subscribe(session)
  expect((await f.request('/v1/push/send', replacement, 'POST', f.message())).status).toBe(200)
})
it('reports missing delivery configuration rather than claiming push is ready', async () => {
  const f = await fixture(false)
  expect(
    (await f.request('/v1/push/subscriptions', f.session(), 'PUT', f.registration)).status,
  ).toBe(503)
})

it('isolates push grant quotas from other servers and account requests behind one proxy', async () => {
  const f = await fixture(),
    account = f.session()
  const first = await f.subscribe(account),
    second = await f.subscribe(account, 'server-b')
  for (let i = 0; i < 300; i++)
    expect((await f.request('/v1/push/send', first, 'POST', f.message())).status).toBe(200)
  expect((await f.request('/v1/push/send', first, 'POST', f.message())).status).toBe(429)
  expect((await f.request('/v1/push/send', second, 'POST', f.message('server-b'))).status).toBe(200)
  expect((await f.request('/v1/servers', account)).status).toBe(200)
})
