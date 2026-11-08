import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { IpcMainEvent } from 'electron'

const f = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainEvent, input: unknown) => void>(),
  ports: [] as MockPort[],
  sockets: [] as MockSocket[],
}))
class MockPort extends EventEmitter {
  postMessage = vi.fn<(data: unknown) => void>()
  start = vi.fn<() => void>()
  close = vi.fn<() => void>()
}
class MockSocket extends EventEmitter {
  static OPEN = 1
  readyState = 0
  bufferedAmount = 0
  send = vi.fn<(data: string) => void>()
  close = vi.fn<() => void>()
  constructor(
    public url: URL,
    public options: unknown,
  ) {
    super()
    f.sockets.push(this)
  }
}
vi.doMock('electron', () => ({
  ipcMain: {
    on: (name: string, handler: (event: IpcMainEvent, input: unknown) => void) =>
      f.handlers.set(name, handler),
    removeListener: (name: string) => f.handlers.delete(name),
  },
  MessageChannelMain: class {
    port1 = new MockPort()
    port2 = new MockPort()
    constructor() {
      f.ports.push(this.port1, this.port2)
    }
  },
}))
vi.doMock('ws', () => ({ WebSocket: MockSocket }))
const { registerTerminalPorts } = await import('./terminal-ports.js')

afterEach(() => {
  f.handlers.clear()
  f.ports.length = 0
  f.sockets.length = 0
  vi.unstubAllEnvs()
})
function renderer(url = 'file:///app/index.html') {
  const frame = {
    url,
    postMessage: vi.fn<(channel: string, message: unknown, ports: unknown[]) => void>(),
  }
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame })
  return { sender, frame, event: { sender, senderFrame: frame } as unknown as IpcMainEvent }
}
const input = {
  id: '7d25eeac-d240-4e60-b68f-f0ea11478954',
  url: 'ws://runtime.local/ws/terminal?ticket=one&stream=binary-v1',
}
function connect(event: IpcMainEvent, value: unknown = input) {
  f.handlers.get('terminal:connect')!(event, value)
}

it('bridges binary bytes and input without exposing pooled buffer bytes', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event, frame } = renderer()
  connect(event)
  const port = f.ports[0]!,
    socket = f.sockets[0]!
  expect(frame.postMessage).toHaveBeenCalledWith('terminal:port', { id: input.id }, [f.ports[1]])
  expect(socket.options).toEqual({ maxPayload: 4 * 1024 * 1024, handshakeTimeout: 10000 })
  socket.readyState = 1
  socket.emit('open')
  port.emit('message', { data: '{"type":"ack","bytes":2}' })
  expect(socket.send).toHaveBeenCalledWith('{"type":"ack","bytes":2}')
  const pooled = Buffer.from([9, 0, 65, 9])
  socket.emit('message', pooled.subarray(1, 3), true)
  const message = port.postMessage.mock.calls.at(-1)![0] as { type: string; data: ArrayBuffer }
  expect(message.type).toBe('data')
  expect([...new Uint8Array(message.data)]).toEqual([0, 65])
  expect(message.data.byteLength).toBe(2)
  manager.dispose()
  expect(socket.close).toHaveBeenCalledOnce()
})

it('rejects untrusted frames and invalid endpoints', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const foreign = renderer('https://other.example/')
  connect(foreign.event)
  const trusted = renderer()
  connect({ ...trusted.event, senderFrame: foreign.event.senderFrame } as IpcMainEvent)
  expect(f.ports).toHaveLength(0)
  for (const url of [
    'file:///ws/terminal?ticket=a&stream=binary-v1',
    'ws://u:p@host/ws/terminal?ticket=a&stream=binary-v1',
    'ws://host/ws/terminal?stream=binary-v1',
    'ws://host/ws/terminal?ticket=a',
  ])
    connect(trusted.event, { ...input, url })
  expect(f.sockets).toHaveLength(0)
  expect(
    f.ports
      .filter((_, index) => index % 2 === 0)
      .every((port) => port.postMessage.mock.calls[0]?.[0] && port.close.mock.calls.length === 1),
  ).toBe(true)
  manager.dispose()
})

