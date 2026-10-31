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
it('reconnects once when shown while suspension is still stopping', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const ticket = vi.fn<() => Promise<string>>(async () => 'ticket')
  const bridge = startMcpAppTools({
    socketUrl: (value) => `ws://lan/${value}`,
    ticket,
    call: () => {},
    cancel: () => {},
    onError: () => {},
  })
  try {
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
    bridge.setVisible(false)
    bridge.setVisible(true)
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(2))
    expect(Socket.instances[0]!.close).toHaveBeenCalledOnce()
    expect(ticket).toHaveBeenCalledTimes(2)
  } finally {
    await bridge.stop()
  }
})

it('does not create a socket when hidden during ticket acquisition', async () => {
  vi.stubGlobal('WebSocket', Socket)
  let resolveTicket: (ticket: string) => void = () => {}
  const ticket = vi.fn<() => Promise<string>>(
    () =>
      new Promise<string>((resolve) => {
        resolveTicket = resolve
      }),
  )
  const bridge = startMcpAppTools({
    socketUrl: (value) => `ws://lan/${value}`,
    ticket,
    call: () => {},
    cancel: () => {},
    onError: () => {},
  })
  try {
    await vi.waitFor(() => expect(ticket).toHaveBeenCalledOnce())
    bridge.setVisible(false)
    resolveTicket('stale')
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(0))
    bridge.setVisible(true)
    await vi.waitFor(() => expect(ticket).toHaveBeenCalledTimes(2))
    resolveTicket('fresh')
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
    expect(Socket.instances[0]!.url).toBe('ws://lan/fresh')
  } finally {
    await bridge.stop()
  }
})

it('does not restart after final stop during suspension, even if shown', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const ticket = vi.fn<() => Promise<string>>(async () => 'ticket')
  const bridge = startMcpAppTools({
    socketUrl: (value) => `ws://lan/${value}`,
    ticket,
    call: () => {},
    cancel: () => {},
    onError: () => {},
  })
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
  bridge.setVisible(false)
  const stopped = bridge.stop()
  bridge.setVisible(true)
  await stopped
  await new Promise<void>((resolve) => setTimeout(resolve, 25))
  expect(ticket).toHaveBeenCalledOnce()
  expect(Socket.instances).toHaveLength(1)
  bridge.setVisible(true)
  await Promise.resolve()
  expect(ticket).toHaveBeenCalledOnce()
})
it('suspends only after hidden pending calls finish and reconnects with tools intact', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const cancel = vi.fn<(requestId: string) => void>()
  const bridge = startMcpAppTools({
    socketUrl: (ticket) => `ws://lan/${ticket}`,
    ticket: async () => 'ticket',
    call: () => {},
    cancel,
    onError: () => {},
    visible: false,
  })
  bridge.setTools([{ name: 'selection' }])
  expect(Socket.instances).toHaveLength(0)
  bridge.setVisible(true)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
  const socket = Socket.instances[0]!
  socket.readyState = Socket.OPEN
  socket.onopen?.()
  socket.onmessage?.({
    data: JSON.stringify({ type: 'call', requestId: 'one', name: 'selection', arguments: {} }),
  })
  bridge.setVisible(false)
  expect(socket.close).not.toHaveBeenCalled()
  bridge.reply({ requestId: 'one', result: {} })
  await vi.waitFor(() => expect(socket.close).toHaveBeenCalled())
  expect(cancel).not.toHaveBeenCalled()
  bridge.setVisible(true)
  await vi.waitFor(() => expect(Socket.instances).toHaveLength(2))
  const resumed = Socket.instances[1]!
  resumed.readyState = Socket.OPEN
  resumed.onopen?.()
  expect(JSON.parse(resumed.send.mock.calls[0]![0])).toMatchObject({
    tools: [{ name: 'selection' }],
  })
  await bridge.stop()
})
it('keeps HTTP runtimes on ws, forwards only active calls and cancels them on disposal', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const call = vi.fn<(value: { requestId: string; name: string; arguments: unknown }) => void>()
  const cancel = vi.fn<(requestId: string) => void>()
  const bridge = startMcpAppTools({
    socketUrl: (ticket) => `ws://100.64.0.2:4000/ws/mcp-app?ticket=${ticket}`,
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

it('resolves its transport address after ticket acquisition selects an alternate route', async () => {
  vi.stubGlobal('WebSocket', Socket)
  let address = 'http://old-lan.local'
  const bridge = startMcpAppTools({
    socketUrl: (ticket) => `${address.replace('http:', 'ws:')}/ws/mcp-app?ticket=${ticket}`,
    ticket: async () => {
      address = 'http://vpn.local'
      return 'alternate-ticket'
    },
    call: () => {},
    cancel: () => {},
    onError: () => {},
  })
  try {
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1))
    expect(Socket.instances[0]!.url).toBe('ws://vpn.local/ws/mcp-app?ticket=alternate-ticket')
  } finally {
    await bridge.stop()
  }
})
