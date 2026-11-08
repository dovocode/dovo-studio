import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import {
  learnRuntimeRoutes,
  reconcileRuntimeRoutes,
  resolveRuntimeEndpoint,
  runtimeTransportAddress,
  invalidateRuntimeRoute,
  failRuntimeStreamingRoute,
} from './routes.js'
import { runtimeRequest } from '../../shared/client.js'
import { createRuntimeClient } from '../../shared/runtime-client.js'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'

// These assertions cover route addresses; endpoint credential behavior is checked separately.
const resolveAddress = async (...args: Parameters<typeof resolveRuntimeEndpoint>) =>
  (await resolveRuntimeEndpoint(...args)).address

const token = 'paired-route-test-token-long-enough'
const snapshot = decode(snapshotSchema, {
  revision: 1,
  runtimeId: 'paired-runtime',
  runtimeAddresses: ['http://wrong.local', 'http://vpn.local'],
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
  owner: false,
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('verifies alternate identity without credentials and keeps the logical connection unchanged', async () => {
  const connection = learnRuntimeRoutes({ address: 'http://unreachable.local', token }, snapshot)
  const calls: { url: string; authorization: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      calls.push({ url: url.href, authorization: options?.headers })
      if (url.hostname === 'unreachable.local') throw new Error('Offline')
      if (url.pathname === '/health')
        return Response.json({
          service: 'dovo-runtime',
          runtimeId: url.hostname === 'vpn.local' ? 'paired-runtime' : 'another-runtime',
        })
      return Response.json({ ok: true })
    }),
  )
  const client = createRuntimeClient(connection)
  expect(client.url('/file')).toBe('http://unreachable.local/file')
  await client.request('/api/tasks/run', { id: 'task' }, Schema.Struct({ ok: Schema.Boolean }))
  expect(client.socketUrl('/ws/terminal', 'ticket')).toBe(
    'ws://vpn.local/ws/terminal?ticket=ticket',
  )
  expect(
    calls
      .filter((call) => call.url.endsWith('/health'))
      .every((call) => call.authorization === undefined),
  ).toBe(true)
  expect(calls.at(-1)).toEqual({
    url: 'http://vpn.local/api/tasks/run',
    authorization: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  expect(connection.address).toBe('http://unreachable.local')
  expect(runtimeTransportAddress(connection)).toBe('http://vpn.local')
})
it('never sends a mutation to a different runtime and never replays an uncertain mutation on a fallback', async () => {
  const connection = learnRuntimeRoutes(
    { address: 'http://mutation-primary.local', token },
    snapshot,
  )
  const writes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.pathname === '/health')
        return Response.json({ service: 'dovo-runtime', runtimeId: 'paired-runtime' })
      writes.push(url.origin)
      throw new Error('Response lost after side effect')
    }),
  )
  await expect(
    runtimeRequest(
      connection,
      connection.address,
      '/api/tasks/run',
      { id: 'task' },
      Schema.Unknown,
    ),
  ).rejects.toMatchObject({ kind: 'connection' })
  expect(writes).toEqual(['http://mutation-primary.local'])
  invalidateRuntimeRoute(connection)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ service: 'dovo-runtime', runtimeId: 'wrong-runtime' })),
  )
  await expect(resolveAddress(connection, new AbortController().signal)).rejects.toThrow(
    'No verified address',
  )
})
it('rechecks preferred routes after expiry and isolates different pairing credentials', async () => {
  const connection = learnRuntimeRoutes(
    { address: 'http://preferred-restored.local', token },
    snapshot,
  )
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  let restored = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.hostname === 'preferred-restored.local' && !restored) throw new Error('Offline')
      return Response.json({ service: 'dovo-runtime', runtimeId: 'paired-runtime' })
    }),
  )
  expect(await resolveAddress(connection, new AbortController().signal)).toBe('http://wrong.local')
  restored = true
  clock.mockReturnValue(61001)
  expect(await resolveAddress(connection, new AbortController().signal)).toBe(
    'http://preferred-restored.local',
  )
  expect(runtimeTransportAddress({ ...connection, token: 'different-pairing-token' })).toBe(
    connection.address,
  )
})
it('keeps old runtimes on their configured HTTP route', async () => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  expect(
    await resolveAddress({ address: 'http://legacy.local', token }, new AbortController().signal),
  ).toBe('http://legacy.local')
  expect(fetcher).not.toHaveBeenCalled()
})

