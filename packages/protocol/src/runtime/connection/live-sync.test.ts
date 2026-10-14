import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  startRuntimeSync,
  runtimeSyncOnline,
  watchRuntimeTask,
  watchRuntimeActivity,
  runtimeSnapshotPath,
} from './live-sync.js'
import type { RuntimeSnapshot } from './runtime.js'
import { snapshotDelta } from './sync.js'
import { snapshotSchema } from './runtime.js'
import { decode } from '../../shared/schema.js'
const stopped: Array<() => void> = []
afterEach(() => {
  for (const stop of stopped.splice(0)) stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function stalledSocketFixture(address: string, format?: number) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  class Socket {
    static instances: Socket[] = []
    readyState = 0
    sent: string[] = []
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    onerror?: () => void
    onclose?: () => void
    constructor() {
      Socket.instances.push(this)
    }
    send(value: string) {
      this.sent.push(value)
    }
    // Native sockets can fail to deliver onclose after an app is suspended.
    close() {
      this.readyState = 3
    }
  }
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ticket: 'ticket', format })),
  )
  const receive = vi.fn<(value: RuntimeSnapshot) => void>()
  const wake = vi.fn<() => void>()
  const live = startRuntimeSync(
    { address, token: 'stalled-socket-test-token' },
    { onSnapshot: receive, onWake: wake },
  )
  stopped.push(live.stop)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
  const baseline = decode(snapshotSchema, {
    revision: 1,
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
  const frame = JSON.stringify({
    type: 'snapshot',
    epoch: 'stalled',
    sequence: 1,
    tag: 'baseline',
    snapshot: baseline,
  })
  return { clock, Socket, receive, wake, live, frame }
}
it('does not retain late activity frames after the final listener leaves a scope', async () => {
  const address = 'http://late-activity.local'
  const { Socket } = await stalledSocketFixture(address, 5)
  const socket = Socket.instances[0]!
  socket.readyState = 1
  socket.onopen?.()
  const connection = { address, token: 'stalled-socket-test-token' }
  const listen = vi.fn<(events: unknown[]) => void>()
  const stop = watchRuntimeActivity(connection, 'old', listen)
  stop()
  socket.onmessage?.({
    data: JSON.stringify({
      type: 'activity',
      scope: 'old',
      order: ['late'],
      events: [
        {
          id: 'late',
          scope: 'old',
          time: '2026-10-10',
          kind: 'tool',
          summary: 'Obsolete',
          payload: '{}',
        },
      ],
    }),
  })
  stopped.push(watchRuntimeActivity(connection, 'old', listen))
  expect(listen).not.toHaveBeenCalled()
})
it('coalesces thread selection changes on a negotiated stream and ignores obsolete baselines', async () => {
  const address = 'http://live-subscriptions.local'
  const connection = { address, token: 'stalled-socket-test-token' }
  const { Socket, frame, receive, live } = await stalledSocketFixture(address, 5)
  const socket = Socket.instances[0]!
  socket.readyState = 1
  socket.onopen?.()
  socket.onmessage?.({ data: frame })
  const a = watchRuntimeTask(connection, 'a')
  const shared = watchRuntimeTask(connection, 'a')
  stopped.push(a, shared)
  await Promise.resolve()
  expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'watch', tasks: ['a'] })
  a()
  shared()
  const b = watchRuntimeTask(connection, 'b')
  stopped.push(b)
  await Promise.resolve()
  expect(Socket.instances).toHaveLength(1)
  expect(live.online()).toBe(true)
  expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'watch', tasks: ['b'] })
  const baseline = JSON.parse(frame)
  baseline.snapshot.detailTaskIds = ['a']
  socket.onmessage?.({ data: JSON.stringify(baseline) })
  expect(receive).toHaveBeenCalledTimes(1)
  baseline.snapshot.detailTaskIds = ['b']
  baseline.epoch = 'selected-b'
  socket.onmessage?.({ data: JSON.stringify(baseline) })
  expect(receive).toHaveBeenCalledTimes(2)
  expect(receive.mock.lastCall?.[0].detailTaskIds).toEqual(['b'])
})
it('replaces a stale socket immediately on refresh and ignores its late callbacks', async () => {
  const { clock, Socket, receive, live, frame } = await stalledSocketFixture(
    'http://stale-runtime.local',
  )
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  expect(live.online()).toBe(true)
  clock.mockReturnValue(20000)
  live.refresh()
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(2))
  const second = Socket.instances[1]!
  second.readyState = 1
  second.onopen?.()
  second.onmessage?.({ data: frame })
  first.onmessage?.({ data: frame })
  first.onerror?.()
  first.onclose?.()
  expect(receive).toHaveBeenCalledTimes(2)
  expect(live.online()).toBe(true)
  expect(second.readyState).toBe(1)
})
it('recovers a stalled handshake even when the native socket never emits close', async () => {
  const { clock, Socket, wake } = await stalledSocketFixture('http://handshake-runtime.local')
  clock.mockReturnValue(12000)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(2), { timeout: 4000 })
  expect(wake).toHaveBeenCalledOnce()
})
it('does not create duplicate sockets when refreshed during a handshake', async () => {
  const { Socket, live } = await stalledSocketFixture('http://opening-runtime.local')
  live.refresh()
  live.refresh()
  live.refresh()
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
  expect(Socket.instances).toHaveLength(1)
})
it('replaces an open socket that never acknowledges a foreground resume', async () => {
  vi.useFakeTimers()
  const { clock, Socket, live, frame, wake } = await stalledSocketFixture(
    'http://vpn-runtime.local',
  )
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  live.refresh()
  clock.mockReturnValue(4000)
  live.refresh()
  clock.mockReturnValue(6500)
  await vi.advanceTimersByTimeAsync(2000)
  expect(first.readyState).toBe(3)
  expect(Socket.instances).toHaveLength(2)
  expect(wake).toHaveBeenCalledOnce()
  expect(live.online()).toBe(false)
})
it('re-sends an unanswered resume once and stretches the deadline to the measured round trip', async () => {
  vi.useFakeTimers()
  const { clock, Socket, live, frame } = await stalledSocketFixture('http://slow-runtime.local')
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  const sent = vi.spyOn(first, 'send')
  live.refresh()
  clock.mockReturnValue(4000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(sent).toHaveBeenCalledTimes(2)
  clock.mockReturnValue(4500)
  first.onmessage?.({ data: JSON.stringify({ type: 'heartbeat', epoch: 'stalled', sequence: 1 }) })
  // The link answered after 3.5 s; the next resume may take up to 8.75 s before replacement.
  live.refresh()
  clock.mockReturnValue(4500 + 8000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(Socket.instances).toHaveLength(1)
  clock.mockReturnValue(4500 + 9500)
  await vi.advanceTimersByTimeAsync(2000)
  expect(Socket.instances).toHaveLength(2)
})
it('keeps an acknowledged resume online without replacing the healthy socket', async () => {
  vi.useFakeTimers()
  const { clock, Socket, live, frame } = await stalledSocketFixture('http://healthy-runtime.local')
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  live.refresh()
  first.onmessage?.({ data: JSON.stringify({ type: 'heartbeat', epoch: 'stalled', sequence: 1 }) })
  clock.mockReturnValue(8000)
  await vi.advanceTimersByTimeAsync(7000)
  expect(Socket.instances).toHaveLength(1)
  expect(live.online()).toBe(true)
})
it('does not carry a foreground resume deadline into a replacement socket handshake', async () => {
  vi.useFakeTimers()
  const { clock, Socket, live, frame } = await stalledSocketFixture('http://replaced-runtime.local')
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  live.refresh()
  first.readyState = 3
  first.onclose?.()
  clock.mockReturnValue(2000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(Socket.instances).toHaveLength(2)
  clock.mockReturnValue(6500)
  await vi.advanceTimersByTimeAsync(1000)
  expect(Socket.instances).toHaveLength(2)
  expect(Socket.instances[1]!.readyState).toBe(0)
})
it.each([401, 403, 404])(
  'uses HTTP fallback without repeated sync attempts after HTTP %s',
  async (status) => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ error: 'Unavailable' }, { status }))
    vi.stubGlobal('fetch', fetch)
    const wake = vi.fn<() => void>(),
      snapshot = vi.fn<(value: RuntimeSnapshot) => void>(),
      socket = vi.fn<() => WebSocket>()
    vi.stubGlobal('WebSocket', socket)
    const connection = { address: 'http://older-runtime.local', token: 'older-runtime-test-token' }
    const live = startRuntimeSync(connection, { onSnapshot: snapshot, onWake: wake })
    stopped.push(live.stop)
    await vi.advanceTimersByTimeAsync(10)
    expect(wake).toHaveBeenCalledOnce()
    live.refresh()
    await vi.advanceTimersByTimeAsync(65000)
    expect(live.online()).toBe(false)
    expect(runtimeSyncOnline(connection)).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
    expect(socket).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
  },
)
it('cancels an unfinished ticket request when the app backgrounds or switches servers', async () => {
  let signal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('Aborted'))),
      )
    }),
  )
  const wake = vi.fn<() => void>(),
    snapshot = vi.fn<(value: RuntimeSnapshot) => void>()
  const live = startRuntimeSync(
    { address: 'http://pending-runtime.local', token: 'pending-runtime-test-token' },
    { onSnapshot: snapshot, onWake: wake },
  )
  stopped.push(live.stop)
  await vi.waitFor(() => expect(signal).toBeDefined())
  live.stop()
  await vi.waitFor(() => expect(signal?.aborted).toBe(true))
  expect(wake).not.toHaveBeenCalled()
  expect(snapshot).not.toHaveBeenCalled()
})

