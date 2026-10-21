import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { PEER_DISCONNECT_GRACE_MS, signPeerSignal, decode, peerSignalSchema } from '@dovo/protocol'
import { openPeerTunnel } from './peer-native'

const native = vi.hoisted(() => ({
  peers: [] as Peer[],
  signals: [] as Signal[],
  servers: [] as Listener[],
  delayBinding: false,
}))
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: async () => new Uint8Array(32).fill(1) }))
vi.mock('react-native-webrtc', () => ({
  RTCPeerConnection: vi.fn<() => Peer>(function () {
    const peer = new Peer()
    native.peers.push(peer)
    return peer
  }),
}))
vi.mock('react-native-tcp-socket', () => ({
  default: {
    createServer: () => {
      const listener = new Listener()
      native.servers.push(listener)
      return listener
    },
  },
}))

class Channel {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
}
class Peer {
  connectionState = 'new'
  iceGatheringState = 'complete'
  onconnectionstatechange: (() => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  localDescription = { sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n' }
  ready = new Channel()
  createDataChannel = () => this.ready
  setConfiguration = vi.fn<() => void>()
  setLocalDescription = vi.fn<() => Promise<void>>(async () => {})
  setRemoteDescription = vi.fn<() => Promise<void>>(async () => {
    this.state('connected')
    this.ready.onopen?.()
  })
  close = vi.fn<() => void>(() => this.state('closed'))
  state(value: string) {
    this.connectionState = value
    this.onconnectionstatechange?.()
  }
}
class Signal {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  send = vi.fn<(data: string) => void>()
  // Native close notifications can be delayed or absent while connecting.
  close = vi.fn<() => void>()
  constructor() {
    native.signals.push(this)
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}
class Listener extends EventEmitter {
  completeBinding: () => void = () => {}
  close = vi.fn<() => void>()
  listen(_options: unknown, callback: () => void) {
    this.completeBinding = callback
    if (!native.delayBinding) callback()
  }
  address = () => ({ port: 12345 })
}

const config = { origin: 'https://connect.dovo.studio', secret: 'a'.repeat(64) }
beforeEach(() => {
  vi.useFakeTimers()
  native.peers.length = 0
  native.signals.length = 0
  native.servers.length = 0
  native.delayBinding = false
  vi.stubGlobal('WebSocket', Signal)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function start() {
  const abort = new AbortController()
  const onClosed = vi.fn<() => void>()
  const result = openPeerTunnel(config, onClosed, abort.signal)
  void result.catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  return { result, abort, onClosed, pc: native.peers[0]!, signal: native.signals[0]! }
}
async function offer(f: Awaited<ReturnType<typeof start>>) {
  f.signal.onopen?.()
  f.signal.message({ type: 'ready' })
  await vi.advanceTimersByTimeAsync(0)
}
async function answer(f: Awaited<ReturnType<typeof start>>) {
  const offer = decode(peerSignalSchema, JSON.parse(f.signal.send.mock.calls.at(-1)![0]))
  f.signal.message(signPeerSignal(config, { ...offer, role: 'answer' }))
  await vi.advanceTimersByTimeAsync(0)
}

it.each(['abort', 'timeout'] as const)(
  'settles setup when %s occurs before signaling readiness, even without native close events',
  async (cause) => {
    const f = await start()
    if (cause === 'abort') f.abort.abort()
    else await vi.advanceTimersByTimeAsync(30000)
    await expect(f.result).rejects.toThrow('Internet connection failed')
    expect(f.pc.close).toHaveBeenCalledOnce()
    expect(f.signal.close).toHaveBeenCalledOnce()
    expect(f.onClosed).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  },
)
it('cancels an unresolved native setLocalDescription without sending a late offer', async () => {
  const f = await start()
  let complete = () => {}
  f.pc.setLocalDescription.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  await offer(f)
  f.abort.abort()
  await expect(f.result).rejects.toThrow('Internet connection failed')
  complete()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.signal.send).toHaveBeenCalledOnce() // Only the broker hello.
  expect(native.servers).toHaveLength(0)
})
it('cancels ICE gathering and removes its native handler and deadline', async () => {
  const f = await start()
  f.pc.iceGatheringState = 'gathering'
  await offer(f)
  expect(f.pc.onicegatheringstatechange).toBeTypeOf('function')
  f.abort.abort()
  await expect(f.result).rejects.toThrow('Internet connection failed')
  expect(f.pc.onicegatheringstatechange).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
  expect(f.signal.send).toHaveBeenCalledOnce()
})
it('uses available candidates when a STUN service does not complete gathering', async () => {
  const f = await start()
  f.pc.iceGatheringState = 'gathering'
  await offer(f)
  await vi.advanceTimersByTimeAsync(4000)
  expect(f.signal.send).toHaveBeenCalledTimes(2)
  await answer(f)
  const tunnel = await f.result
  expect(tunnel.alive()).toBe(true)
  tunnel.close()
  expect(vi.getTimerCount()).toBe(0)
})
it('preserves the tunnel during a temporary disconnect and resets the grace period on recovery', async () => {
  const f = await start()
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  f.pc.state('disconnected')
  expect(tunnel.alive()).toBe(true)
  await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS - 1)
  f.pc.state('connected')
  await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS)
  expect(tunnel.alive()).toBe(true)
  f.pc.state('disconnected')
  await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS - 1)
  f.pc.state('disconnected')
  f.pc.state('connecting')
  await vi.advanceTimersByTimeAsync(1)
  expect(tunnel.alive()).toBe(false)
  expect(f.onClosed).toHaveBeenCalledOnce()
  expect(native.servers[0]!.close).toHaveBeenCalledOnce()
})
it.each(['failed', 'ready-close', 'ready-error'])(
  'closes immediately on terminal transport failure: %s',
  async (cause) => {
    const f = await start()
    await offer(f)
    await answer(f)
    const tunnel = await f.result
    if (cause === 'failed') f.pc.state('failed')
    else if (cause === 'ready-close') f.pc.ready.onclose?.()
    else f.pc.ready.onerror?.()
    expect(tunnel.alive()).toBe(false)
    expect(f.onClosed).toHaveBeenCalledOnce()
  },
)
it('ignores broker errors after an authenticated answer', async () => {
  const f = await start()
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  f.signal.onerror?.()
  expect(tunnel.alive()).toBe(true)
  tunnel.close()
})
it('rejects cancellation during native binding and closes a listener that binds late', async () => {
  native.delayBinding = true
  const f = await start()
  await offer(f)
  await answer(f)
  const listener = native.servers[0]!
  f.abort.abort()
  await expect(f.result).rejects.toThrow('Internet connection failed')
  listener.completeBinding()
  expect(listener.close).toHaveBeenCalledTimes(2)
  expect(f.onClosed).toHaveBeenCalledOnce()
})
