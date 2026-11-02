import { expect, it, vi } from 'vite-plus/test'
import { decodeTerminalStreamFrame } from '@dovo/protocol'
import { WebSocket } from 'ws'
import { BinaryTerminalStream } from './binary-stream.js'

it('orders replay and live output, waits for parser acknowledgements, and bounds slow clients', async () => {
  const sent: Uint8Array[] = []
  const socket = {
    readyState: WebSocket.OPEN,
    send: (data: Uint8Array) => sent.push(data),
    close: vi.fn(),
  } as unknown as WebSocket
  const stream = new BinaryTerminalStream(socket)
  stream.replay('🙂' + 'a'.repeat(300_000))
  stream.data('\ud83d')
  stream.data('\ude42live')
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(1))
  await new Promise<void>((resolve) => setImmediate(resolve))
  let frames = sent.map(decodeTerminalStreamFrame)
  expect(frames[0]).toEqual({ type: 'replayStart' })
  expect(frames.some((frame) => frame.type === 'replayEnd')).toBe(false)
  const consumed = frames.reduce(
    (sum, frame) => sum + (frame.type === 'data' ? frame.data.length : 0),
    0,
  )
  expect(consumed).toBeLessThanOrEqual(256 * 1024)
  expect(() => stream.ack(consumed + 1)).toThrow()
  stream.ack(consumed)
  await vi.waitFor(() =>
    expect(sent.map(decodeTerminalStreamFrame).some((frame) => frame.type === 'replayEnd')).toBe(
      true,
    ),
  )
  frames = sent.map(decodeTerminalStreamFrame)
  const text = frames
    .filter((frame) => frame.type === 'data')
    .map((frame) => new TextDecoder('utf-8', { fatal: true }).decode(frame.data))
    .join('')
  expect(text).toBe('🙂' + 'a'.repeat(300_000) + '🙂live')
  stream.data('x'.repeat(4 * 1024 * 1024 + 1))
  expect(socket.close).toHaveBeenCalledWith(1013, 'Terminal client is too slow')
  stream.stop()
})

it('pauses on live backlog, resumes on consumption or detach, and expires a stalled subscriber', async () => {
  const sent: Uint8Array[] = []
  const pressure = vi.fn<(paused: boolean) => void>()
  const socket = {
    readyState: WebSocket.OPEN,
    send: (data: Uint8Array) => sent.push(data),
    close: vi.fn(),
  } as unknown as WebSocket
  const stream = new BinaryTerminalStream(socket, pressure)
  stream.replay('r'.repeat(300_000))
  expect(pressure).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(1))
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.data('x'.repeat(300_000))
  expect(pressure).toHaveBeenLastCalledWith(true)
  const consumed = sent
    .map(decodeTerminalStreamFrame)
    .reduce((sum, frame) => sum + (frame.type === 'data' ? frame.data.length : 0), 0)
  stream.ack(consumed)
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(17))
  const total = sent
    .map(decodeTerminalStreamFrame)
    .reduce((sum, frame) => sum + (frame.type === 'data' ? frame.data.length : 0), 0)
  stream.ack(total - consumed)
  await vi.waitFor(() => expect(pressure).toHaveBeenLastCalledWith(false))
  stream.data('y'.repeat(300_000))
  expect(pressure).toHaveBeenLastCalledWith(true)
  stream.stop()
  expect(pressure).toHaveBeenLastCalledWith(false)

  vi.useFakeTimers()
  try {
    const stalled = new BinaryTerminalStream(socket, pressure)
    stalled.data('z'.repeat(300_000))
    expect(pressure).toHaveBeenLastCalledWith(true)
    vi.advanceTimersByTime(30_000)
    expect(pressure).toHaveBeenLastCalledWith(false)
    expect(socket.close).toHaveBeenCalledWith(1013, 'Terminal client stopped consuming output')
  } finally {
    vi.useRealTimers()
  }
})

it('finishes a split replay surrogate before the replay boundary', async () => {
  const sent: Uint8Array[] = []
  const socket = {
    readyState: WebSocket.OPEN,
    send: (data: Uint8Array) => sent.push(data),
    close: vi.fn(),
  } as unknown as WebSocket
  const stream = new BinaryTerminalStream(socket)
  stream.replay('before\ud83d')
  await vi.waitFor(() => expect(sent.length).toBe(2))
  expect(sent.map(decodeTerminalStreamFrame).some((frame) => frame.type === 'replayEnd')).toBe(
    false,
  )
  stream.data('\ude42after')
  await vi.waitFor(() => expect(sent.length).toBe(5))
  const frames = sent.map(decodeTerminalStreamFrame)
  expect(frames.map((frame) => frame.type)).toEqual([
    'replayStart',
    'data',
    'data',
    'replayEnd',
    'data',
  ])
  expect(
    frames
      .filter((frame) => frame.type === 'data')
      .map((frame) => new TextDecoder().decode(frame.data))
      .join(''),
  ).toBe('before🙂after')
  for (const bytes of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER])
    expect(() => stream.ack(bytes)).toThrow()
  stream.stop()
})

it('accepts a maximum retained replay and applies pressure to concurrent live output', () => {
  const pressure = vi.fn<(paused: boolean) => void>()
  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket
  const stream = new BinaryTerminalStream(socket, pressure)
  stream.replay('\u0800'.repeat(1024 * 1024))
  stream.data('x'.repeat(256 * 1024))
  expect(socket.close).not.toHaveBeenCalled()
  expect(pressure).toHaveBeenCalledWith(true)
  stream.stop()
  expect(pressure).toHaveBeenLastCalledWith(false)
})
