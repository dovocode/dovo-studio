/// <reference types="node" />
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { encodeTerminalStreamFrame, type TerminalStreamFrame } from '@dovo/protocol/terminal-stream'
import {
  binaryStreamUrl,
  bytesToBase64,
  openTerminalStream,
  terminalGridSize,
  terminalResetSequence,
  terminalStatusQuery,
  terminalStatusReport,
  terminalStreamWindow,
  type TerminalOutput,
  type TerminalStreamProtocol,
  type TerminalStreamSocket,
  webSocketTerminalSocket,
} from './terminal-stream'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** WebSocket binary messages are standalone ArrayBuffers. */
function arrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

class Socket implements TerminalStreamSocket {
  readyState = 0
  onopen: TerminalStreamSocket['onopen'] = null
  onmessage: TerminalStreamSocket['onmessage'] = null
  onclose: TerminalStreamSocket['onclose'] = null
  onerror: TerminalStreamSocket['onerror'] = null
  sent: string[] = []
  closed = false
  constructor(readonly url: string) {}
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  frame(frame: TerminalStreamFrame) {
    const bytes = encodeTerminalStreamFrame(frame)
    this.onmessage?.({ data: arrayBuffer(bytes) })
  }
  data(text: string) {
    this.frame({ type: 'data', data: new TextEncoder().encode(text) })
  }
  frames() {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>)
  }
  of(type: string) {
    return this.frames().filter((frame) => frame.type === type)
  }
}

type Pending = { output: TerminalOutput; resolve: () => void; reject: (error: Error) => void }

function fixture({
  size = { cols: 80, rows: 24 } as { cols: number; rows: number } | null,
  protocol = 'binary-v1' as TerminalStreamProtocol,
  manual = false,
} = {}) {
  let socket!: Socket
  const events: string[] = []
  const written: string[] = []
  const pending: Pending[] = []
  const failures: Error[] = []
  const text = (output: TerminalOutput) =>
    typeof output === 'string' ? output : new TextDecoder().decode(output)
  const stream = openTerminalStream({
    url: 'ws://computer.local:51464/ws/terminal?ticket=t',
    protocol,
    size: () => size ?? undefined,
    onOpen: () => events.push('open'),
    onReady: () => events.push('ready'),
    write: (output) => {
      if (!manual) {
        written.push(text(output))
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) =>
        pending.push({
          output,
          resolve: () => {
            written.push(text(output))
            resolve()
          },
          reject,
        }),
      )
    },
    onClose: (error) => failures.push(error),
    createSocket: (url) => (socket = new Socket(url)),
  })
  return { stream, socket, events, written, pending, failures }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

/** Opens the socket and clears an empty replay's barrier, as a runtime connection does. */
async function openReady({ socket, stream }: ReturnType<typeof fixture>) {
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.frame({ type: 'replayEnd' })
  await settle()
  stream.input(terminalStatusReport)
  socket.sent = []
}

it('requests binary stream v1 on the unchanged runtime URL, including HTTP LAN/VPN', () => {
  expect(fixture().socket.url).toBe(
    'ws://computer.local:51464/ws/terminal?ticket=t&stream=binary-v1',
  )
  expect(fixture({ protocol: 'text' }).socket.url).toBe(
    'ws://computer.local:51464/ws/terminal?ticket=t',
  )
  expect(binaryStreamUrl('ws://host/ws/terminal')).toBe('ws://host/ws/terminal?stream=binary-v1')
  expect(binaryStreamUrl('ws://host/t?ticket=a#x')).toBe('ws://host/t?ticket=a&stream=binary-v1#x')
})

it('encodes base64 like Buffer for every padding case and a full server frame', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 16 * 1024]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  }
})

it('sends the grid size on open, then heartbeats', () => {
  const { socket, stream, events } = fixture()
  expect(stream.open).toBe(false)
  socket.open()
  expect(stream.open).toBe(true)
  expect(events).toEqual(['open'])
  expect(socket.frames()).toEqual([
    { type: 'resize', cols: 80, rows: 24 },
    { type: 'ping', nonce: '1' },
  ])
})

it('waits for a renderer size and ignores unchanged resizes', () => {
  const { socket, stream } = fixture({ size: null })
  stream.resize({ cols: 100, rows: 30 })
  socket.open()
  expect(socket.of('resize')).toEqual([])
  stream.resize({ cols: 100, rows: 30 })
  stream.resize({ cols: 100, rows: 30 })
  stream.resize({ cols: 90, rows: 30 })
  expect(socket.of('resize')).toEqual([
    { type: 'resize', cols: 100, rows: 30 },
    { type: 'resize', cols: 90, rows: 30 },
  ])
})