it('discards a mismatched delta and requests a new baseline instead of guessing', async () => {
  const { decode } = await import('../../shared/schema.js')
  const { snapshotSchema } = await import('./runtime.js')
  const { snapshotDelta } = await import('./sync.js')
  const baseline = decode(snapshotSchema, {
    revision: 1,
    owner: false,
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
  })
  class Socket {
    static instances: Socket[] = []
    readyState = 1
    sent: string[] = []
    onopen?: () => void
    onmessage?: (event: { data: string }) => void
    onerror?: () => void
    onclose?: () => void
    constructor() {
      Socket.instances.push(this)
    }
    send(value: string) {
      this.sent.push(value)
    }
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ticket: 'one-use-ticket' })),
  )
  const receive = vi.fn<(value: RuntimeSnapshot) => void>()
  const live = startRuntimeSync(
    { address: 'http://gap-runtime.local', token: 'gap-runtime-test-token' },
    { onSnapshot: receive },
  )
  stopped.push(live.stop)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
  const first = Socket.instances[0]!
  first.onopen?.()
  first.onmessage?.({
    data: JSON.stringify({
      type: 'snapshot',
      epoch: 'first',
      sequence: 1,
      tag: 'baseline',
      snapshot: baseline,
    }),
  })
  expect(live.online()).toBe(true)
  first.onmessage?.({ data: JSON.stringify({ type: 'heartbeat', epoch: 'first', sequence: 1 }) })
  expect(receive).toHaveBeenCalledOnce()
  first.onmessage?.({
    data: JSON.stringify({
      type: 'delta',
      epoch: 'first',
      sequence: 3,
      base: 2,
      tag: 'next',
      delta: snapshotDelta(baseline, baseline),
    }),
  })
  expect(live.online()).toBe(false)
  expect(receive).toHaveBeenCalledOnce()
  live.refresh()
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(2))
  const second = Socket.instances[1]!
  second.onopen?.()
  expect(JSON.parse(second.sent[0]!)).toEqual({ type: 'resume' })
})

