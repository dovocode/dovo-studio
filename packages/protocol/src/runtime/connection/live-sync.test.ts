import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  startRuntimeSync,
  runtimeSyncOnline,
  watchRuntimeTask,
  runtimeSnapshotPath,
} from './live-sync.js'
import type { RuntimeSnapshot } from './runtime.js'
import { snapshotSchema } from './runtime.js'
import { decode } from '../../shared/schema.js'
const stopped: Array<() => void> = []
afterEach(() => {
  for (const stop of stopped.splice(0)) stop()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function stalledSocketFixture(address: string) {
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
    vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ticket: 'ticket' })),
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