it('resets before a binary replay and writes frames strictly in order', async () => {
  const { socket, stream, pending, written } = fixture({ manual: true })
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.data('history ')
  socket.data('é')
  socket.frame({ type: 'replayEnd' })
  socket.data('live')
  await settle()
  // Only one native write is in flight at a time.
  expect(pending.map((write) => write.output)).toEqual([terminalResetSequence])
  for (let index = 0; index < 4; index++) {
    pending[index]!.resolve()
    await settle()
    expect(pending).toHaveLength(index + 2)
  }
  pending[4]!.resolve()
  await settle()
  expect(written).toEqual([terminalResetSequence, 'history ', 'é', terminalStatusQuery, 'live'])
  expect(stream.protocol).toBe('binary-v1')
})

it('acknowledges each data frame only after the renderer accepted it', async () => {
  const { socket, pending } = fixture({ manual: true })
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.frame({ type: 'replayEnd' })
  socket.data('ab')
  socket.data('é😀')
  await settle()
  pending[0]!.resolve() // reset
  await settle()
  pending[1]!.resolve() // status query
  await settle()
  expect(socket.of('ack')).toEqual([])
  expect(pending[2]!.output).toBeInstanceOf(Uint8Array)
  pending[2]!.resolve()
  await settle()
  expect(socket.of('ack')).toEqual([{ type: 'ack', bytes: 2 }])
  pending[3]!.resolve()
  await settle()
  expect(socket.of('ack')).toEqual([
    { type: 'ack', bytes: 2 },
    { type: 'ack', bytes: 6 },
  ])
})

it('drops emulator answers to replayed queries until the replay barrier is answered', async () => {
  const { socket, stream } = fixture()
  socket.open()
  socket.frame({ type: 'replayStart' })
  // A replayed DSR 5 split across frames, plus a device attributes query.
  socket.data('prompt \x1b[')
  socket.data('5n\x1b[c')
  socket.frame({ type: 'replayEnd' })
  await settle()
  socket.sent = []
  stream.input('\x1b[?1;2c') // answer to the replayed DA query
  stream.input(terminalStatusReport) // answer to the replayed DSR 5
  expect(socket.of('input')).toEqual([])
  stream.input(terminalStatusReport) // the barrier
  stream.input('ls\r')
  expect(socket.of('input')).toEqual([{ type: 'input', data: 'ls\r' }])
})

it('stops suppressing input if the renderer never answers the barrier', async () => {
  const { socket, stream } = fixture()
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.frame({ type: 'replayEnd' })
  await settle()
  stream.input('dropped')
  await vi.advanceTimersByTimeAsync(1500)
  stream.input('kept')
  expect(socket.of('input')).toEqual([{ type: 'input', data: 'kept' }])
})

it('answers heartbeats with framed binary pongs', async () => {
  const { socket, failures } = fixture()
  socket.open()
  socket.frame({ type: 'pong', nonce: '1' })
  await vi.advanceTimersByTimeAsync(15_000)
  socket.frame({ type: 'pong', nonce: '2' })
  await vi.advanceTimersByTimeAsync(9_000)
  expect(failures).toEqual([])
  expect(socket.of('ping')).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(16_000)
  expect(failures.map((error) => error.message)).toEqual(['Terminal stopped responding.'])
})

it('fails on an invalid binary frame once binary v1 is established', () => {
  const { socket, failures } = fixture()
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.onmessage?.({ data: Uint8Array.of(9).buffer })
  expect(failures.map((error) => error.message)).toEqual(['Invalid terminal stream frame'])
  expect(socket.closed).toBe(true)
})

it('falls back to the legacy text stream for runtimes without binary v1', async () => {
  const { socket, stream, written } = fixture()
  socket.open()
  // A legacy runtime ignores stream=binary-v1: raw JSON pongs and text output.
  socket.onmessage?.({
    data: arrayBuffer(new TextEncoder().encode(JSON.stringify({ type: 'pong', nonce: '1' }))),
  })
  socket.onmessage?.({ data: 'history' })
  socket.onmessage?.({ data: 'live' })
  await settle()
  expect(stream.protocol).toBe('text')
  expect(written).toEqual([terminalResetSequence, 'history', terminalStatusQuery, 'live'])
  expect(socket.of('ack')).toEqual([])
  stream.input('dropped')
  stream.input(terminalStatusReport)
  stream.input('kept')
  expect(socket.of('input')).toEqual([{ type: 'input', data: 'kept' }])
  await vi.advanceTimersByTimeAsync(15_000)
  expect(socket.of('ping')).toHaveLength(2)
})