it('probes stale interfaces concurrently and retains selection when snapshots arrive during resolution', async () => {
  const connection = learnRuntimeRoutes(
    { address: 'http://stale-interface.local', token },
    snapshot,
  )
  const stalled: Array<() => void> = []
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
    )
    if (url.hostname !== 'vpn.local')
      return new Promise<Response>((_resolve, reject) =>
        stalled.push(() => reject(new Error('Probe deadline'))),
      )
    return Response.json({ service: 'dovo-runtime', runtimeId: 'paired-runtime' })
  })
  vi.stubGlobal('fetch', fetcher)
  const pending = resolveAddress(connection, new AbortController().signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  learnRuntimeRoutes(connection, snapshot)
  for (const expire of stalled) expire()
  expect(await pending).toBe('http://vpn.local')
  expect(runtimeTransportAddress(connection)).toBe('http://vpn.local')
})
it('uses saved route metadata in a fresh client session without sending tokens to mismatched descriptors', async () => {
  const connection = {
    address: 'http://restored-profile.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://restored-vpn.local'],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      expect(options?.headers).toBeUndefined()
      return Response.json({
        service: 'dovo-runtime',
        runtimeId: url.hostname === 'restored-profile.local' ? 'wrong-runtime' : 'paired-runtime',
      })
    }),
  )
  expect(await resolveAddress(connection, new AbortController().signal)).toBe(
    'http://restored-vpn.local',
  )
})

it('returns a verified preferred route without waiting for stale lower-priority probes and aborts them', async () => {
  const connection = {
    address: 'http://fast-preferred.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://never-answers.local'],
  }
  let staleSignal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.origin === connection.address)
        return Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId })
      staleSignal = options?.signal
      return new Promise<Response>((_resolve, reject) => {
        staleSignal?.addEventListener('abort', () => reject(new Error('Cancelled probe')), {
          once: true,
        })
      })
    }),
  )
  let selected: string | undefined
  const pending = resolveAddress(connection, new AbortController().signal).then((address) => {
    selected = address
    return address
  })
  await vi.waitFor(() => expect(selected).toBe(connection.address))
  expect(await pending).toBe(connection.address)
  expect(staleSignal?.aborted).toBe(true)
})

it('keeps streaming cooldowns independent of HTTP selection and rechecks the preferred route after thirty seconds', async () => {
  const connection = {
    address: 'http://http-only-proxy.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://streaming-vpn.local'],
  }
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId }),
      ),
  )
  const signal = new AbortController().signal
  expect(await resolveAddress(connection, signal)).toBe(connection.address)
  expect(await resolveAddress(connection, signal, 'stream')).toBe(connection.address)
  failRuntimeStreamingRoute(connection, connection.address)
  expect(await resolveAddress(connection, signal, 'stream')).toBe('http://streaming-vpn.local')
  expect(runtimeTransportAddress(connection)).toBe(connection.address)
  expect(runtimeTransportAddress(connection, 'stream')).toBe('http://streaming-vpn.local')
  expect(await resolveAddress(connection, signal)).toBe(connection.address)
  clock.mockReturnValue(129999)
  expect(await resolveAddress(connection, signal, 'stream')).toBe('http://streaming-vpn.local')
  clock.mockReturnValue(130000)
  expect(await resolveAddress(connection, signal, 'stream')).toBe(connection.address)
})

it('does not retain a selection from cancelled probes, even if a descriptor arrives late', async () => {
  const connection = {
    address: 'http://cancelled-probe.local',
    token,
    runtimeId: 'paired-runtime',
  }
  let finish: ((response: Response) => void) | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    ),
  )
  const controller = new AbortController()
  const pending = resolveAddress(connection, controller.signal).catch((error: unknown) => error)
  controller.abort(new Error('Changed runtime'))
  finish?.(Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId }))
  expect(await pending).toMatchObject({ message: 'Changed runtime' })
  expect(runtimeTransportAddress(connection)).toBe(connection.address)
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ service: 'dovo-runtime', runtimeId: 'different-runtime' }),
    )
  vi.stubGlobal('fetch', fetcher)
  await expect(resolveAddress(connection, new AbortController().signal)).rejects.toThrow(
    'No verified address',
  )
  expect(fetcher).toHaveBeenCalledOnce()
})

