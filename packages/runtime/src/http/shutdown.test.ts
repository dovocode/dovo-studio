import { afterEach, expect, it, vi } from 'vite-plus/test'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { createServer } from 'node:http'
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

it('releases remaining resources and SQLite when one service cleanup fails', async () => {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const released = vi.spyOn(runtime.services.agents, 'dispose')
  vi.spyOn(runtime.services.browsers, 'dispose').mockRejectedValueOnce(
    new Error('browser cleanup failed'),
  )
  await expect(runtime.close()).rejects.toThrow('browser cleanup failed')
  expect(released).toHaveBeenCalledOnce()
  expect(runtime.services.db.open).toBe(false)
})

it('stops admission while watchers drain before disposing task services', async () => {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  let enter = () => {}
  let release = () => {}
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const dispose = runtime.services.pullRequestWatch.dispose.bind(runtime.services.pullRequestWatch)
  vi.spyOn(runtime.services.pullRequestWatch, 'dispose').mockImplementationOnce(async () => {
    enter()
    await released
    await dispose()
  })
  const closing = runtime.close()
  try {
    await entered
    await expect(fetch(`http://127.0.0.1:${runtime.port}/health`)).rejects.toThrow('fetch failed')
    expect(runtime.services.db.open).toBe(true)
  } finally {
    release()
    await closing
  }
  expect(runtime.services.db.open).toBe(false)
})

it('stops watchers before task services and flushes notifications before disposing them', async () => {
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const order: string[] = []
  const services = runtime.services
  const watch = services.pullRequestWatch.dispose.bind(services.pullRequestWatch)
  const pipelines = services.pipelineWatch.dispose.bind(services.pipelineWatch)
  const tasks = services.tasks.dispose.bind(services.tasks)
  const flush = services.liveActivities.flush.bind(services.liveActivities)
  const dispose = services.liveActivities.dispose.bind(services.liveActivities)
  vi.spyOn(services.pullRequestWatch, 'dispose').mockImplementation(async () => {
    await watch()
    order.push('watch')
  })
  vi.spyOn(services.pipelineWatch, 'dispose').mockImplementation(async () => {
    await pipelines()
    order.push('pipelines')
  })
  vi.spyOn(services.tasks, 'dispose').mockImplementation(async () => {
    order.push('tasks')
    await tasks()
  })
  vi.spyOn(services.liveActivities, 'flush').mockImplementation(async () => {
    order.push('flush')
    await flush()
  })
  vi.spyOn(services.liveActivities, 'dispose').mockImplementation(async () => {
    order.push('dispose')
    await dispose()
  })
  try {
    await runtime.close()
    expect(order.indexOf('watch')).toBeLessThan(order.indexOf('tasks'))
    expect(order.indexOf('pipelines')).toBeLessThan(order.indexOf('tasks'))
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('dispose'))
    expect(services.db.open).toBe(false)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
  }
})

it.each([false, true])(
  'aborts a title worker while its accepted HTTP request drains (external=%s)',
  async (external) => {
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Missing reserved port')
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    )
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: token,
      port: 0,
      ...(external ? { external: { enabled: true, host: '0.0.0.0', port: address.port } } : {}),
    })
    cleanups.push(() => runtime.close())
    let entered = () => {}
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let aborted = false
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: async () => ({ provider: 'codex', available: true, detail: 'Fixture' }),
      run: async ({ signal }) => {
        entered()
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
    })
    const response = fetch(
      `http://127.0.0.1:${external ? address.port : runtime.port}/api/tasks/title`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'A title request held until shutdown' }),
      },
    )
    await started
    await runtime.close()
    expect(aborted).toBe(true)
    expect((await response).ok).toBe(false)
    expect(runtime.services.db.open).toBe(false)
  },
)

it('keeps serving after a listener error once startup has completed', async () => {
  const db = openDatabase(':memory:')
  cleanups.push(() => {
    db.close()
  })
  const http = createRuntimeServer(createServices(db, token))
  cleanups.push(() => http.close())
  http.server.listen(0, '127.0.0.1')
  await once(http.server, 'listening')
  const address = http.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    http.server.emit('error', Object.assign(new Error('Too many open files'), { code: 'EMFILE' }))
    const response = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.ok).toBe(true)
    expect(logged).toHaveBeenCalledWith(
      'Runtime listener error',
      expect.objectContaining({ code: 'EMFILE' }),
    )
  } finally {
    logged.mockRestore()
  }
})
