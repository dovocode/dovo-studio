import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  snapshotSchema,
  type DesktopSyncSubscription,
  type DesktopSyncEvent,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type startRuntimeSync,
} from '@dovo/protocol'
import { RuntimeConnections } from './runtime-connections.js'
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.useRealTimers()
})
function fixture(recover?: (connection: RuntimeConnection) => Promise<RuntimeConnection | null>) {
  vi.useFakeTimers()
  const options = new Map<string, Parameters<typeof startRuntimeSync>[1]>()
  const online = new Set<string>()
  const stopped: string[] = []
  const start = vi.fn<typeof startRuntimeSync>((connection, callbacks) => {
    options.set(connection.address, callbacks)
    return {
      shared: false,
      online: () => online.has(connection.address),
      retry: vi.fn<() => void>(),
      refresh: vi.fn<() => void>(),
      stop: () => {
        stopped.push(connection.address)
      },
    }
  })
  const snapshot = (tasks: string[]): RuntimeSnapshot =>
    decode(snapshotSchema, {
      revision: 1,
      owner: false,
      detailTaskIds: tasks,
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        repositories: [],
        automations: [],
        tasks: [],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    })
  const read = vi.fn<
    (connection: RuntimeConnection, path: string, signal: AbortSignal) => Promise<RuntimeSnapshot>
  >(async (_connection, path) =>
    snapshot(new URL(path, 'http://fixture').searchParams.getAll('task')),
  )
  const manager = new RuntimeConnections(start, read, recover)
  disposals.push(() => manager.dispose())
  const input = (id: string, tasks = ['thread']): DesktopSyncSubscription => ({
    id,
    connection: { address: 'http://paired.lan:8787', token: 'paired-token-at-least-20-characters' },
    tasks,
    scopes: [],
    detailScopes: [],
  })
  return { manager, start, read, input, options, stopped, online, snapshot }
}
it('shares one stream and fallback poller across main and popout; closing main preserves the popout', async () => {
  const f = fixture(),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main', ['author']), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout', ['reviewer']), (event) => popout.push(event))
  expect(f.start).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(500)
  expect(f.read).toHaveBeenCalledTimes(2)
  const path = f.read.mock.calls[1][1]
  expect(new URL(path, 'http://fixture').searchParams.getAll('task').sort()).toEqual([
    'author',
    'reviewer',
  ])
  expect(main.some((event) => event.type === 'snapshot')).toBe(true)
  expect(popout.some((event) => event.type === 'snapshot')).toBe(true)
  f.manager.unsubscribe('main')
  expect(f.stopped).toEqual([])
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['reviewer']))
  expect(popout.at(-1)?.type).toBe('delta')
  f.manager.unsubscribe('popout')
  expect(f.stopped).toEqual(['http://paired.lan:8787'])
})
it('keeps popouts on their runtime when main switches and isolates credentials', () => {
  const f = fixture(),
    received: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  f.manager.subscribe('popout', f.input('popout'), (event) => received.push(event))
  f.manager.subscribe(
    'main',
    {
      ...f.input('main'),
      connection: { address: 'http://other.lan:8787', token: 'other-token-at-least-20-characters' },
    },
    () => {},
  )
  expect(f.start).toHaveBeenCalledTimes(2)
  expect(f.stopped).toEqual([])
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['thread']))
  expect(received.at(-1)?.type).toBe('snapshot')
  f.manager.subscribe(
    'different-credentials',
    {
      ...f.input('third'),
      connection: {
        ...f.input('third').connection,
        token: 'replacement-token-at-least-20-characters',
      },
    },
    () => {},
  )
  expect(f.start).toHaveBeenCalledTimes(3)
})
it('stops HTTP polling while live and shares disconnect state across windows', async () => {
  const f = fixture(),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  f.online.add('http://paired.lan:8787')
  f.options.get('http://paired.lan:8787')?.onStatus?.('live')
  await vi.advanceTimersByTimeAsync(5000)
  expect(f.read).toHaveBeenCalledOnce()
  f.online.clear()
  f.options.get('http://paired.lan:8787')?.onStatus?.('reconnecting')
  f.read.mockRejectedValue(new Error('Runtime offline'))
  await vi.advanceTimersByTimeAsync(1100)
  expect(main.at(-1)).toEqual({ type: 'error', message: 'Runtime offline' })
  expect(popout.at(-1)).toEqual({ type: 'error', message: 'Runtime offline' })
})
it('replaces eight watched threads without temporarily exceeding the shared limit', () => {
  const f = fixture()
  f.manager.subscribe(
    'main',
    f.input(
      'main',
      Array.from({ length: 8 }, (_, index) => `old-${index}`),
    ),
    () => {},
  )
  expect(() =>
    f.manager.subscribe(
      'main',
      f.input(
        'main',
        Array.from({ length: 8 }, (_, index) => `new-${index}`),
      ),
      () => {},
    ),
  ).not.toThrow()
  expect(() => f.manager.subscribe('popout', f.input('popout', ['ninth']), () => {})).toThrow(
    'eight threads',
  )
})

