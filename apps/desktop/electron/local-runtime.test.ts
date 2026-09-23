import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fixture = vi.hoisted(() => ({ directory: '', packaged: false }))
vi.mock('electron', () => ({
  app: {
    getPath: () => fixture.directory,
    get isPackaged() {
      return fixture.packaged
    },
  },
}))
vi.mock('./background-runtime.js', () => ({
  stopBackgroundRuntimeForUpdate:
    vi.fn<typeof import('./background-runtime.js').stopBackgroundRuntimeForUpdate>(),
  ensureBackgroundRuntime:
    vi.fn<typeof import('./background-runtime.js').ensureBackgroundRuntime>(),
}))
vi.mock('node:child_process', () => ({ spawn: vi.fn<typeof import('node:child_process').spawn>() }))
afterEach(() => {
  fixture.packaged = false
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.resetModules()
  if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true })
})

it('attaches to an authenticated existing server and leaves it running when desktop closes', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-attach-'))
  const connection = {
    address: 'http://127.0.0.1:51464',
    token: 'owner-token-at-least-thirty-two-characters',
    pid: process.pid,
    bindHost: '0.0.0.0',
  }
  writeFileSync(join(fixture.directory, 'runtime-connection.json'), JSON.stringify(connection))
  const request = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ owner: true, protocolVersion: 2 })),
  )
  vi.stubGlobal('fetch', request)
  const signal = vi.spyOn(process, 'kill')
  const { spawn } = await import('node:child_process')
  const { startLocalRuntime, stopLocalRuntime } = await import('./local-runtime')
  expect(await startLocalRuntime('/unused')).toEqual({
    address: connection.address,
    token: connection.token,
  })
  await stopLocalRuntime()
  expect(spawn).not.toHaveBeenCalled()
  expect(signal).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith(
    connection.address + '/api/snapshot',
    expect.objectContaining({
      headers: { Authorization: `Bearer ${connection.token}` },
      redirect: 'error',
    }),
  )
})

it('refreshes external discovery after the background service restarts', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-reconnect-'))
  const path = join(fixture.directory, 'runtime-connection.json')
  const first = { address: 'http://127.0.0.1:51464', token: 'a'.repeat(32), pid: process.pid }
  writeFileSync(path, JSON.stringify(first))
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ owner: true, protocolVersion: 2 }))),
  )
  const { startLocalRuntime, stopLocalRuntime } = await import('./local-runtime')
  expect((await startLocalRuntime('/unused')).address).toBe(first.address)
  const next = { ...first, address: 'http://127.0.0.1:51465', token: 'b'.repeat(32) }
  writeFileSync(path, JSON.stringify(next))
  expect(await startLocalRuntime('/unused')).toEqual({ address: next.address, token: next.token })
  await stopLocalRuntime()
})

it('refuses to replace a living runtime when authentication fails', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-auth-'))
  writeFileSync(
    join(fixture.directory, 'runtime-connection.json'),
    JSON.stringify({
      address: 'http://127.0.0.1:51464',
      token: 'a'.repeat(32),
      pid: process.pid,
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 401 }))),
  )
  const { spawn } = await import('node:child_process')
  const { startLocalRuntime } = await import('./local-runtime')
  await expect(startLocalRuntime('/unused')).rejects.toThrow('already running')
  expect(spawn).not.toHaveBeenCalled()
})

async function childFixture() {
  const { ChildProcess } =
    await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const { spawn } = await import('node:child_process')
  const child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: 987654 })
  const kill = vi.spyOn(child, 'kill').mockImplementation((signal) => {
    Object.defineProperty(child, 'signalCode', {
      value: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
      configurable: true,
    })
    child.emit('exit', null, child.signalCode)
    return true
  })
  vi.mocked(spawn).mockReturnValue(child)
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-child-'))
  return { child, spawn, kill, ...(await import('./local-runtime')) }
}

