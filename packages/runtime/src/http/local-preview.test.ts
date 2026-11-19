import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { STUDIO_BROWSER_SCOPE } from '@dovo/protocol'
import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'

it('relays only the active localhost origin and consumes each device ticket once', async () => {
  const content = 'local preview '.repeat(20_000)
  const dev = createServer((request, response) => {
    expect(request.url).toBe('/page?mobile=1')
    response.end(content)
  })
  const listening = once(dev, 'listening')
  dev.listen(0, '127.0.0.1')
  await listening
  const address = dev.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  const origin = `http://localhost:${address.port}`
  const token = 'local-preview-test-device-with-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: `${token}-owner`,
    port: 0,
  })
  try {
    runtime.services.devices.add('Test phone', token)
    const current = vi
      .spyOn(runtime.services.browsers, 'localPreviewOrigin')
      .mockResolvedValue(origin)
    const ticket = (requested: string, authorization = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/previews/browser/local-preview/ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: STUDIO_BROWSER_SCOPE, tabId: 'preview', origin: requested }),
      })
    expect((await ticket(origin, 'unknown')).status).toBe(401)
    expect((await ticket('http://127.0.0.1:12345')).status).toBe(409)
    const grant = await ticket(origin)
    expect(grant.status).toBe(200)
    const { ticket: value } = await grant.json()
    const address = `ws://127.0.0.1:${runtime.port}/ws/local-preview?ticket=${value}`
    const socket = new WebSocket(address)
    try {
      const chunks: Buffer[] = []
      const body = new Promise<string>((resolve, reject) => {
        socket.on('message', (data, binary) => {
          const bytes = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.from(data)
          if (binary) {
            chunks.push(bytes)
            socket.send('ack')
          } else if (bytes.toString() === 'end') resolve(Buffer.concat(chunks).toString())
        })
        socket.once('error', reject)
        socket.once('close', () =>
          reject(new Error('Preview ended before the HTTP response finished')),
        )
      })
      await once(socket, 'open')
      socket.send(Buffer.from('GET /page?mobile=1 HTTP/1.0\r\nHost: localhost\r\n\r\n'))
      socket.send('end')
      const response = await body
      expect(response.slice(response.indexOf('\r\n\r\n') + 4)).toBe(content)
      expect(current).toHaveBeenCalledWith(JSON.stringify([STUDIO_BROWSER_SCOPE, 'preview']))
      await expect(once(new WebSocket(address), 'open')).rejects.toThrow('401')
    } finally {
      socket.terminate()
    }
  } finally {
    await runtime.close()
    dev.closeAllConnections()
    await new Promise<void>((resolve) => dev.close(() => resolve()))
  }
})
