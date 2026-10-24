import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { mergeAccountInternetConnection } from './account-internet-connection.js'
import { peerAddress, registerPeerTransport } from './peer.js'
import {
  resolveRuntimeEndpoint,
  runtimeTransportAddress,
  invalidateRuntimeRoute,
  runtimePeerAddress,
  runtimeRouteVersion,
} from './routes.js'
import { runtimeRequest } from '../../shared/client.js'
import { createRuntimeClient } from '../../shared/runtime-client.js'
import type { RuntimeConnection } from './runtime.js'
const requestUrl = (url: Parameters<typeof fetch>[0]) =>
  new URL(url instanceof Request ? url.url : url)
const peer = { origin: 'https://connect.test', secret: '8'.repeat(64) }
const internet = {
  address: peerAddress(peer),
  peer,
  token: 'internet-device-token-long',
  runtimeId: 'runtime',
  accountSession: 'phone-account-session',
}
const direct = {
  address: 'http://lan.test',
  token: 'paired-lan-device-token-long',
  runtimeId: 'runtime',
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  registerPeerTransport({
    address: () => undefined,
    resolve: async () => {
      throw new Error('No test transport')
    },
  })
})
it('preserves the separately paired credential and makes account access a fallback in either setup order', () => {
  const first = mergeAccountInternetConnection(direct, internet)
  const second = mergeAccountInternetConnection(internet, direct)
  expect(first).toEqual(second)
  expect(first.token).toBe(direct.token)
  expect(first.internet?.token).toBe(internet.token)
  expect(first.accountSession).toBeUndefined()
  expect(mergeAccountInternetConnection(direct, { ...internet, runtimeId: 'another' })).toEqual({
    ...internet,
    runtimeId: 'another',
  })
})
it('prefers verified LAN, uses the internet credential only on the tunnel, and returns to LAN', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  let lan = true
  const connection = mergeAccountInternetConnection(direct, internet)
  registerPeerTransport({
    address: () => 'http://127.0.0.1:4444',
    resolve: async () => 'http://127.0.0.1:4444',
  })
  const calls: { host: string; token: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, options) => {
      const target = requestUrl(url)
      calls.push({ host: target.host, token: new Headers(options?.headers).get('Authorization') })
      if (target.pathname === '/health') {
        if (!lan) throw new Error('LAN offline')
        return Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' })
      }
      return Response.json({ ok: true })
    }),
  )
  expect(await resolveRuntimeEndpoint(connection, new AbortController().signal)).toEqual({
    address: direct.address,
    token: direct.token,
  })
  expect(runtimePeerAddress(connection)).toBeUndefined()
  await runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
  )
  lan = false
  invalidateRuntimeRoute(connection)
  const privateVersion = runtimeRouteVersion()
  await runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
  )
  expect(runtimeTransportAddress(connection)).toBe('http://127.0.0.1:4444')
  expect(runtimePeerAddress(connection)).toBe(internet.address)
  expect(runtimeRouteVersion()).toBeGreaterThan(privateVersion)
  const peerVersion = runtimeRouteVersion()
  lan = true
  vi.setSystemTime(Date.now() + 10001)
  await runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
  )
  await vi.waitFor(() => expect(runtimePeerAddress(connection)).toBeUndefined())
  expect(runtimeRouteVersion()).toBeGreaterThan(peerVersion)
  await runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
  )
  expect(calls.filter((call) => call.token)).toEqual([
    { host: 'lan.test', token: 'Bearer ' + direct.token },
    { host: '127.0.0.1:4444', token: 'Bearer ' + internet.token },
    { host: '127.0.0.1:4444', token: 'Bearer ' + internet.token },
    { host: 'lan.test', token: 'Bearer ' + direct.token },
  ])
})
it('never replays an uncertain mutation on the internet fallback', async () => {
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'mutation-no-replay-token' },
    internet,
  )
  const resolve = vi.fn<() => Promise<string>>(async () => 'http://127.0.0.1:4444')
  registerPeerTransport({ address: () => undefined, resolve })
  const request = vi.fn<typeof fetch>(async (url) => {
    if (requestUrl(url).pathname === '/health')
      return Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' })
    throw new Error('Connection lost after request was sent')
  })
  vi.stubGlobal('fetch', request)
  await expect(
    runtimeRequest(
      connection,
      connection.address,
      '/api/tasks/run',
      {},
      Schema.Struct({ ok: Schema.Boolean }),
    ),
  ).rejects.toThrow('Cannot reach')
  expect(request.mock.calls.filter(([url]) => requestUrl(url).pathname !== '/health')).toHaveLength(
    1,
  )
  expect(resolve).not.toHaveBeenCalled()
})
it('rejects a fallback whose persistent runtime identity or peer address does not match', async () => {
  const connection = mergeAccountInternetConnection(direct, internet)
  const invalid: RuntimeConnection = {
    ...connection,
    internet: { ...connection.internet!, runtimeId: 'another' },
  }
  await expect(resolveRuntimeEndpoint(invalid, new AbortController().signal)).rejects.toThrow(
    'another computer',
  )
})

it('allows fallback setup to exceed the LAN deadline without replaying a write', async () => {
  vi.useFakeTimers()
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'slow-fallback-primary' },
    { ...internet, token: 'slow-fallback-token' },
  )
  registerPeerTransport({
    address: () => undefined,
    resolve: async () => {
      await new Promise((resolve) => setTimeout(resolve, 12000))
      return 'http://127.0.0.1:4999'
    },
  })
  const writes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      const target = requestUrl(url)
      if (target.pathname === '/health') throw new Error('LAN offline')
      writes.push(new Headers(init?.headers).get('Authorization') ?? '')
      return Response.json({ ok: true })
    }),
  )
  const result = runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    {},
    Schema.Struct({ ok: Schema.Boolean }),
    'POST',
    5000,
  )
  await vi.advanceTimersByTimeAsync(12010)
  expect(await result).toEqual({ ok: true })
  expect(writes).toEqual(['Bearer slow-fallback-token'])
})

