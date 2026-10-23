import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import {
  createPeerHeartbeat,
  PEER_HEARTBEAT_HELLO,
  PEER_HEARTBEAT_INTERVAL_MS,
  PEER_HEARTBEAT_TIMEOUT_MS,
} from './peer-heartbeat'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('does not probe older clients that do not advertise support', async () => {
  const send = vi.fn<(value: string) => void>()
  const timeout = vi.fn<() => void>()
  const peer = createPeerHeartbeat({ send, onTimeout: timeout, connected: () => true })
  peer.announce()
  await vi.advanceTimersByTimeAsync(60000)
  expect(send.mock.calls).toEqual([[PEER_HEARTBEAT_HELLO]])
  expect(timeout).not.toHaveBeenCalled()
  expect(peer.receive('ping')).toBe(false)
  peer.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('detects a silent stalled connection and releases its timers', async () => {
  const send = vi.fn<(value: string) => void>()
  const timeout = vi.fn<() => void>()
  const peer = createPeerHeartbeat({ send, onTimeout: timeout, connected: () => true })
  peer.receive(PEER_HEARTBEAT_HELLO)
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_INTERVAL_MS + PEER_HEARTBEAT_TIMEOUT_MS - 1)
  expect(timeout).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(timeout).toHaveBeenCalledOnce()
  expect(send.mock.calls).toEqual([[PEER_HEARTBEAT_HELLO], ['ping']])
  expect(vi.getTimerCount()).toBe(0)
})

it('exchanges probes in both directions and measures round trips', async () => {
  const timeout = vi.fn<() => void>()
  const rtt = vi.fn<(value: number) => void>()
  const first = createPeerHeartbeat({
    send: (value) => {
      second.receive(value)
    },
    onTimeout: timeout,
    connected: () => true,
    onRoundTrip: rtt,
  })
  const second = createPeerHeartbeat({
    send: (value) => {
      first.receive(value)
    },
    onTimeout: timeout,
    connected: () => true,
  })
  first.announce()
  await vi.advanceTimersByTimeAsync(60000)
  expect(timeout).not.toHaveBeenCalled()
  expect(rtt).toHaveBeenCalledWith(0)
  first.stop()
  second.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('allows temporary ICE interruption and starts a fresh probe after recovery', async () => {
  let connected = true
  const timeout = vi.fn<() => void>()
  const peer = createPeerHeartbeat({
    send: () => {},
    onTimeout: timeout,
    connected: () => connected,
  })
  peer.receive(PEER_HEARTBEAT_HELLO)
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_INTERVAL_MS)
  connected = false
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_TIMEOUT_MS * 2)
  connected = true
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_INTERVAL_MS)
  expect(timeout).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(PEER_HEARTBEAT_TIMEOUT_MS)
  expect(timeout).toHaveBeenCalledOnce()
})

it('treats a native send failure as a closed transport', () => {
  const timeout = vi.fn<() => void>()
  const peer = createPeerHeartbeat({
    send: () => {
      throw new Error('Channel closed')
    },
    onTimeout: timeout,
    connected: () => true,
  })
  peer.receive(PEER_HEARTBEAT_HELLO)
  expect(timeout).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
