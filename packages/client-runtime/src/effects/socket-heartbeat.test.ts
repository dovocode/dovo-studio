import { afterEach, expect, it, vi } from 'vitest'
import { startSocketHeartbeat } from './socket-heartbeat.js'
afterEach(() => vi.useRealTimers())
const pong = (nonce: string) =>
  new TextEncoder().encode(JSON.stringify({ type: 'pong', nonce })).buffer
it('keeps an idle but responsive connection alive and detects a silent loss', async () => {
  vi.useFakeTimers()
  const send = vi.fn<(message: string) => void>()
  const expired = vi.fn<() => void>()
  const heartbeat = startSocketHeartbeat(send, expired)
  expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping', nonce: '1' }))
  heartbeat.receive(pong('1'))
  await vi.advanceTimersByTimeAsync(15000)
  heartbeat.receive(pong('2'))
  await vi.advanceTimersByTimeAsync(15000)
  // An old acknowledgement and ordinary output cannot keep a dead socket alive.
  heartbeat.receive(pong('2'))
  heartbeat.receive('terminal output')
  await vi.advanceTimersByTimeAsync(10000)
  expect(expired).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60000)
  expect(send).toHaveBeenCalledTimes(3)
})
it('removes its watchdog and heartbeat when a connection is replaced', async () => {
  vi.useFakeTimers()
  const send = vi.fn<(message: string) => void>()
  const expired = vi.fn<() => void>()
  const heartbeat = startSocketHeartbeat(send, expired)
  heartbeat.stop()
  await vi.advanceTimersByTimeAsync(60000)
  expect(send).toHaveBeenCalledOnce()
  expect(expired).not.toHaveBeenCalled()
})