it('fans one local-runtime recovery out to both windows', async () => {
  const recover = vi.fn<(connection: RuntimeConnection) => Promise<RuntimeConnection | null>>(
    async (connection) => ({ ...connection, address: 'http://127.0.0.1:9999' }),
  )
  const f = fixture(recover),
    main: DesktopSyncEvent[] = [],
    popout: DesktopSyncEvent[] = []
  f.read.mockRejectedValue(new Error('Local runtime moved'))
  f.manager.subscribe('main', f.input('main'), (event) => main.push(event))
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  await vi.advanceTimersByTimeAsync(0)
  expect(recover).toHaveBeenCalledOnce()
  expect(main.at(-1)).toEqual({
    type: 'connection',
    connection: { ...f.input('main').connection, address: 'http://127.0.0.1:9999' },
  })
  expect(popout.at(-1)).toEqual(main.at(-1))
})
it('does not replay a disconnected cached snapshot as a live connection to a new popout', async () => {
  const f = fixture(),
    popout: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), () => {})
  await vi.advanceTimersByTimeAsync(0)
  f.read.mockRejectedValue(new Error('Runtime offline'))
  f.manager.refresh('main', false)
  await vi.advanceTimersByTimeAsync(0)
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  expect(popout.some((event) => event.type === 'snapshot')).toBe(false)
})
it('ignores a late failed HTTP read after the shared stream becomes live', async () => {
  const f = fixture(),
    popout: DesktopSyncEvent[] = []
  let reject!: (error: Error) => void
  f.read.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  f.manager.subscribe('main', f.input('main'), () => {})
  f.online.add('http://paired.lan:8787')
  f.options.get('http://paired.lan:8787')?.onStatus?.('live')
  f.options.get('http://paired.lan:8787')?.onSnapshot(f.snapshot(['thread']))
  reject(new Error('Old HTTP request failed'))
  await vi.advanceTimersByTimeAsync(0)
  f.manager.subscribe('popout', f.input('popout'), (event) => popout.push(event))
  expect(popout.some((event) => event.type === 'snapshot')).toBe(true)
  expect(popout.some((event) => event.type === 'error')).toBe(false)
})
it('sends versioned deltas, restores baselines on refresh and resets epochs after restart', async () => {
  const f = fixture(),
    events: DesktopSyncEvent[] = []
  f.manager.subscribe('main', f.input('main'), (event) => events.push(event))
  await vi.advanceTimersByTimeAsync(500)
  const baseline = events.findLast((event) => event.type === 'snapshot')
  expect(baseline?.type).toBe('snapshot')
  const next = { ...f.snapshot(['thread']), revision: 2, runtimeInstanceId: 'first' }
  f.options.get('http://paired.lan:8787')?.onSnapshot(next)
  const restarted = events.at(-1)
  expect(restarted?.type).toBe('snapshot')
  f.options.get('http://paired.lan:8787')?.onSnapshot({ ...next, revision: 3 })
  const delta = events.at(-1)
  expect(delta).toMatchObject({
    type: 'delta',
    base: expect.any(Number),
    sequence: expect.any(Number),
  })
  if (delta?.type !== 'delta') throw new Error('Expected delta')
  expect(delta.sequence).toBe(delta.base + 1)
  f.manager.refresh('main', false)
  expect(events.at(-1)?.type).toBe('snapshot')
  f.options.get('http://paired.lan:8787')?.onSnapshot({ ...next, runtimeInstanceId: 'second' })
  const second = events.at(-1)
  expect(second?.type).toBe('snapshot')
  if (second?.type !== 'snapshot' || restarted?.type !== 'snapshot')
    throw new Error('Expected restart baselines')
  expect(second.epoch).not.toBe(restarted.epoch)
})