it('bounds exhaustion of all streaming routes without blocking HTTP or permanently excluding the runtime', async () => {
  const connection = {
    address: 'http://all-streams-blocked.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://also-blocked-vpn.local'],
  }
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId }),
      ),
  )
  const signal = new AbortController().signal
  expect(await resolveAddress(connection, signal, 'stream')).toBe(connection.address)
  failRuntimeStreamingRoute(connection, connection.address)
  expect(await resolveAddress(connection, signal, 'stream')).toBe(connection.alternateAddresses[0])
  failRuntimeStreamingRoute(connection, connection.alternateAddresses[0]!)
  await expect(resolveAddress(connection, signal, 'stream')).rejects.toThrow('No verified address')
  expect(await resolveAddress(connection, signal)).toBe(connection.address)
  clock.mockReturnValue(130000)
  expect(await resolveAddress(connection, signal, 'stream')).toBe(connection.address)
})

it('rejects changed saved runtime identity before trusting an already warm route', async () => {
  const connection = { address: 'http://warm-identity.local', token, runtimeId: 'paired-runtime' }
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId }),
    )
  vi.stubGlobal('fetch', fetcher)
  expect(await resolveAddress(connection, new AbortController().signal)).toBe(connection.address)
  fetcher.mockClear()
  await expect(
    runtimeRequest(
      { ...connection, runtimeId: 'different-runtime' },
      connection.address,
      '/api/scm/pulls/action',
      {},
      Schema.Unknown,
    ),
  ).rejects.toMatchObject({
    kind: 'connection',
    message: expect.stringContaining('different runtime'),
  })
  expect(fetcher).not.toHaveBeenCalled()
})