it('reference counts thread subscriptions and drops the old cursor when the scope changes', async () => {
  const address = 'http://scoped-runtime.local'
  const connection = { address, token: 'stalled-socket-test-token' }
  const { Socket, live, frame } = await stalledSocketFixture(address)
  const first = Socket.instances[0]!
  first.readyState = 1
  first.onopen?.()
  first.onmessage?.({ data: frame })
  const a = watchRuntimeTask(connection, 'thread-a')
  const shared = watchRuntimeTask(connection, 'thread-a')
  stopped.push(a, shared)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(2))
  const second = Socket.instances[1]!
  second.readyState = 1
  second.onopen?.()
  expect(JSON.parse(second.sent[0]!)).toEqual({ type: 'resume' })
  expect(runtimeSnapshotPath(connection)).toBe(
    '/api/snapshot?scope=threads&history=paged&task=thread-a',
  )
  a()
  expect(second.readyState).toBe(1)
  expect(runtimeSnapshotPath(connection)).toContain('task=thread-a')
  // Stopping a stream must preserve subscriptions owned by its mounted views.
  live.stop()
  expect(runtimeSnapshotPath(connection)).toContain('task=thread-a')
  shared()
  expect(runtimeSnapshotPath(connection)).toBe('/api/snapshot?scope=threads&history=paged')
})

it.each([401, 403, 404])(
  'explicit recovery rechecks a previously rejected ticket (%s)',
  async (status) => {
    const connection = {
      address: `http://rejected-${status}.local`,
      token: 'rejected-runtime-test-token',
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'Rejected' }, { status }))
    vi.stubGlobal('fetch', fetcher)
    class Socket {
      static instances: Socket[] = []
      readyState = 0
      constructor() {
        Socket.instances.push(this)
      }
      close() {}
      send() {}
    }
    vi.stubGlobal('WebSocket', Socket)
    const onStatus = vi.fn<(status: import('./live-sync.js').RuntimeSyncStatus) => void>()
    const live = startRuntimeSync(connection, { onSnapshot: () => {}, onStatus })
    stopped.push(live.stop)
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith(
        status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'unsupported',
      ),
    )
    fetcher.mockResolvedValue(Response.json({ ticket: 'recovered' }))
    live.retry()
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)