it('shares concurrent startup and releases startup listeners after readiness', async () => {
  const { child, spawn, kill, startLocalRuntime, stopLocalRuntime } = await childFixture()
  const first = startLocalRuntime('/unused')
  const second = startLocalRuntime('/unused')
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  child.emit('message', { type: 'ready', port: 8787 })
  expect(await first).toEqual(await second)
  expect(spawn).toHaveBeenCalledTimes(1)
  expect(child.listenerCount('message')).toBe(0)
  await Promise.all([stopLocalRuntime(), stopLocalRuntime()])
  expect(kill).toHaveBeenCalledTimes(1)
  expect(child.listenerCount('exit')).toBe(0)
  expect(child.listenerCount('error')).toBe(0)
})

it('recognizes a signal-terminated child and allows a fresh startup', async () => {
  const { child, kill, startLocalRuntime, stopLocalRuntime } = await childFixture()
  const first = startLocalRuntime('/unused')
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  child.emit('message', { type: 'ready', port: 8787 })
  await first
  Object.defineProperty(child, 'signalCode', { value: 'SIGTERM', configurable: true })
  child.emit('exit', null, 'SIGTERM')
  await stopLocalRuntime()
  expect(kill).not.toHaveBeenCalled()
  Object.defineProperty(child, 'signalCode', { value: null, configurable: true })
  const second = startLocalRuntime('/unused')
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  child.emit('message', { type: 'ready', port: 8787 })
  await second
  await stopLocalRuntime()
  expect(kill).toHaveBeenCalledTimes(1)
})

it('cleans up a failed spawn and lets the next attempt run', async () => {
  const { child, kill, startLocalRuntime, stopLocalRuntime } = await childFixture()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const first = startLocalRuntime('/unused')
  const rejected = (async () => {
    await expect(first).rejects.toThrow('spawn failed')
  })()
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  child.emit('error', new Error('spawn failed'))
  await rejected
  expect(kill).toHaveBeenCalledTimes(1)
  expect(child.listenerCount('message')).toBe(0)
  Object.defineProperty(child, 'signalCode', { value: null, configurable: true })
  const next = startLocalRuntime('/unused')
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  child.emit('message', { type: 'ready', port: 8787 })
  await next
  await stopLocalRuntime()
})

it('kills an unresponsive startup before rejecting and permits a subsequent start', async () => {
  const { child, kill, startLocalRuntime, stopLocalRuntime } = await childFixture()
  vi.useFakeTimers()
  kill.mockImplementation((signal) => {
    if (signal === 'SIGKILL') {
      Object.defineProperty(child, 'signalCode', { value: 'SIGKILL', configurable: true })
      child.emit('exit', null, 'SIGKILL')
    }
    return true
  })
  const first = startLocalRuntime('/unused')
  const rejected = (async () => {
    await expect(first).rejects.toThrow('did not start within 30 seconds')
  })()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(kill).toHaveBeenCalledWith('SIGTERM')
  await vi.advanceTimersByTimeAsync(5_000)
  await rejected
  expect(kill).toHaveBeenCalledWith('SIGKILL')
  expect(child.listenerCount('message')).toBe(0)
  expect(child.listenerCount('exit')).toBe(0)
  Object.defineProperty(child, 'signalCode', { value: null, configurable: true })
  const next = startLocalRuntime('/unused')
  await vi.advanceTimersByTimeAsync(0)
  child.emit('message', { type: 'ready', port: 8787 })
  await next
  const stopping = stopLocalRuntime()
  await vi.advanceTimersByTimeAsync(5_000)
  await stopping
})

it('aborts a stalled health check without spawning over a living service', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-stalled-'))
  writeFileSync(
    join(fixture.directory, 'runtime-connection.json'),
    JSON.stringify({
      address: 'http://127.0.0.1:51464',
      token: 'a'.repeat(32),
      pid: process.pid,
    }),
  )
  let signal: AbortSignal | null | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_url, options) => {
      signal = options?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }),
  )
  const { spawn } = await import('node:child_process')
  const { startLocalRuntime } = await import('./local-runtime')
  vi.useFakeTimers()
  const result = (async () => {
    await expect(startLocalRuntime('/unused')).rejects.toThrow('already running')
  })()
  await vi.advanceTimersByTimeAsync(3000)
  await result
  expect(signal?.aborted).toBe(true)
  expect(spawn).not.toHaveBeenCalled()
})

