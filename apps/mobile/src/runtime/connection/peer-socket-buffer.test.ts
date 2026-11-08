import { expect, it, vi } from 'vite-plus/test'
import { createPeerPipe } from '../../../../../packages/protocol/src/runtime/connection/peer-pipe'
import Socket from 'react-native-tcp-socket/src/Socket.js'

const native = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<
      (event: {
        id: number
        data?: string
        hadError?: boolean
        connection?: {
          localAddress: string
          localPort: number
          remoteAddress: string
          remotePort: number
          remoteFamily: string
        }
      }) => void
    >
  >()
  return {
    listeners,
    send(
      type: string,
      event: {
        id: number
        data?: string
        hadError?: boolean
        connection?: {
          localAddress: string
          localPort: number
          remoteAddress: string
          remotePort: number
          remoteFamily: string
        }
      },
    ) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    module: {
      connect: vi.fn<(id: number) => void>(),
      pause: vi.fn<(id: number) => void>(),
      resume: vi.fn<(id: number) => void>(),
      destroy: vi.fn<(id: number) => void>(),
      shutdownWrite: vi.fn<(id: number) => void>(),
    },
  }
})
vi.mock('react-native', () => ({
  NativeModules: { TcpSockets: native.module },
  NativeEventEmitter: class {
    addListener(
      type: string,
      listener: (event: {
        id: number
        data?: string
        hadError?: boolean
        connection?: {
          localAddress: string
          localPort: number
          remoteAddress: string
          remotePort: number
          remoteFamily: string
        }
      }) => void,
    ) {
      const listeners = native.listeners.get(type) ?? new Set()
      listeners.add(listener)
      native.listeners.set(type, listeners)
      return { remove: () => listeners.delete(listener) }
    }
  },
}))

function fixture() {
  const socket = new Socket()
  socket.connect({ host: '127.0.0.1', port: 1234 })
  const id = native.module.connect.mock.lastCall![0]
  native.send('connect', {
    id,
    connection: {
      localAddress: '127.0.0.1',
      localPort: 1,
      remoteAddress: '127.0.0.1',
      remotePort: 2,
      remoteFamily: 'IPv4',
    },
  })
  socket.allowHalfOpen = true
  const events: string[] = []
  socket.on('data', (data) => events.push(data.toString()))
  socket.on('end', () => events.push('end'))
  socket.on('close', () => events.push('close'))
  const emit = (type: string, data = {}) => native.send(type, { id, ...data })
  return { socket, events, emit }
}

it('drains paused native data before end and close, respecting a reentrant pause', () => {
  const { socket, events, emit } = fixture()
  socket.readableHighWaterMark = 4
  socket.on('data', () => socket.pause())
  socket.pause()
  emit('data', { data: Buffer.from('abc').toString('base64') })
  emit('data', { data: Buffer.from('defgh').toString('base64') })
  emit('end')
  emit('close', { hadError: false })
  expect(events).toEqual([])
  socket.resume()
  expect(events).toEqual(['abcd'])
  socket.resume()
  expect(events).toEqual(['abcd', 'efgh'])
  socket.resume()
  expect(events).toEqual(['abcd', 'efgh', 'end', 'close'])
})

it('drains a peer pipe after remote end and native close arrive under backpressure', () => {
  const { socket, emit } = fixture()
  const sent: (Uint8Array | string)[] = []
  const pipe = createPeerPipe({
    stream: {
      onData: (f) =>
        socket.on('data', (data) => {
          if (typeof data === 'string') pipe.stop()
          else f(data)
        }),
      onEnd: (f) => socket.on('end', f),
      onClose: (f) => socket.on('close', f),
      onError: (f) => socket.on('error', f),
      write: (_bytes, callback) => callback(),
      pause: () => socket.pause(),
      resume: () => socket.resume(),
      end: () => socket.end(),
      destroy: () => socket.destroy(),
    },
    send: (value) => sent.push(value),
    close: vi.fn<() => void>(),
  })
  pipe.ready()
  const chunk = Buffer.alloc(16384, 1)
  for (let i = 0; i < 10; i++) emit('data', { data: chunk.toString('base64') })
  pipe.receive('end')
  emit('end')
  emit('close', { hadError: false })
  expect(sent.filter((value) => value instanceof Uint8Array)).toHaveLength(8)
  expect(sent).not.toContain('end')
  pipe.receive('ack')
  pipe.receive('ack')
  expect(sent.filter((value) => value instanceof Uint8Array)).toHaveLength(10)
  // The END arrives only after every buffered byte has been delivered to the pipe.
  pipe.receive('ack')
  expect(sent.at(-1)).toBe('end')
})

it('closes after the final end listener pauses, without waiting for another resume', () => {
  const { socket, events, emit } = fixture()
  socket.on('end', () => socket.pause())
  socket.pause()
  emit('data', { data: Buffer.from('last').toString('base64') })
  emit('end')
  emit('close', { hadError: false })
  socket.resume()
  expect(events).toEqual(['last', 'end', 'close'])
})

it('drains a close without EOF, and does not resume an already closed native socket', () => {
  const { socket, events, emit } = fixture()
  native.module.resume.mockClear()
  socket.pause()
  emit('data', { data: Buffer.from('last').toString('base64') })
  emit('close', { hadError: false })
  expect(events).toEqual([])
  socket.resume()
  expect(events).toEqual(['last', 'close'])
  expect(native.module.resume).not.toHaveBeenCalled()
})

it('aborts a deferred graceful close immediately when explicitly destroyed', () => {
  const { socket, events, emit } = fixture()
  socket.pause()
  emit('data', { data: Buffer.from('discard').toString('base64') })
  emit('end')
  emit('close', { hadError: false })
  socket.destroy()
  socket.resume()
  expect(events).toEqual(['close'])
})

it('reports native errors immediately without delivering queued bytes', () => {
  const { socket, events, emit } = fixture()
  socket.on('error', () => events.push('error'))
  native.module.resume.mockClear()
  socket.pause()
  emit('data', { data: Buffer.from('discard').toString('base64') })
  emit('error', { error: 'broken' })
  emit('close', { hadError: true })
  socket.resume()
  expect(events).toEqual(['error', 'close'])
  expect(native.module.resume).not.toHaveBeenCalled()
})

it('does not close the native socket twice when a paused non-half-open stream has already closed', () => {
  const { socket, events, emit } = fixture()
  socket.allowHalfOpen = false
  socket.pause()
  emit('data', { data: Buffer.from('last').toString('base64') })
  emit('end')
  emit('close', { hadError: false })
  socket.resume()
  expect(events).toEqual(['last', 'end', 'close'])
})