it('shares one discovery across twenty readers without cancelling other readers', async () => {
  const connection = {
    address: 'http://shared-probes.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://shared-probes-vpn.local'],
  }
  const pending: Array<{ signal: AbortSignal | null | undefined; finish: () => void }> = []
  const fetcher = vi.fn<typeof fetch>(
    (_input, options) =>
      new Promise<Response>((resolve) => {
        pending.push({
          signal: options?.signal,
          finish: () =>
            resolve(
              Response.json({
                service: 'dovo-runtime',
                runtimeId: connection.runtimeId,
              }),
            ),
        })
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const cancelled = new AbortController()
  const first = resolveAddress(connection, cancelled.signal).catch((error: unknown) => error)
  const others = Array.from({ length: 19 }, () =>
    resolveAddress(connection, new AbortController().signal),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  cancelled.abort(new Error('Screen closed'))
  await expect(first).resolves.toMatchObject({ message: 'Screen closed' })
  expect(pending.every(({ signal }) => !signal?.aborted)).toBe(true)
  for (const probe of pending) probe.finish()
  expect(await Promise.all(others)).toEqual(Array(19).fill(connection.address))
  expect(pending.every(({ signal }) => signal?.aborted)).toBe(true)
  expect(await resolveAddress(connection, new AbortController().signal)).toBe(connection.address)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('aborts abandoned probes and ignores their late results before a fresh resolution', async () => {
  const connection = {
    address: 'http://abandoned-probes.local',
    token,
    runtimeId: 'paired-runtime',
  }
  const pending: Array<{ signal: AbortSignal | null | undefined; finish: () => void }> = []
  const fetcher = vi.fn<typeof fetch>(
    (_input, options) =>
      new Promise<Response>((resolve) => {
        pending.push({
          signal: options?.signal,
          finish: () =>
            resolve(
              Response.json({
                service: 'dovo-runtime',
                runtimeId: connection.runtimeId,
              }),
            ),
        })
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const first = resolveAddress(connection, controller.signal).catch((error: unknown) => error)
  controller.abort(new Error('No readers'))
  await expect(first).resolves.toMatchObject({ message: 'No readers' })
  expect(pending[0]?.signal?.aborted).toBe(true)
  const second = resolveAddress(connection, new AbortController().signal)
  expect(fetcher).toHaveBeenCalledTimes(2)
  pending[0]?.finish()
  await Promise.resolve()
  pending[1]?.finish()
  expect(await second).toBe(connection.address)
})

it('keeps pairing credentials and HTTP/stream discoveries isolated', async () => {
  const connection = { address: 'http://probe-isolation.local', token, runtimeId: 'paired-runtime' }
  const finishes: Array<() => void> = []
  const fetcher = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        finishes.push(() =>
          resolve(Response.json({ service: 'dovo-runtime', runtimeId: connection.runtimeId })),
        )
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  const pending = [
    resolveAddress(connection, signal),
    resolveAddress(connection, signal, 'stream'),
    resolveAddress({ ...connection, token: 'other-device' }, signal),
  ]
  expect(fetcher).toHaveBeenCalledTimes(3)
  for (const finish of finishes) finish()
  expect(await Promise.all(pending)).toEqual(Array(3).fill(connection.address))
})

it('invalidates in-flight discovery and never lets a late result overwrite its replacement', async () => {
  const connection = {
    address: 'http://invalidate-probes.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://invalidate-probes-vpn.local'],
  }
  const finishes: Array<(runtimeId: string) => void> = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finishes.push((runtimeId) =>
            resolve(Response.json({ service: 'dovo-runtime', runtimeId })),
          )
        }),
    ),
  )
  const signal = new AbortController().signal
  const stale = resolveAddress(connection, signal).catch((error: unknown) => error)
  invalidateRuntimeRoute(connection)
  await expect(stale).resolves.toMatchObject({ message: 'Runtime route was invalidated' })
  const fresh = resolveAddress(connection, signal)
  finishes[2]?.('wrong-runtime')
  finishes[3]?.(connection.runtimeId)
  expect(await fresh).toBe(connection.alternateAddresses[0])
  finishes[0]?.(connection.runtimeId)
  finishes[1]?.(connection.runtimeId)
  await Promise.resolve()
  await Promise.resolve()
  expect(runtimeTransportAddress(connection)).toBe(connection.alternateAddresses[0])
})

it('removes obsolete selections and verifies replacement routes before using credentials', async () => {
  const old = {
    address: 'http://reconcile-primary.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://reconcile-old.local'],
  }
  const next = { ...old, alternateAddresses: ['http://reconcile-new.local'] }
  const calls: string[] = []
  const healthHeaders: Array<HeadersInit | undefined> = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      calls.push(url.href)
      if (url.pathname === '/health') {
        healthHeaders.push(options?.headers)
        if (url.origin === old.address) throw new Error('Offline')
        return Response.json({ service: 'dovo-runtime', runtimeId: 'paired-runtime' })
      }
      return Response.json({ ok: true })
    }),
  )
  const signal = new AbortController().signal
  expect(await resolveAddress(old, signal)).toBe(old.alternateAddresses[0])
  expect(await resolveAddress(old, signal, 'stream')).toBe(old.alternateAddresses[0])
  reconcileRuntimeRoutes(old, next)
  expect(runtimeTransportAddress(next)).toBe(next.address)
  expect(runtimeTransportAddress(next, 'stream')).toBe(next.address)
  calls.length = 0
  expect(await resolveAddress(next, signal)).toBe(next.alternateAddresses[0])
  expect(calls.some((url) => url.includes('reconcile-old.local'))).toBe(false)
  expect(healthHeaders.length).toBeGreaterThan(0)
  expect(healthHeaders.every((headers) => headers === undefined)).toBe(true)
})

