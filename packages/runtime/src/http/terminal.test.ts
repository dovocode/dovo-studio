import { expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
it('uses one-time socket tickets and disconnects revoked devices', async () => {
  const f = await fixture(),
    runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    })
  let socket: WebSocket | undefined
  try {
    const s = runtime.services,
      token = 'test-device-token-with-at-least-32-characters'
    const device = s.devices.add('Phone', token)
    const terminal = s.terminals.create('task', f.directory)
    const ticket = s.tickets.issue(token, terminal.id)
    const url = `ws://127.0.0.1:${runtime.port}/ws/terminal?ticket=${ticket}`
    socket = new WebSocket(url)
    await once(socket, 'open')
    const pong = new Promise<string>((resolve) =>
      socket?.on('message', (data, binary) => {
        if (binary && Buffer.isBuffer(data)) resolve(data.toString())
      }),
    )
    socket.send(JSON.stringify({ type: 'ping', nonce: 'idle-check' }))
    expect(JSON.parse(await pong)).toEqual({ type: 'pong', nonce: 'idle-check' })
    const output = new Promise<void>((resolve) =>
      socket?.on('message', (data) => {
        if (Buffer.isBuffer(data) && data.toString().includes('DOVO_SOCKET_OK')) resolve()
      }),
    )
    socket.send(JSON.stringify({ type: 'input', data: "printf 'DOVO_SOCKET_OK\\n'\r" }))
    await output
    const replay = new WebSocket(url)
    await expect(once(replay, 'open')).rejects.toThrow('401')
    const closed = once(socket, 'close')
    s.devices.revoke(device)
    const [code] = await closed
    expect(code).toBe(1008)
  } finally {
    socket?.terminate()
    await runtime.close()
    await f.cleanup()
  }
})

it('reaps half-open sockets that stop answering pings but keeps live ones', async () => {
  vi.useFakeTimers({ toFake: ['setInterval'] })
  const f = await fixture(),
    runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    })
  const sockets: WebSocket[] = []
  try {
    const s = runtime.services,
      token = 'test-device-token-with-at-least-32-characters'
    s.devices.add('Phone', token)
    const terminal = s.terminals.create('task', f.directory)
    const open = async (options?: { autoPong: boolean }) => {
      const url = `ws://127.0.0.1:${runtime.port}/ws/terminal?ticket=${s.tickets.issue(token, terminal.id)}`
      const socket = new WebSocket(url, options)
      sockets.push(socket)
      await once(socket, 'open')
      return socket
    }
    const live = await open()
    const silent = await open({ autoPong: false })
    const pinged = Promise.all([once(live, 'ping'), once(silent, 'ping')])
    vi.advanceTimersByTime(30_000)
    await pinged
    await vi.waitFor(() => new Promise((resolve) => setTimeout(resolve, 20)))
    const closed = once(silent, 'close')
    vi.advanceTimersByTime(30_000)
    await closed
    expect(live.readyState).toBe(WebSocket.OPEN)
  } finally {
    vi.useRealTimers()
    for (const socket of sockets) socket.terminate()
    await runtime.close()
    await f.cleanup()
  }
})
