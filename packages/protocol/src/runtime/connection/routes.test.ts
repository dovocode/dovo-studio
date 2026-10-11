import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import {
  learnRuntimeRoutes,
  resolveRuntimeRoute,
  runtimeTransportAddress,
  invalidateRuntimeRoute,
} from './routes.js'
import { runtimeRequest } from '../../shared/client.js'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from './runtime.js'

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
  await runtimeRequest(
    connection,
    connection.address,
    '/api/tasks/run',
    { id: 'task' },
    Schema.Struct({ ok: Schema.Boolean }),
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
  await expect(resolveRuntimeRoute(connection, new AbortController().signal)).rejects.toThrow(
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
  expect(await resolveRuntimeRoute(connection, new AbortController().signal)).toBe(
    'http://wrong.local',
  )
  restored = true
  clock.mockReturnValue(61001)
  expect(await resolveRuntimeRoute(connection, new AbortController().signal)).toBe(
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
    await resolveRuntimeRoute(
      { address: 'http://legacy.local', token },
      new AbortController().signal,
    ),
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
  const pending = resolveRuntimeRoute(connection, new AbortController().signal)
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
  expect(await resolveRuntimeRoute(connection, new AbortController().signal)).toBe(
    'http://restored-vpn.local',
  )
})
