import { afterEach, expect, it } from 'vite-plus/test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { peerCapability, peerRoom } from '@dovo/protocol'
import { AccountStore } from './store.js'
import { createConnectServer } from './server.js'

const dispose: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close()
})

it('closes promptly while a healthy signaling host stays connected', async () => {
  const store = new AccountStore(':memory:')
  dispose.push(() => store.db.close())
  const server = createConnectServer({
    store,
    origin: 'http://connect.test',
    authorizationOrigin: 'https://auth.test',
    authorize: async () => '',
    exchange: async () => ({ id: '', name: '' }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const origin = `http://127.0.0.1:${address.port}`
  const config = { origin, secret: 'a'.repeat(64) }
  const host = new WebSocket(`ws://127.0.0.1:${address.port}/v1/peer`)
  // Registered after the store, so cleanup ends the host before it closes the store.
  dispose.push(() => host.terminate())
  await once(host, 'open')
  const ready = once(host, 'message')
  host.send(
    JSON.stringify({
      type: 'host',
      room: peerRoom(config),
      key: peerCapability(config, 'host'),
      clientKey: peerCapability(config, 'client'),
    }),
  )
  expect(JSON.parse(String((await ready)[0]))).toMatchObject({ type: 'ready' })

  const hostClosed = once(host, 'close')
  const serverClosed = new Promise<Error | undefined>((resolve) => server.close(resolve))
  const result = await Promise.race([
    serverClosed.then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('still open'), 2000)),
  ])
  expect(result).toBe('closed')
  await hostClosed
  expect(server.listening).toBe(false)
})
