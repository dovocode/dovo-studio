import { afterEach, expect, it, vi } from 'vitest'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { createRuntimeServer } from './server'
import { startRuntime } from '../index'
import { createServices } from '../services'
import { openDatabase } from '../storage/database'

const token = 'shutdown-test-owner-token-at-least-32-characters'
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it.each(['preconnected', 'partial headers', 'partial body'])(
  'closes a %s client without waiting for it to disconnect',
  async (kind) => {
    const db = openDatabase(':memory:')
    cleanups.push(() => {
      db.close()
    })
    const http = createRuntimeServer(createServices(db, token))
    const closed = () => http.close()
    cleanups.push(closed)
    http.server.listen(0, '127.0.0.1')
    await once(http.server, 'listening')
    const address = http.server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')
    const accepted = new Promise<Socket>((resolve) => http.server.once('connection', resolve))
    const client = connect(address.port, '127.0.0.1')
    const connected = once(client, 'connect')
    client.resume()
    cleanups.push(() => {
      client.destroy()
    })
    const serverSocket = await accepted
    await connected
    if (kind !== 'preconnected') {
      const received = once(serverSocket, 'data')
      client.write(
        kind === 'partial headers'
          ? 'GET /api/snapshot HTTP/1.1\r\nHost: localhost\r\n'
          : `POST /api/shortcuts/received HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Length: 100\r\n\r\n{`,
      )
      await received
    }
    const disconnected = once(client, 'close')
    await http.close()
    await disconnected
    expect(client.destroyed).toBe(true)
    expect(db.open).toBe(true)
  },
)

it.each(['connected', 'disconnected'])(
  'finishes a %s client’s accepted request and database writes before closing the runtime',
  async (connection) => {
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let closing: Promise<void> | undefined
    cleanups.push(() => (closing ??= runtime.close()))
    const services = runtime.services
    services.store.update((workspace) => ({
      ...workspace,
      repositories: [{ id: 'repo', name: 'Before', path: '/fixture', branch: 'main' }],
    }))
    let enter = () => {}
    let release = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    cleanups.push(release)
    vi.spyOn(services.git, 'inspect').mockImplementation(async () => {
      enter()
      await released
      expect(services.db.open).toBe(true)
      return { name: 'After', path: '/fixture', branch: 'updated' }
    })
    const controller = new AbortController()
    const response = fetch(`http://127.0.0.1:${runtime.port}/api/scm/inspect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repositoryId: 'repo' }),
      signal: controller.signal,
    }).then(
      async (result) => ({ status: result.status, body: await result.json() }),
      (error: unknown) => ({ error: error instanceof Error ? error.name : String(error) }),
    )
    await entered
    if (connection === 'disconnected') {
      controller.abort()
      await response
    }
    let stopped = false
    closing = runtime.close()
    void closing.then(() => {
      stopped = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(stopped).toBe(false)
    expect(services.db.open).toBe(true)
    release()
    expect(await response).toEqual(
      connection === 'connected'
        ? { status: 200, body: { name: 'After', path: '/fixture', branch: 'updated' } }
        : { error: 'AbortError' },
    )
    await closing
    expect(services.store.get().repositories[0].branch).toBe('updated')
    expect(services.db.open).toBe(false)
  },
)
