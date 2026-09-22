import { expect, it } from 'vitest'
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