it('keeps the explicit legacy text stream available', async () => {
  const { socket, stream, written } = fixture({ protocol: 'text' })
  socket.open()
  socket.onmessage?.({ data: 'history' })
  await settle()
  expect(stream.protocol).toBe('text')
  expect(written).toEqual([terminalResetSequence, 'history', terminalStatusQuery])
})

it('frames large and multi-byte input without splitting surrogates', async () => {
  const connection = fixture()
  const { socket, stream } = connection
  stream.input('ignored before open')
  await openReady(connection)
  const text = `${'a'.repeat(16 * 1024 - 1)}😀tail`
  stream.input(text)
  const frames = socket.of('input')
  expect(frames).toHaveLength(2)
  expect(frames.map((frame) => frame.data).join('')).toBe(text)
  expect(String(frames[0]!.data).length).toBe(16 * 1024 - 1)
})

it('forwards control sequences from the native accessory bar unchanged', async () => {
  const connection = fixture()
  const { socket, stream } = connection
  await openReady(connection)
  const keys = ['\x03', '\x1b', '\t', '\x1b[A', '\x1b[1;5D', '\x1bb', '\x1b[200~paste\x1b[201~']
  for (const data of keys) stream.input(data)
  expect(socket.of('input').map((frame) => frame.data)).toEqual(keys)
})

it('holds at most the runtime credit window while the renderer is busy', async () => {
  const { socket, pending, failures } = fixture({ manual: true })
  socket.open()
  const chunk = 'x'.repeat(16 * 1024)
  // A runtime honouring the window: 256 KiB outstanding while the renderer has not accepted any.
  for (let sent = 0; sent < terminalStreamWindow; sent += chunk.length) socket.data(chunk)
  await settle()
  expect(failures).toEqual([])
  expect(pending).toHaveLength(1)
  // Accepting output acknowledges it, which is what lets the runtime send more.
  pending[0]!.resolve()
  await settle()
  expect(socket.of('ack')).toEqual([{ type: 'ack', bytes: chunk.length }])
  socket.data(chunk)
  await settle()
  expect(failures).toEqual([])
})

it('disconnects instead of queueing output beyond the credit window', async () => {
  const { socket, pending, failures } = fixture({ manual: true })
  socket.open()
  const chunk = 'x'.repeat(16 * 1024)
  for (let sent = 0; sent < terminalStreamWindow; sent += chunk.length) socket.data(chunk)
  socket.data('overflow')
  await settle()
  expect(failures.map((error) => error.message)).toEqual([
    'The runtime exceeded the terminal flow-control window.',
  ])
  expect(socket.closed).toBe(true)
  // The overrun is detected before the queued output reaches the renderer or is acknowledged.
  await vi.advanceTimersByTimeAsync(1000)
  expect(pending).toHaveLength(0)
  expect(socket.of('ack')).toEqual([])
})

it('fails the connection without acknowledging when a native write is rejected', async () => {
  const { socket, pending, failures } = fixture({ manual: true })
  socket.open()
  socket.data('x')
  await settle()
  pending[0]!.reject(new Error('unable to find view'))
  await settle()
  expect(failures.map((error) => error.message)).toEqual(['unable to find view'])
  expect(socket.of('ack')).toEqual([])
  expect(socket.closed).toBe(true)
})

it('skips queued output and acknowledgements after the owner closes', async () => {
  const { socket, stream, pending, failures } = fixture({ manual: true })
  socket.open()
  socket.data('a')
  socket.data('b')
  await settle()
  stream.close()
  pending[0]!.resolve()
  await settle()
  expect(pending).toHaveLength(1)
  expect(socket.of('ack')).toEqual([])
  expect(failures).toEqual([])
})

it('reports a close reason once and stops sending', async () => {
  const { socket, stream, failures } = fixture()
  socket.open()
  socket.readyState = 3
  socket.onclose?.({ reason: 'Device revoked' })
  socket.onerror?.()
  expect(failures.map((error) => error.message)).toEqual(['Device revoked'])
  expect(stream.open).toBe(false)
  const sent = socket.sent.length
  stream.input('x')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(socket.sent.length).toBe(sent)
})

it('falls back to generic close and error messages', () => {
  const closed = fixture()
  closed.socket.onclose?.({ reason: '' })
  expect(closed.failures[0]?.message).toBe('Terminal disconnected.')
  const errored = fixture()
  errored.socket.onerror?.()
  expect(errored.failures[0]?.message).toBe('Terminal connection failed.')
  expect(errored.socket.closed).toBe(true)
})