it('increases backoff across briefly healthy sessions and resets after sustained health', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const { Socket, live, frame, clock } = await stalledSocketFixture('http://flapping-backoff.local')
  const receive = (socket: InstanceType<typeof Socket>) => {
    socket.readyState = 1
    socket.onmessage?.({ data: frame })
    socket.onerror?.()
  }
  receive(Socket.instances[0]!)
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(2)
  receive(Socket.instances[1]!)
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(3)
  const third = Socket.instances[2]!
  third.readyState = 1
  third.onmessage?.({ data: frame })
  clock.mockReturnValue(32000)
  third.onmessage?.({ data: frame })
  third.onerror?.()
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(4)
  expect(live.online()).toBe(false)
})

it('uses the desktop connection owner for snapshots, activity, watches and retry without opening a renderer socket', () => {
  const connection = {
    address: 'http://desktop-shared.lan:8787',
    token: 'desktop-shared-runtime-token',
  }
  let receive: ((event: import('./desktop-sync.js').DesktopSyncEvent) => void) | undefined
  const stop = vi.fn<() => void>()
  const subscribe = vi.fn<import('./desktop-sync.js').DesktopRuntimeSyncBridge['subscribe']>(
    (_input, listener) => {
      receive = listener
      return stop
    },
  )
  const update = vi.fn<import('./desktop-sync.js').DesktopRuntimeSyncBridge['update']>()
  const refresh = vi.fn<import('./desktop-sync.js').DesktopRuntimeSyncBridge['refresh']>()
  vi.stubGlobal('window', { dovo: { runtimeSync: { subscribe, update, refresh } } })
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const task = watchRuntimeTask(connection, 'author')
  const activity =
    vi.fn<
      (
        events: (typeof import('../../automation/activity.js').activitySchema.Type)['events'],
      ) => void
    >()
  const unwatch = watchRuntimeActivity(connection, 'author', activity, true)
  const snapshot = vi.fn<(value: RuntimeSnapshot) => void>()
  const error = vi.fn<(value: string) => void>()
  const live = startRuntimeSync(connection, { onSnapshot: snapshot, onError: error })
  stopped.push(() => {
    live.stop()
    task()
    unwatch()
  })
  expect(live.shared).toBe(true)
  expect(subscribe.mock.calls[0][0]).toMatchObject({
    tasks: ['author'],
    scopes: ['author'],
    detailScopes: ['author'],
  })
  const reviewer = watchRuntimeTask(connection, 'reviewer')
  stopped.push(reviewer)
  expect(update.mock.calls.at(-1)?.[0].tasks).toEqual(['author', 'reviewer'])
  receive?.({ type: 'status', status: 'live', online: true })
  expect(runtimeSyncOnline(connection, 'author')).toBe(true)
  receive?.({ type: 'activity', scope: 'author', events: [] })
  expect(activity).toHaveBeenCalledWith([])
  const baseline = decode(snapshotSchema, {
    revision: 1,
    owner: false,
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
  receive?.({ type: 'snapshot', snapshot: baseline, epoch: 'epoch', sequence: 1 })
  const next = { ...baseline, revision: 2 }
  receive?.({
    type: 'delta',
    delta: snapshotDelta(baseline, next, true, true),
    epoch: 'epoch',
    base: 1,
    sequence: 2,
  })
  expect(snapshot.mock.calls.at(-1)?.[0].revision).toBe(2)
  expect(snapshot.mock.calls.at(-1)?.[0].workspace.agents).toBe(baseline.workspace.agents)
  receive?.({
    type: 'delta',
    delta: snapshotDelta(baseline, next, true, true),
    epoch: 'epoch',
    base: 7,
    sequence: 8,
  })
  expect(refresh).toHaveBeenLastCalledWith(expect.any(String), false)
  expect(snapshot).toHaveBeenCalledTimes(2)
  refresh.mockClear()
  receive?.({ type: 'error', message: 'Runtime offline' })
  expect(live.online()).toBe(false)
  expect(error).toHaveBeenCalledWith('Runtime offline')
  live.refresh()
  live.retry()
  expect(refresh.mock.calls.map((call) => call[1])).toEqual([false, true])
  expect(fetcher).not.toHaveBeenCalled()
  live.stop()
  expect(stop).toHaveBeenCalledOnce()
  receive?.({ type: 'activity', scope: 'author', events: [] })
  expect(activity).toHaveBeenCalledTimes(1)
})
