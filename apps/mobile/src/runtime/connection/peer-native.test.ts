import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import {
  PEER_DISCONNECT_GRACE_MS,
  PEER_HEARTBEAT_HELLO,
  PEER_HEARTBEAT_INTERVAL_MS,
  PEER_HEARTBEAT_TIMEOUT_MS,
  signPeerSignal,
  signPeerIce,
  decode,
  peerSignalSchema,
  type PeerConfig,
  type PeerRelay,
} from '@dovo/protocol'
import { openPeerTunnel } from './peer-native'

const native = vi.hoisted(() => ({
  peers: [] as Peer[],
  signals: [] as Signal[],
  servers: [] as Listener[],
  delayBinding: false,
  failReadyChannel: false,
  failSignal: false,
  accept: undefined as ((socket: { destroy: () => void }) => void) | undefined,
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
    createServer: (_options: unknown, accept: (socket: { destroy: () => void }) => void) => {
      native.accept = accept
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
  onmessage: ((event: { data: string }) => void) | null = null
  send = vi.fn<(value: string) => void>()
  addEventListener(_type: string, listener: (event: { data: string }) => void) {
    this.onmessage = listener
  }
}
class Peer {
  connectionState = 'new'
  iceGatheringState = 'complete'
  onconnectionstatechange: (() => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  onicecandidate:
    | ((event: {
        candidate: {
          toJSON: () => { candidate: string; sdpMid: string; sdpMLineIndex: number }
        } | null
      }) => void)
    | null = null
  addEventListener(_type: string, handler: NonNullable<Peer['onicecandidate']>) {
    this.onicecandidate = handler
  }
  createOffer = vi.fn<() => Promise<{ type: string; sdp: string }>>(async () => ({
    type: 'offer',
    sdp: this.localDescription.sdp,
  }))
  addIceCandidate = vi.fn<(candidate: unknown) => Promise<void>>(async () => {})
  localDescription = { sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n' }
  ready = new Channel()
  createDataChannel = vi.fn<() => Channel>(() => {
    if (native.failReadyChannel) throw new Error('Native channel creation failed')
    return this.ready
  })
  setConfiguration = vi.fn<() => void>()
  getStats = vi.fn<() => Promise<Map<string, unknown>>>(async () => new Map())
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
    if (native.failSignal) throw new Error('Native signaling creation failed')
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
const relayCredentials = (): PeerRelay => ({
  provider: 'dovo',
  expiresAt: Date.now() + 180000,
  iceServers: [
    {
      urls: ['turn:turn.dovo.studio:3478?transport=udp'],
      username: 'fixture-user',
      credential: 'fixture-secret',
    },
  ],
})
beforeEach(() => {
  vi.useFakeTimers()
  native.peers.length = 0
  native.signals.length = 0
  native.servers.length = 0
  native.delayBinding = false
  native.failReadyChannel = false
  native.failSignal = false
  native.accept = undefined
  vi.stubGlobal('WebSocket', Signal)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function start(selected: PeerConfig = config) {
  const abort = new AbortController()
  const onClosed = vi.fn<() => void>()
  const onRouteChanged = vi.fn<() => void>()
  const result = openPeerTunnel(selected, onClosed, abort.signal, onRouteChanged)
  void result.catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  return {
    result,
    abort,
    onClosed,
    onRouteChanged,
    pc: native.peers[0]!,
    signal: native.signals[0]!,
  }
}
async function offer(f: Awaited<ReturnType<typeof start>>, relay?: PeerRelay) {
  f.signal.onopen?.()
  f.signal.message({ type: 'ready', ...(relay ? { relay } : {}) })
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

const stats = (local: string, remote: string) =>
  new Map<string, unknown>([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    [
      'pair',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
      },
    ],
    ['local', { type: 'local-candidate', candidateType: local }],
    ['remote', { type: 'remote-candidate', candidateType: remote }],
  ])
it('closes a stalled tunnel only after the computer negotiates health checks', async () => {
  const f = await start()
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  await vi.advanceTimersByTimeAsync(60000)
  expect(tunnel.alive()).toBe(true)
  expect(f.pc.ready.send).not.toHaveBeenCalled()
  f.pc.ready.onmessage?.({ data: PEER_HEARTBEAT_HELLO })
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_INTERVAL_MS + PEER_HEARTBEAT_TIMEOUT_MS)
  expect(tunnel.alive()).toBe(false)
  expect(f.onClosed).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['direct', 'relay', 'unknown'] as const)(
  'rechecks the %s route when TURN credentials expire',
  async (route) => {
    const relay = relayCredentials()
    const f = await start({ ...config, relay: 'dovo' })
    f.pc.getStats.mockResolvedValue(
      route === 'unknown' ? new Map() : stats('host', route === 'relay' ? 'relay' : 'srflx'),
    )
    await offer(f, relay)
    await answer(f)
    const tunnel = await f.result
    await vi.advanceTimersByTimeAsync(120000)
    expect(tunnel.alive()).toBe(route === 'direct')
    if (route === 'direct') {
      // If ICE later switches to an expired relay, request fresh credentials.
      f.pc.getStats.mockResolvedValue(stats('relay', 'host'))
      await vi.advanceTimersByTimeAsync(5000)
    }
    expect(tunnel.alive()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  },
)
it('preserves a direct tunnel through a brief interruption across TURN expiry', async () => {
  const relay = relayCredentials()
  const f = await start({ ...config, relay: 'dovo' })
  f.pc.getStats.mockResolvedValue(stats('host', 'srflx'))
  await offer(f, relay)
  await answer(f)
  const tunnel = await f.result
  await vi.advanceTimersByTimeAsync(119000)
  f.pc.state('disconnected')
  await vi.advanceTimersByTimeAsync(2000)
  expect(tunnel.alive()).toBe(true)
  f.pc.state('connected')
  await vi.advanceTimersByTimeAsync(0)
  expect(tunnel.route()).toBe('direct')
  expect(tunnel.alive()).toBe(true)
  tunnel.close()
  expect(vi.getTimerCount()).toBe(0)
})

it('discards a pre-interruption route report at expiry and checks the recovered relay', async () => {
  const relay = relayCredentials()
  const f = await start({ ...config, relay: 'dovo' })
  f.pc.getStats.mockResolvedValue(stats('host', 'srflx'))
  await offer(f, relay)
  await answer(f)
  const tunnel = await f.result
  await vi.advanceTimersByTimeAsync(119000)
  let finish: (value: Map<string, unknown>) => void = () => {}
  f.pc.getStats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await vi.advanceTimersByTimeAsync(1000)
  f.pc.state('disconnected')
  f.pc.getStats.mockResolvedValue(stats('relay', 'host'))
  f.pc.state('connected')
  finish(stats('host', 'srflx'))
  await vi.advanceTimersByTimeAsync(0)
  expect(tunnel.alive()).toBe(false)
  expect(f.onClosed).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('tracks the selected route and ICE recovery without retaining a route after closure', async () => {
  const f = await start()
  f.pc.getStats.mockResolvedValue(stats('srflx', 'host'))
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  expect(tunnel.route()).toBe('direct')
  f.pc.getStats.mockResolvedValue(stats('host', 'relay'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(tunnel.route()).toBe('relay')
  expect(f.onRouteChanged).toHaveBeenCalledTimes(2)
  f.pc.state('disconnected')
  expect(tunnel.route()).toBeUndefined()
  f.pc.getStats.mockResolvedValue(stats('host', 'host'))
  f.pc.state('connected')
  await vi.advanceTimersByTimeAsync(0)
  expect(tunnel.route()).toBe('direct')
  tunnel.close()
  expect(tunnel.route()).toBeUndefined()
  const reads = f.pc.getStats.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(f.pc.getStats).toHaveBeenCalledTimes(reads)
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps traffic open when native stats fail and ignores a report that arrives after closure', async () => {
  const f = await start()
  f.pc.getStats.mockRejectedValueOnce(new Error('Native stats unavailable'))
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  expect(tunnel.route()).toBeUndefined()
  expect(tunnel.alive()).toBe(true)
  let finish: (value: Map<string, unknown>) => void = () => {}
  f.pc.getStats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await vi.advanceTimersByTimeAsync(5000)
  tunnel.close()
  finish(stats('relay', 'host'))
  await vi.advanceTimersByTimeAsync(0)
  expect(tunnel.route()).toBeUndefined()
  expect(f.onRouteChanged).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('discards route statistics from before ICE recovery and immediately reads the recovered pair', async () => {
  const f = await start()
  f.pc.getStats.mockResolvedValue(stats('host', 'relay'))
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  expect(tunnel.route()).toBe('relay')
  let finish: (value: Map<string, unknown>) => void = () => {}
  f.pc.getStats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await vi.advanceTimersByTimeAsync(5000)
  f.pc.state('disconnected')
  f.pc.state('connected')
  // The old direct-pair report arrives only after a different relay pair recovered.
  finish(stats('host', 'host'))
  await vi.advanceTimersByTimeAsync(0)
  expect(tunnel.route()).toBe('relay')
  expect(f.pc.getStats).toHaveBeenCalledTimes(3)
  expect(f.onRouteChanged).toHaveBeenCalledTimes(3)
  tunnel.close()
  expect(vi.getTimerCount()).toBe(0)
})

it('closes the accepted socket and tunnel if native data-channel creation fails', async () => {
  const f = await start()
  await offer(f)
  await answer(f)
  const tunnel = await f.result
  f.pc.createDataChannel.mockImplementationOnce(() => {
    throw new Error('Native peer already closed')
  })
  const socket = { destroy: vi.fn<() => void>() }
  expect(native.accept).toBeTypeOf('function')
  expect(() => native.accept?.(socket)).not.toThrow()
  expect(socket.destroy).toHaveBeenCalledOnce()
  expect(tunnel.alive()).toBe(false)
  expect(f.pc.close).toHaveBeenCalledOnce()
  expect(f.onClosed).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  {
    stage: 'readiness channel',
    failReadyChannel: true,
    failSignal: false,
    message: 'Native channel creation failed',
  },
  {
    stage: 'signaling socket',
    failReadyChannel: false,
    failSignal: true,
    message: 'Native signaling creation failed',
  },
])(
  'releases the native peer when its $stage cannot be created',
  async ({ failReadyChannel, failSignal, message }) => {
    native.failReadyChannel = failReadyChannel
    native.failSignal = failSignal
    const f = await start()
    await expect(f.result).rejects.toThrow(message)
    expect(f.pc.close).toHaveBeenCalledOnce()
    expect(native.signals).toHaveLength(0)
    expect(native.servers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('sends a signed trickle offer immediately while gathering, buffers answer candidates, and keeps new pipe settings authenticated', async () => {
  const f = await start()
  f.pc.iceGatheringState = 'gathering'
  f.signal.onopen?.()
  f.signal.message({ type: 'ready', trickle: true })
  await vi.advanceTimersByTimeAsync(0)
  const offer = decode(peerSignalSchema, JSON.parse(f.signal.send.mock.calls[1]![0]))
  expect(offer.trickle).toBe(true)
  expect(offer.pipeWindow).toBe(64)
  const candidate = {
    candidate: 'candidate:1 1 UDP 1 192.0.2.1 1234 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  }
  f.pc.onicecandidate?.({ candidate: { toJSON: () => candidate } })
  expect(JSON.parse(f.signal.send.mock.calls[2]![0])).toMatchObject({
    type: 'ice',
    offer: offer.offer,
    candidate,
  })
  f.signal.message(
    signPeerIce(config, {
      type: 'ice',
      session: offer.session,
      offer: offer.offer,
      role: 'answer',
      sequence: 0,
      candidate,
    }),
  )
  expect(f.pc.addIceCandidate).not.toHaveBeenCalled()
  f.signal.message(signPeerSignal(config, { ...offer, role: 'answer' }))
  await vi.advanceTimersByTimeAsync(0)
  const tunnel = await f.result
  expect(tunnel.alive()).toBe(true)
  expect(f.pc.addIceCandidate).toHaveBeenCalledWith(candidate)
  tunnel.close()
  expect(vi.getTimerCount()).toBe(0)
})
it('rejects a trickle answer that changes the negotiated transfer window', async () => {
  const f = await start()
  f.signal.onopen?.()
  f.signal.message({ type: 'ready', trickle: true })
  await vi.advanceTimersByTimeAsync(0)
  const offer = decode(peerSignalSchema, JSON.parse(f.signal.send.mock.calls[1]![0]))
  f.signal.message(signPeerSignal(config, { ...offer, role: 'answer', pipeWindow: undefined }))
  await expect(f.result).rejects.toThrow('identity')
  expect(f.pc.setRemoteDescription).not.toHaveBeenCalled()
})
