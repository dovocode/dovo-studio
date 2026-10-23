import { afterEach, expect, it, vi } from 'vite-plus/test'
import { on, once } from 'node:events'
import { createServer, createConnection, type Socket } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { attachDesktopUnlockSocket } from './desktop-unlock-socket.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture() {
  let native!: Socket
  let closeUnlock = () => {}
  let authorized = true
  const detached = vi.fn<() => void>()
  const tcp = createServer((socket) => {
    native = socket
  })
  tcp.listen(0, '127.0.0.1')
  await once(tcp, 'listening')
  const address = tcp.address()
  if (!address || typeof address === 'string') throw Error('TCP address unavailable')
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(wss, 'listening')
  wss.on('connection', (client) =>
    attachDesktopUnlockSocket(
      client,
      () => {
        if (!authorized) throw Error('revoked')
      },
      (close) => {
        closeUnlock = close
        return detached
      },
      () => createConnection({ host: '127.0.0.1', port: address.port }),
    ),
  )
  const wsAddress = wss.address()
  if (!wsAddress || typeof wsAddress === 'string') throw Error('WebSocket address unavailable')
  const client = new WebSocket(`ws://127.0.0.1:${wsAddress.port}`)
  cleanup.push(async () => {
    client.terminate()
    for (const socket of wss.clients) socket.terminate()
    native?.destroy()
    await Promise.all([
      new Promise<void>((resolve) => wss.close(() => resolve())),
      new Promise<void>((resolve) => tcp.close(() => resolve())),
    ])
  })
  await once(client, 'open')
  await vi.waitFor(() => expect(native).toBeDefined())
  return {
    client,
    native,
    detached,
    stop: () => closeUnlock(),
    revoke: () => {
      authorized = false
    },
  }
}

it('relays opaque binary RFB bytes in order and tears down both sides when sharing stops', async () => {
  const f = await fixture()
  const received = once(f.client, 'message')
  f.native.write('RFB 003.889\n')
  expect((await received)[0]).toEqual(Buffer.from('RFB 003.889\n'))
  const reply = once(f.native, 'data')
  f.client.send(Buffer.from('RFB 003.008\n'))
  expect((await reply)[0]).toEqual(Buffer.from('RFB 003.008\n'))
  const pixels = Buffer.alloc(2 * 1024 * 1024)
  // Distinct blocks detect reordering as well as missing or corrupted bytes.
  for (let offset = 0; offset < pixels.length; offset += 4096)
    pixels.fill((offset / 4096) % 251, offset, offset + 4096)
  const frames = on(f.client, 'message', { close: ['close'] })
  f.native.write(pixels)
  const chunks: Buffer[] = []
  let size = 0
  for await (const [data] of frames) {
    if (!Buffer.isBuffer(data)) throw Error('Expected binary RFB bytes')
    chunks.push(data)
    size += data.length
    if (size >= pixels.length) break
  }
  expect(size).toBe(pixels.length)
  // Buffer.equals avoids constructing a multi-megabyte deep assertion diff.
  expect(Buffer.concat(chunks).equals(pixels)).toBe(true)
  const closed = once(f.client, 'close')
  f.stop()
  expect((await closed)[0]).toBe(1000)
  expect(f.detached).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(f.native.destroyed).toBe(true))
})

it('revokes an idle connection without waiting for another RFB message', async () => {
  const f = await fixture()
  const closed = once(f.client, 'close')
  f.revoke()
  expect((await closed)[0]).toBe(1008)
  expect(f.detached).toHaveBeenCalledOnce()
})

it('rejects text input and closes native sockets when the viewer leaves', async () => {
  const f = await fixture()
  const closed = once(f.client, 'close')
  f.client.send('not RFB')
  expect((await closed)[0]).toBe(1008)
  expect(f.detached).toHaveBeenCalledOnce()
  const next = await fixture()
  next.client.close()
  await vi.waitFor(() => expect(next.native.destroyed).toBe(true))
  expect(next.detached).toHaveBeenCalledOnce()
})