it('keeps mutation receipt retries on the first endpoint and credential', async () => {
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'pinned-primary' },
    { ...internet, token: 'pinned-fallback' },
  )
  let lan = true
  const peerResolve = vi.fn<() => Promise<string>>(async () => 'http://127.0.0.1:4998')
  registerPeerTransport({ address: () => undefined, resolve: peerResolve })
  const tokens: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      if (requestUrl(url).pathname === '/health') {
        if (!lan) throw new Error('LAN left')
        return Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' })
      }
      tokens.push(new Headers(init?.headers).get('Authorization') ?? '')
      lan = false
      throw new Error('Response lost after commit')
    }),
  )
  await expect(
    runtimeRequest(
      connection,
      connection.address,
      '/api/tasks/lifecycle',
      {},
      Schema.Unknown,
      'POST',
      undefined,
      undefined,
      { mutationId: 'one-receipt' },
    ),
  ).rejects.toThrow('Cannot reach')
  expect(tokens).toEqual([
    'Bearer pinned-primary',
    'Bearer pinned-primary',
    'Bearer pinned-primary',
  ])
  expect(peerResolve).not.toHaveBeenCalled()
})

it('keeps twenty internet requests moving while sharing a slow background LAN recheck', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'background-lan-primary' },
    internet,
  )
  registerPeerTransport({
    address: () => 'http://127.0.0.1:4444',
    resolve: async () => 'http://127.0.0.1:4444',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      throw new Error('Away from LAN')
    }),
  )
  const signal = new AbortController().signal
  await resolveRuntimeEndpoint(connection, signal)
  vi.setSystemTime(Date.now() + 10001)
  let finish: ((response: Response) => void) | undefined
  const probe = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', probe)
  const pending = Promise.all(
    Array.from({ length: 20 }, () => resolveRuntimeEndpoint(connection, signal)),
  )
  let settled = false
  void pending.then(() => {
    settled = true
  })
  try {
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 })
    expect(await pending).toEqual(
      Array(20).fill({ address: 'http://127.0.0.1:4444', token: internet.token }),
    )
    expect(probe).toHaveBeenCalledTimes(1)
    expect(runtimePeerAddress(connection)).toBe(internet.address)
  } finally {
    finish?.(Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' }))
  }
  await vi.waitFor(() => expect(runtimePeerAddress(connection)).toBeUndefined())
  expect(await resolveRuntimeEndpoint(connection, signal)).toEqual({
    address: direct.address,
    token: connection.token,
  })
})

it('does not switch to LAN from an invalidated background probe or revive the internet selection', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'invalidated-background' },
    internet,
  )
  registerPeerTransport({
    address: () => 'http://127.0.0.1:4444',
    resolve: async () => 'http://127.0.0.1:4444',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      throw new Error('Away from LAN')
    }),
  )
  const signal = new AbortController().signal
  await resolveRuntimeEndpoint(connection, signal)
  vi.setSystemTime(Date.now() + 10001)
  let finish: ((response: Response) => void) | undefined
  let backgroundSignal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_url, options) => {
      backgroundSignal = options?.signal
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    }),
  )
  await resolveRuntimeEndpoint(connection, signal)
  invalidateRuntimeRoute(connection)
  expect(backgroundSignal?.aborted).toBe(true)
  finish?.(Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' }))
  await Promise.resolve()
  await Promise.resolve()
  expect(runtimePeerAddress(connection)).toBeUndefined()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({ service: 'dovo-runtime', runtimeId: 'wrong-runtime' }),
    ),
  )
  expect(await resolveRuntimeEndpoint(connection, signal)).toEqual({
    address: 'http://127.0.0.1:4444',
    token: internet.token,
  })
})

it('pins a ticket to its issuing tunnel when LAN recovers while the response is in flight', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const connection = mergeAccountInternetConnection(
    { ...direct, token: 'pinned-ticket-primary' },
    internet,
  )
  registerPeerTransport({
    address: () => 'http://127.0.0.1:4444',
    resolve: async () => 'http://127.0.0.1:4444',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      throw new Error('Away from LAN')
    }),
  )
  await resolveRuntimeEndpoint(connection, new AbortController().signal)
  vi.setSystemTime(Date.now() + 10001)
  let verifyLan: ((response: Response) => void) | undefined
  let issueTicket: ((response: Response) => void) | undefined
  const fetcher = vi.fn<typeof fetch>(
    (url) =>
      new Promise<Response>((resolve) => {
        if (requestUrl(url).pathname === '/health') verifyLan = resolve
        else issueTicket = resolve
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const client = createRuntimeClient(connection)
  const pending = client.request(
    '/api/terminals/ticket',
    {},
    Schema.Struct({ ticket: Schema.String }),
  )
  await vi.waitFor(() => expect(issueTicket).toBeDefined())
  verifyLan?.(Response.json({ service: 'dovo-runtime', runtimeId: 'runtime' }))
  await vi.waitFor(() => expect(runtimePeerAddress(connection)).toBeUndefined())
  issueTicket?.(Response.json({ ticket: 'one-use-socket-ticket' }))
  const ticket = await pending
  expect(client.socketUrl('/ws/terminal', ticket)).toBe(
    'ws://127.0.0.1:4444/ws/terminal?ticket=one-use-socket-ticket',
  )
  expect(await resolveRuntimeEndpoint(connection, new AbortController().signal)).toEqual({
    address: direct.address,
    token: connection.token,
  })
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
    'Bearer ' + internet.token,
  )
})