it('closes owned sockets on navigation and destroy without accumulating listeners', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event, sender } = renderer()
  connect(event)
  sender.emit('did-start-navigation', {}, '', false, false)
  expect(f.sockets[0]!.close).not.toHaveBeenCalled()
  sender.emit('did-start-navigation', {}, '', false, true)
  expect(f.sockets[0]!.close).toHaveBeenCalledOnce()
  connect(event)
  expect(sender.listenerCount('did-start-navigation')).toBe(1)
  sender.emit('destroyed')
  expect(f.sockets[1]!.close).toHaveBeenCalledOnce()
  expect(sender.listenerCount('did-start-navigation')).toBe(0)
  manager.dispose()
})

it('rejects early, oversized and buffered input instead of silently dropping it', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event } = renderer()
  connect(event)
  f.ports[0]!.emit('message', { data: 'early' })
  expect(f.sockets[0]!.close).toHaveBeenCalledOnce()
  connect(event)
  f.sockets[1]!.readyState = 1
  f.ports[2]!.emit('message', { data: 'x'.repeat(128 * 1024 + 1) })
  expect(f.sockets[1]!.close).toHaveBeenCalledOnce()
  connect(event)
  f.sockets[2]!.readyState = 1
  f.sockets[2]!.bufferedAmount = 1024 * 1024
  f.ports[4]!.emit('message', { data: 'x' })
  expect(f.sockets[2]!.close).toHaveBeenCalledOnce()
  manager.dispose()
})

it('limits each window to 20 connections and frees a slot when a port closes', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event } = renderer()
  for (let index = 0; index < 21; index++)
    connect(event, { ...input, id: index.toString(16).padStart(36, '0') })
  expect(f.sockets).toHaveLength(20)
  expect(f.ports[40]!.postMessage).toHaveBeenCalledWith({
    type: 'error',
    message: 'Close a terminal before opening another (limit 20).',
  })
  f.ports[0]!.emit('close')
  connect(event)
  expect(f.sockets).toHaveLength(21)
  manager.dispose()
})

it('forwards connection errors and releases the port once', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event } = renderer()
  connect(event)
  const socket = f.sockets[0]!,
    port = f.ports[0]!
  socket.emit('error', new Error('failure'))
  expect(port.postMessage).toHaveBeenCalledWith({
    type: 'error',
    message: 'Terminal connection failed.',
  })
  expect(port.close).toHaveBeenCalledOnce()
  port.emit('close')
  expect(socket.close).toHaveBeenCalledOnce()
  manager.dispose()
})

it('cancels only the matching sender and authorized main frame, releasing its slot and listeners', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const first = renderer(),
    other = renderer(),
    foreign = renderer('https://other.example/')
  connect(first.event)
  connect(other.event)
  const cancel = f.handlers.get('terminal:cancel')!
  cancel({ ...first.event, senderFrame: foreign.event.senderFrame } as IpcMainEvent, {
    id: input.id,
  })
  cancel(foreign.event, { id: input.id })
  cancel(first.event, { id: 'invalid' })
  expect(f.sockets[0]!.close).not.toHaveBeenCalled()
  cancel(first.event, { id: input.id })
  expect(f.sockets[0]!.close).toHaveBeenCalledOnce()
  expect(f.ports[0]!.close).toHaveBeenCalledOnce()
  expect(first.sender.listenerCount('did-start-navigation')).toBe(0)
  expect(f.sockets[1]!.close).not.toHaveBeenCalled()
  cancel(first.event, { id: input.id })
  connect(first.event)
  expect(f.sockets).toHaveLength(3)
  manager.dispose()
  expect(f.handlers.has('terminal:cancel')).toBe(false)
})

it('rejects duplicate IDs without transferring a second port or disturbing the original', () => {
  const manager = registerTerminalPorts('/app/index.html')
  const { event, frame } = renderer()
  connect(event)
  connect(event)
  expect(f.sockets).toHaveLength(1)
  expect(frame.postMessage).toHaveBeenCalledOnce()
  expect(f.sockets[0]!.close).not.toHaveBeenCalled()
  manager.dispose()
})