it('cancels superseded discovery and rejects changed runtime identity without sending a mutation', async () => {
  const old = {
    address: 'http://reconcile-pending.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://reconcile-pending-old.local'],
  }
  const next = { ...old, alternateAddresses: ['http://reconcile-pending-new.local'] }
  const finishes: Array<() => void> = []
  const writes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.pathname !== '/health') {
        writes.push(url.href)
        return Response.json({ ok: true })
      }
      return new Promise<Response>((resolve) =>
        finishes.push(() =>
          resolve(Response.json({ service: 'dovo-runtime', runtimeId: old.runtimeId })),
        ),
      )
    }),
  )
  const pending = runtimeRequest(old, old.address, '/api/tasks/run', {}, Schema.Unknown).catch(
    (error: unknown) => error,
  )
  expect(finishes).toHaveLength(2)
  expect(() => reconcileRuntimeRoutes(old, { ...next, runtimeId: 'different-runtime' })).toThrow(
    'different runtime',
  )
  reconcileRuntimeRoutes(old, next)
  reconcileRuntimeRoutes(next, {
    ...next,
    alternateAddresses: ['http://reconcile-pending-latest.local'],
  })
  expect(await pending).toMatchObject({ kind: 'connection' })
  for (const finish of finishes) finish()
  await Promise.resolve()
  expect(writes).toEqual([])
  expect(runtimeTransportAddress(next)).toBe(next.address)
})

it('invalidates a selected route when a later authenticated snapshot removes it', async () => {
  const old = learnRuntimeRoutes(
    { address: 'http://snapshot-reconcile.local', token },
    { ...snapshot, runtimeAddresses: ['http://snapshot-old.local'] },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.origin === old.address) throw new Error('Offline')
      return Response.json({ service: 'dovo-runtime', runtimeId: old.runtimeId })
    }),
  )
  const signal = new AbortController().signal
  expect(await resolveAddress(old, signal)).toBe('http://snapshot-old.local')
  const next = learnRuntimeRoutes(old, {
    ...snapshot,
    runtimeAddresses: ['http://snapshot-new.local'],
  })
  expect(runtimeTransportAddress(next)).toBe(next.address)
  expect(await resolveAddress(next, signal)).toBe('http://snapshot-new.local')
})

it('does not replay an already dispatched mutation when route metadata changes', async () => {
  const old = {
    address: 'http://reconcile-write.local',
    token,
    runtimeId: 'paired-runtime',
    alternateAddresses: ['http://reconcile-write-old.local'],
  }
  const next = { ...old, alternateAddresses: ['http://reconcile-write-new.local'] }
  const response = Promise.withResolvers<Response>()
  const writes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      )
      if (url.pathname === '/health')
        return Response.json({ service: 'dovo-runtime', runtimeId: old.runtimeId })
      writes.push(url.origin)
      return response.promise
    }),
  )
  const pending = runtimeRequest(old, old.address, '/api/tasks/run', {}, Schema.Unknown)
  await vi.waitFor(() => expect(writes).toHaveLength(1))
  reconcileRuntimeRoutes(old, next)
  response.reject(new Error('Response lost after dispatch'))
  await expect(pending).rejects.toMatchObject({ kind: 'connection' })
  expect(writes).toEqual([old.address])
})

it('keeps active selections when authenticated snapshots only reorder the same interfaces', async () => {
  const first = learnRuntimeRoutes(
    { address: 'http://reordered-primary.local', token },
    { ...snapshot, runtimeAddresses: ['http://reordered-a.local', 'http://reordered-b.local'] },
  )
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
    )
    if (url.origin === first.address) throw new Error('Offline')
    return Response.json({ service: 'dovo-runtime', runtimeId: first.runtimeId })
  })
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  expect(await resolveAddress(first, signal)).toBe('http://reordered-a.local')
  expect(await resolveAddress(first, signal, 'stream')).toBe('http://reordered-a.local')
  fetcher.mockClear()
  const second = learnRuntimeRoutes(first, {
    ...snapshot,
    runtimeAddresses: ['http://reordered-b.local', 'http://reordered-a.local'],
  })
  expect(second.alternateAddresses).toEqual(first.alternateAddresses)
  expect(await resolveAddress(second, signal)).toBe('http://reordered-a.local')
  expect(await resolveAddress(second, signal, 'stream')).toBe('http://reordered-a.local')
  expect(fetcher).not.toHaveBeenCalled()
})
