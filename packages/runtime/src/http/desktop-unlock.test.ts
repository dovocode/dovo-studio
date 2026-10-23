import { expect, it, vi } from 'vite-plus/test'
import process from 'node:process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { WebSocket } from 'ws'
import { startRuntime } from '../index.js'
import { RemoteDesktop, type DesktopDriver } from '../computer-use/remote-desktop.js'
import * as unlock from './support/desktop-unlock-socket.js'

it('binds one-use unlock tickets to paired humans and the active locked session over HTTP', async () => {
  const token = 'desktop-unlock-owner-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const tcp = createServer()
  const nativeSockets = new Set<import('node:net').Socket>()
  const sockets: WebSocket[] = []
  try {
    tcp.on('connection', (socket) => {
      nativeSockets.add(socket)
      socket.on('close', () => nativeSockets.delete(socket))
      socket.on('data', (data) => socket.write(data))
    })
    tcp.listen(0, '127.0.0.1')
    await once(tcp, 'listening')
    const address = tcp.address()
    if (!address || typeof address === 'string') throw Error('TCP address unavailable')
    const attach = unlock.attachDesktopUnlockSocket
    vi.spyOn(unlock, 'attachDesktopUnlockSocket').mockImplementation(
      (client, authorize, register) =>
        attach(client, authorize, register, () =>
          createConnection({ host: '127.0.0.1', port: address.port }),
        ),
    )
    const s = runtime.services
    const otherToken = 'desktop-unlock-other-at-least-32-characters'
    s.devices.add('Other computer', otherToken)
    await s.remoteDesktop.dispose()
    const driver: DesktopDriver = { call: async () => ({ content: [] }), close: async () => {} }
    s.remoteDesktop = new RemoteDesktop(
      () => true,
      () => '',
      () => {},
      () => {},
      async () => driver,
      async () => true,
    )
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const id = randomUUID()
    const post = (path: string, body: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const open = (ticket: string, agent = false) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${runtime.port}/ws/remote-desktop/unlock?ticket=${encodeURIComponent(ticket)}`,
        agent ? { headers: { 'x-dovo-agent-access': '1' } } : undefined,
      )
      sockets.push(socket)
      return socket
    }
    const ticket = async () => {
      const response = await post('/api/remote-desktop/unlock-ticket', { id })
      expect(response.status).toBe(200)
      const result: { ticket: string } = await response.json()
      return result.ticket
    }
    expect((await post('/api/remote-desktop', { action: 'start', id })).status).toBe(200)
    expect((await post('/api/remote-desktop/unlock-ticket', { id }, otherToken)).status).toBe(403)
    await expect(once(open(s.tickets.issue(token, 'runtime-sync')), 'open')).rejects.toThrow('401')
    await expect(
      once(open(s.tickets.issue(otherToken, `remote-desktop-unlock:${id}`)), 'open'),
    ).rejects.toThrow('401')
    await expect(once(open(await ticket(), true), 'open')).rejects.toThrow('401')
    const singleUse = await ticket()
    const socket = open(singleUse)
    await once(socket, 'open')
    await vi.waitFor(() => expect(nativeSockets.size).toBe(1))
    expect(s.remoteDesktop.status()).toMatchObject({
      unlocking: true,
      locked: true,
      control: false,
    })
    const reply = once(socket, 'message')
    socket.send(Buffer.from('opaque native authentication data'))
    expect((await reply)[0]).toEqual(Buffer.from('opaque native authentication data'))
    expect(JSON.stringify(s.activity.list('', '', 0))).not.toContain(
      'opaque native authentication data',
    )
    await expect(once(open(singleUse), 'open')).rejects.toThrow('401')
    const closed = once(socket, 'close')
    expect((await post('/api/remote-desktop', { action: 'stop', id }, otherToken)).status).toBe(200)
    expect((await closed)[0]).toBe(1000)
    await vi.waitFor(() => expect(nativeSockets.size).toBe(0))
  } finally {
    for (const socket of sockets) socket.terminate()
    for (const socket of nativeSockets) socket.destroy()
    await new Promise<void>((resolve) => tcp.close(() => resolve()))
    vi.restoreAllMocks()
    await runtime.close()
  }
})
