import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startMcpAppTools } from './mcp-app-tools'
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn<(message: string) => void>()
  close = vi.fn<() => void>()
  constructor(readonly url: string) {
    Socket.instances.push(this)
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  Socket.instances = []
})
it('keeps HTTP runtimes on ws, forwards only active calls and cancels them on disposal', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const call = vi.fn<(value: { requestId: string; name: string; arguments: unknown }) => void>()
  const cancel = vi.fn<(requestId: string) => void>()
  const bridge = startMcpAppTools({
    address: 'http://100.64.0.2:4000',
    ticket: async () => 'single-use',
    call,
    cancel,
    onError: () => {},
  })
  bridge.setTools([{ name: 'selection' }])
  try {
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
    const socket = Socket.instances[0]!
    expect(socket.url).toBe('ws://100.64.0.2:4000/ws/mcp-app?ticket=single-use')
    socket.readyState = Socket.OPEN
    socket.onopen?.()
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      type: 'tools',
      tools: [{ name: 'selection' }],
    })
    socket.onmessage?.({
      data: JSON.stringify({ type: 'call', requestId: 'one', name: 'selection', arguments: {} }),
    })
    expect(call).toHaveBeenCalledWith({ requestId: 'one', name: 'selection', arguments: {} })
    bridge.reply({ requestId: 'unowned', result: {} })
    expect(socket.send).toHaveBeenCalledTimes(1)
    bridge.reply({ requestId: 'one', result: { content: [] } })
    expect(socket.send).toHaveBeenCalledTimes(2)
    socket.onmessage?.({
      data: JSON.stringify({ type: 'call', requestId: 'two', name: 'selection', arguments: {} }),
    })
    await bridge.stop()
    expect(cancel).toHaveBeenCalledWith('two')
    expect(socket.close).toHaveBeenCalled()
  } finally {
    await bridge.stop()
  }
})