it('rejects an early child exit without waiting for the startup deadline', async () => {
  const { child, kill, startLocalRuntime } = await childFixture()
  const rejected = (async () => {
    await expect(startLocalRuntime('/unused')).rejects.toThrow('SIGTERM')
  })()
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  Object.defineProperty(child, 'signalCode', { value: 'SIGTERM', configurable: true })
  child.emit('exit', null, 'SIGTERM')
  await rejected
  expect(kill).not.toHaveBeenCalled()
  expect(child.listenerCount('message')).toBe(0)
})

it('serializes shutdown with an in-flight startup so the child is not orphaned', async () => {
  const { child, kill, startLocalRuntime, stopLocalRuntime } = await childFixture()
  const starting = startLocalRuntime('/unused')
  const stopping = stopLocalRuntime()
  await vi.waitFor(() => expect(child.listenerCount('message')).toBe(1))
  expect(kill).not.toHaveBeenCalled()
  child.emit('message', { type: 'ready', port: 8787 })
  await Promise.all([starting, stopping])
  expect(kill).toHaveBeenCalledTimes(1)
  expect(child.listenerCount('message')).toBe(0)
  expect(child.listenerCount('exit')).toBe(0)
})

it('provisions a supervised runtime for packaged Mac installs and leaves it running on quit', async () => {
  const { Effect } = await import('effect')
  const { ensureBackgroundRuntime } = await import('./background-runtime.js')
  const { spawn } = await import('node:child_process')
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-service-'))
  fixture.packaged = true
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    resourcesPath: '/fixture/resources',
    getuid: () => 501,
  })
  const connection = { address: 'http://127.0.0.1:51464', token: 'a'.repeat(32), pid: process.pid }
  vi.mocked(ensureBackgroundRuntime).mockReturnValue(
    Effect.sync(() => {
      writeFileSync(join(fixture.directory, 'runtime-connection.json'), JSON.stringify(connection))
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ owner: true, protocolVersion: 2 }))),
  )
  const { startLocalRuntime, stopLocalRuntime } = await import('./local-runtime')
  expect(await startLocalRuntime('/unused')).toEqual({
    address: connection.address,
    token: connection.token,
  })
  await stopLocalRuntime()
  expect(spawn).not.toHaveBeenCalled()
  expect(ensureBackgroundRuntime).toHaveBeenCalledOnce()
  expect(ensureBackgroundRuntime).toHaveBeenCalledWith(
    expect.objectContaining({
      directory: fixture.directory,
      node: '/fixture/resources/runtime/bin/node',
    }),
  )
})

it('rejects incompatible runtimes for normal use but allows the update workflow to inspect them', async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-version-'))
  const connection = { address: 'http://127.0.0.1:51464', token: 'a'.repeat(32), pid: process.pid }
  writeFileSync(join(fixture.directory, 'runtime-connection.json'), JSON.stringify(connection))
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ owner: true }))),
  )
  const { startLocalRuntime } = await import('./local-runtime')
  await expect(startLocalRuntime('/unused')).rejects.toThrow('incompatible')
  expect(await startLocalRuntime('/unused', { allowIncompatible: true })).toEqual({
    address: connection.address,
    token: connection.token,
  })
})

it('stops its supervised runtime for an update and can restore it after installation fails', async () => {
  const { Effect } = await import('effect')
  const { stopBackgroundRuntimeForUpdate } = await import('./background-runtime.js')
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-update-'))
  fixture.packaged = true
  vi.stubGlobal('process', { ...process, platform: 'darwin', getuid: () => 501 })
  const connection = { address: 'http://127.0.0.1:51464', token: 'a'.repeat(32), pid: process.pid }
  writeFileSync(join(fixture.directory, 'runtime-connection.json'), JSON.stringify(connection))
  vi.mocked(stopBackgroundRuntimeForUpdate).mockReturnValue(Effect.void)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ owner: true, protocolVersion: 2 }))),
  )
  const { prepareLocalRuntimeUpdate, startLocalRuntime } = await import('./local-runtime')
  const recover = await prepareLocalRuntimeUpdate('/unused')
  expect(stopBackgroundRuntimeForUpdate).toHaveBeenCalledWith(fixture.directory, 501, process.pid)
  await expect(startLocalRuntime('/unused')).rejects.toThrow('update is in progress')
  await expect(prepareLocalRuntimeUpdate('/unused')).rejects.toThrow('already in progress')
  await expect(startLocalRuntime('/unused')).rejects.toThrow('update is in progress')
  await Promise.all([recover(), recover()])
  await expect(startLocalRuntime('/unused')).resolves.toMatchObject({ address: connection.address })
})