it('treats a throwing send as a connection failure', async () => {
  const connection = fixture()
  const { socket, stream, failures } = connection
  await openReady(connection)
  socket.send = () => {
    throw new Error('send failed')
  }
  stream.input('x')
  expect(failures.map((error) => error.message)).toEqual(['send failed'])
})

it('clamps renderer sizes to the runtime schema bounds', () => {
  expect(terminalGridSize(1, 0)).toEqual({ cols: 2, rows: 1 })
  expect(terminalGridSize(900.7, 400.2)).toEqual({ cols: 500, rows: 300 })
  expect(terminalGridSize(80.9, 24.2)).toEqual({ cols: 80, rows: 24 })
  expect(terminalGridSize(Number.NaN, 24)).toBeUndefined()
})

it('adapts a platform WebSocket without changing its URL or event data', () => {
  class FakeWebSocket {
    static instance: FakeWebSocket
    binaryType = 'blob'
    readyState = 0
    sent: string[] = []
    closed = false
    onopen: (() => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    onclose: ((event: { reason: string }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(readonly url: string) {
      FakeWebSocket.instance = this
    }
    send(data: string) {
      this.sent.push(data)
    }
    close() {
      this.closed = true
    }
  }
  vi.stubGlobal('WebSocket', FakeWebSocket)
  try {
    const adapter = webSocketTerminalSocket('ws://10.0.0.2:51464/ws/terminal?ticket=t')
    const socket = FakeWebSocket.instance
    expect(socket.url).toBe('ws://10.0.0.2:51464/ws/terminal?ticket=t')
    expect(socket.binaryType).toBe('arraybuffer')
    const events: unknown[] = []
    adapter.onopen = () => events.push('open')
    adapter.onmessage = (event) => events.push(event.data)
    adapter.onclose = (event) => events.push(`close:${event.reason}`)
    adapter.onerror = () => events.push('error')
    socket.readyState = 1
    expect(adapter.readyState).toBe(1)
    const buffer = new ArrayBuffer(2)
    socket.onopen?.()
    socket.onmessage?.({ data: 'text' })
    socket.onmessage?.({ data: buffer })
    socket.onmessage?.({ data: { size: 1 } }) // not text or ArrayBuffer: ignored
    socket.onerror?.()
    socket.onclose?.({ reason: 'Device revoked' })
    expect(events).toEqual(['open', 'text', buffer, 'error', 'close:Device revoked'])
    adapter.send('{"type":"ping"}')
    adapter.close()
    expect(socket.sent).toEqual(['{"type":"ping"}'])
    expect(socket.closed).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('is not ready for input on socket open, only once the first replay barrier clears', async () => {
  const { socket, stream, events } = fixture()
  socket.open()
  expect(events).toEqual(['open'])
  expect(stream.inputReady).toBe(false)
  // Before the replay starts and while it replays, every input is dropped.
  stream.input('typed before replay')
  socket.frame({ type: 'replayStart' })
  socket.data('history')
  socket.frame({ type: 'replayEnd' })
  await settle()
  stream.input('typed during replay')
  expect(stream.inputReady).toBe(false)
  expect(socket.of('input')).toEqual([])
  stream.input(terminalStatusReport)
  expect(events).toEqual(['open', 'ready'])
  expect(stream.inputReady).toBe(true)
  stream.input('ls\r')
  expect(socket.of('input')).toEqual([{ type: 'input', data: 'ls\r' }])
})

it('becomes ready through the barrier timeout and reports readiness only once', async () => {
  const { socket, stream, events } = fixture()
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.frame({ type: 'replayEnd' })
  await settle()
  await vi.advanceTimersByTimeAsync(1499)
  expect(stream.inputReady).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(stream.inputReady).toBe(true)
  stream.input(terminalStatusReport)
  expect(events).toEqual(['open', 'ready'])
})

it('is not ready after the connection ends', async () => {
  const connection = fixture()
  await openReady(connection)
  expect(connection.stream.inputReady).toBe(true)
  connection.stream.close()
  expect(connection.stream.inputReady).toBe(false)
  expect(connection.events).toEqual(['open', 'ready'])
})

it('never reports readiness for a connection that closes during the replay', async () => {
  const { socket, events } = fixture()
  socket.open()
  socket.frame({ type: 'replayStart' })
  socket.frame({ type: 'replayEnd' })
  await settle()
  socket.readyState = 3
  socket.onclose?.({ reason: '' })
  await vi.advanceTimersByTimeAsync(5000)
  expect(events).toEqual(['open'])
})