const requestAddress = (url: string | URL | Request) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url

async function networkFixture() {
  const { Effect } = await import('effect')
  const { ensureBackgroundRuntime, stopBackgroundRuntimeForUpdate } =
    await import('./background-runtime.js')
  fixture.directory = mkdtempSync(join(tmpdir(), 'dovo-network-settings-'))
  fixture.packaged = true
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    resourcesPath: '/fixture/resources',
    getuid: () => 501,
    env: { ...process.env, DOVO_HOST: undefined, DOVO_PORT: '0' },
  })
  const path = join(fixture.directory, 'runtime-connection.json')
  const connection = {
    address: 'http://127.0.0.1:51464',
    token: 'a'.repeat(32),
    pid: process.pid,
    bindHost: '127.0.0.1',
  }
  writeFileSync(path, JSON.stringify(connection))
  const request = vi.fn<typeof fetch>(async (url) => {
    if (requestAddress(url).endsWith('/api/runtime/prepare-restart'))
      return Response.json({ id: 'c7c17c4d-813a-46c8-8b84-fd589bdf47fe' })
    if (requestAddress(url).endsWith('/api/runtime/cancel-restart'))
      return Response.json({ ok: true })
    return Response.json({ owner: true, protocolVersion: 2 })
  })
  vi.stubGlobal('fetch', request)
  vi.mocked(stopBackgroundRuntimeForUpdate).mockReturnValue(Effect.sync(() => rmSync(path)))
  vi.mocked(ensureBackgroundRuntime).mockImplementation((options) =>
    Effect.sync(() => {
      writeFileSync(
        path,
        JSON.stringify({
          ...connection,
          bindHost: options.host,
          address: `http://127.0.0.1:${options.port}`,
        }),
      )
    }),
  )
  const runtime = await import('./local-runtime')
  return {
    ...runtime,
    connection,
    request,
    ensureBackgroundRuntime,
    stopBackgroundRuntimeForUpdate,
  }
}

it('applies and reverses network access through the packaged supervisor without changing the port', async () => {
  const f = await networkFixture()
  expect(await f.setLocalRuntimeNetwork('/unused', f.connection.address, true)).toMatchObject({
    local: true,
    host: '0.0.0.0',
  })
  expect(f.ensureBackgroundRuntime).toHaveBeenLastCalledWith(
    expect.objectContaining({ host: '0.0.0.0', port: '51464' }),
  )
  expect(await f.setLocalRuntimeNetwork('/unused', f.connection.address, false)).toMatchObject({
    host: '127.0.0.1',
  })
  expect(f.stopBackgroundRuntimeForUpdate).toHaveBeenCalledTimes(2)
})

it('restores the prior listener after a failed network restart', async () => {
  const f = await networkFixture()
  const { Effect } = await import('effect')
  vi.mocked(f.ensureBackgroundRuntime).mockReturnValueOnce(
    Effect.fail(new Error('Port unavailable')),
  )
  await expect(f.setLocalRuntimeNetwork('/unused', f.connection.address, true)).rejects.toThrow(
    'Port unavailable',
  )
  expect(await f.localRuntimeNetwork('/unused', f.connection.address)).toMatchObject({
    host: '127.0.0.1',
  })
  expect(f.ensureBackgroundRuntime).toHaveBeenLastCalledWith(
    expect.objectContaining({ host: '127.0.0.1', port: '51464' }),
  )
})

it('does not stop the service when restart admission is denied', async () => {
  const f = await networkFixture()
  f.request.mockImplementation(async (url) =>
    requestAddress(url).endsWith('/api/runtime/prepare-restart')
      ? Response.json({ error: 'Finish or stop running tasks' }, { status: 409 })
      : Response.json({ owner: true, protocolVersion: 2 }),
  )
  await expect(f.setLocalRuntimeNetwork('/unused', f.connection.address, true)).rejects.toThrow(
    'Finish or stop',
  )
  expect(f.stopBackgroundRuntimeForUpdate).not.toHaveBeenCalled()
})
