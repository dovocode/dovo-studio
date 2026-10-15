import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ChildProcess } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:http'
import type { DeviceHost } from '@dovo/protocol'
const ssh = vi.hoisted(() => ({
  open: vi.fn<typeof import('./device-host-ssh').openTunnel>(),
  stop: vi.fn<typeof import('./device-host-ssh').stopSsh>(),
}))
vi.mock('./device-host-ssh.js', () => ({ openTunnel: ssh.open, stopSsh: ssh.stop }))
const sockets = vi.hoisted(() => [] as Array<EventEmitter & { url: URL; close(): void }>)
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    WebSocket: class extends EventEmitter {
      constructor(readonly url: URL) {
        super()
        sockets.push(this)
      }
      close() {
        this.emit('close')
      }
    },
  }
})
type HttpFixture = {
  requests: RequestOptions[]
  timeouts: number[]
  status: number
  body?: Buffer
  delay?: number
}
const http = vi.hoisted((): HttpFixture => ({ requests: [], timeouts: [], status: 200 }))
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    request: (
      options: RequestOptions,
      respond: (response: EventEmitter & { statusCode: number }) => void,
    ) => {
      http.requests.push(options)
      return new (class extends EventEmitter {
        deadline?: ReturnType<typeof setTimeout>
        responseTimer?: ReturnType<typeof setTimeout>
        setTimeout(timeout: number, callback: () => void) {
          http.timeouts.push(timeout)
          if (http.delay !== undefined) this.deadline = setTimeout(callback, timeout)
        }
        destroy(error: Error) {
          clearTimeout(this.deadline)
          clearTimeout(this.responseTimer)
          this.emit('error', error)
        }
        respond() {
          clearTimeout(this.deadline)
          const response = Object.assign(new EventEmitter(), {
            statusCode: http.status,
            destroy: (error: Error) => {
              response.emit('error', error)
            },
          })
          respond(response)
          response.emit(
            'data',
            http.body ?? Buffer.from(JSON.stringify({ id: 'session', ticket: 'single-use' })),
          )
          response.emit('end')
        }
        end() {
          if (http.delay !== undefined)
            this.responseTimer = setTimeout(() => this.respond(), http.delay)
          else this.respond()
        }
      })()
    },
  }
})
import { DeviceHostClient } from './device-host-client'
const host: DeviceHost = {
  id: 'host',
  name: 'Host',
  agentAccess: false,
  sshHost: 'builder',
  sshPort: 22,
  sshUser: 'user',
  runtimeAddress: 'http://localhost:4545',
  token: 'secret',
}
afterEach(() => {
  vi.restoreAllMocks()
  ssh.open.mockReset()
  ssh.stop.mockReset()
  sockets.length = 0
  http.requests.length = 0
  http.timeouts.length = 0
  http.status = 200
  http.body = undefined
  http.delay = undefined
  vi.useRealTimers()
})
it('replaces mismatched unused tunnels but rejects changes while a lease is active', async () => {
  ssh.open.mockImplementation(async () => ({
    child: new ChildProcess(),
    port: 1234,
    address: 'http://127.0.0.1:1234',
  }))
  const client = new DeviceHostClient()
  try {
    const first = await client.acquire(host)
    for (const changed of [
      { ...host, token: 'new-token' },
      { ...host, identityFile: '/other/key' },
      { ...host, sshHost: 'other-host' },
    ])
      await expect(client.acquire(changed)).rejects.toThrow('connection changed')
    first.release()
    const second = await client.acquire({ ...host, token: 'new-token' })
    expect(ssh.open).toHaveBeenCalledTimes(2)
    expect(ssh.stop).toHaveBeenCalledTimes(1)
    second.release()
  } finally {
    await client.dispose()
  }
})
it('reattaches using a fresh tunnel after SSH exits and holds its lease until the socket closes', async () => {
  const children: ChildProcess[] = []
  ssh.open.mockImplementation(async () => {
    const child = new ChildProcess()
    children.push(child)
    const port = 12000 + children.length
    return { child, port, address: `http://127.0.0.1:${port}` }
  })
  const client = new DeviceHostClient()
  try {
    const driver = await client.driver(host, 'task', {
      id: 'ios:device',
      name: 'iPhone',
      platform: 'ios',
      runtime: 'iOS',
      state: 'booted',
    })
    driver.start(vi.fn(), vi.fn())
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    children[0]!.emit('exit', 1)
    sockets[0]!.close()
    driver.start(vi.fn(), vi.fn())
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    expect(ssh.open).toHaveBeenCalledTimes(2)
    expect(sockets[1]!.url.protocol).toBe('ws:')
    expect(sockets[1]!.url.port).toBe('12002')
    expect(http.requests.map((request) => request.port)).toEqual([12001, 12001, 12002])
    expect(
      http.requests.every(
        (request) =>
          request.headers &&
          'Authorization' in request.headers &&
          request.headers.Authorization === 'Bearer secret',
      ),
    ).toBe(true)
    await expect(client.acquire({ ...host, token: 'replacement' })).rejects.toThrow(
      'connection changed',
    )
    vi.spyOn(sockets[1]!, 'close').mockImplementation(() => {})
    await driver.close()
    await expect(client.acquire({ ...host, token: 'replacement' })).rejects.toThrow(
      'connection changed',
    )
    sockets[1]!.emit('close')
    const replacement = await client.acquire({ ...host, token: 'replacement' })
    replacement.release()
  } finally {
    await client.dispose()
  }
})

it('keeps pairing required and allows enough time for native discovery, codesign and install', async () => {
  ssh.open.mockResolvedValue({
    child: new ChildProcess(),
    port: 1234,
    address: 'http://127.0.0.1:1234',
  })
  const client = new DeviceHostClient()
  try {
    await expect(
      client.request({ ...host, token: undefined }, '/api/device-host/install'),
    ).rejects.toThrow('Pair this device host')
    expect(ssh.open).not.toHaveBeenCalled()
    await client.request(host, '/api/device-host/install')
    expect(http.timeouts).toEqual([300000])
  } finally {
    await client.dispose()
  }
})

it('redacts pairing credentials before truncating errors and preserves an actionable 401', async () => {
  ssh.open.mockResolvedValue({
    child: new ChildProcess(),
    port: 1234,
    address: 'http://127.0.0.1:1234',
  })
  const client = new DeviceHostClient()
  const token = 'SENSITIVE-CREDENTIAL'
  try {
    http.status = 500
    http.body = Buffer.from(JSON.stringify({ error: 'x'.repeat(1995) + token }))
    const failure = await client
      .request({ ...host, token }, '/api/device-host/ready')
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ status: 500, message: 'x'.repeat(1995) + '[reda' })
    http.status = 401
    http.body = Buffer.from(JSON.stringify({ error: `Rejected ${token}` }))
    await expect(
      client.request({ ...host, token }, '/api/device-host/ready'),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Device host pairing token was rejected. Pair again or update its token.',
    })
  } finally {
    await client.dispose()
  }
})

it('rejects oversized device-host responses and uses bounded per-operation deadlines', async () => {
  ssh.open.mockResolvedValue({
    child: new ChildProcess(),
    port: 1234,
    address: 'http://127.0.0.1:1234',
  })
  const client = new DeviceHostClient()
  try {
    http.body = Buffer.alloc(16 * 1024 * 1024 + 1)
    await expect(client.request(host, '/api/device-host/devices')).rejects.toMatchObject({
      status: 502,
      message: 'Device host response exceeds limit',
    })
    http.body = undefined
    await client.request(host, '/api/device-host/open')
    await client.request(host, '/api/device-host/install')
    await client.request(host, '/api/device-host/ready')
    expect(http.timeouts).toEqual([120000, 300000, 300000, 60000])
  } finally {
    await client.dispose()
  }
})

it.each([
  { delay: 240000, expected: { id: 'session', ticket: 'single-use' }, elapsed: 240000 },
  {
    delay: 360000,
    expected: { status: 504, message: 'Device host request timed out' },
    elapsed: 300001,
  },
])(
  'waits for slow opening but bounds a stalled device host ($delay ms)',
  async ({ delay, expected, elapsed }) => {
    vi.useFakeTimers()
    http.delay = delay
    ssh.open.mockResolvedValue({
      child: new ChildProcess(),
      port: 1234,
      address: 'http://127.0.0.1:1234',
    })
    const client = new DeviceHostClient()
    try {
      const pending = client.request(host, '/api/device-host/open').catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(elapsed)
      expect(await pending).toMatchObject(expected)
      expect(http.requests).toHaveLength(1)
    } finally {
      await client.dispose()
    }
  },
)

it.each(['abort', 'revoke'] as const)(
  'does not dispatch HTTP after %s during tunnel acquisition and releases the lease',
  async (mode) => {
    let resolveTunnel!: (value: Awaited<ReturnType<typeof ssh.open>>) => void
    const tunnel = new Promise<Awaited<ReturnType<typeof ssh.open>>>((resolve) => {
      resolveTunnel = resolve
    })
    ssh.open.mockReturnValue(tunnel)
    const client = new DeviceHostClient()
    const controller = new AbortController()
    let revoked = false
    const authorize = () => {
      if (revoked) throw new Error('Credential revoked')
    }
    const pending = client.request(
      host,
      '/api/device-host/install',
      {},
      controller.signal,
      authorize,
    )
    const failure = pending.catch((error: unknown) => error)
    try {
      expect(ssh.open).toHaveBeenCalledOnce()
      if (mode === 'abort') controller.abort()
      else revoked = true
      resolveTunnel({ child: new ChildProcess(), port: 1234, address: 'http://127.0.0.1:1234' })
      expect(await failure).toMatchObject({
        message: expect.stringContaining(mode === 'abort' ? 'aborted' : 'revoked'),
      })
      expect(http.requests).toHaveLength(0)
      ssh.open.mockResolvedValue({
        child: new ChildProcess(),
        port: 1235,
        address: 'http://127.0.0.1:1235',
      })
      const lease = await client.acquire({ ...host, token: 'replacement' })
      lease.release()
    } finally {
      await client.dispose()
    }
  },
)

it.each(['abort', 'revoke'] as const)(
  'does not send simulator input after %s during SSH reconnection',
  async (mode) => {
    const child = new ChildProcess()
    ssh.open.mockResolvedValue({ child, port: 1234, address: 'http://127.0.0.1:1234' })
    const client = new DeviceHostClient()
    let resolveTunnel!: (value: Awaited<ReturnType<typeof ssh.open>>) => void
    try {
      const driver = await client.driver(host, 'task', {
        id: 'ios:device',
        name: 'iPhone',
        platform: 'ios',
        runtime: 'iOS',
        state: 'booted',
      })
      child.emit('exit', 1)
      ssh.open.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTunnel = resolve
          }),
      )
      const controller = new AbortController()
      let revoked = false
      const pending = driver
        .input(
          { type: 'text', text: 'forbidden' },
          () => {
            if (revoked) throw new Error('Credential revoked')
          },
          controller.signal,
        )
        .catch((error: unknown) => error)
      expect(ssh.open).toHaveBeenCalledTimes(2)
      if (mode === 'abort') controller.abort()
      else revoked = true
      resolveTunnel({ child: new ChildProcess(), port: 1235, address: 'http://127.0.0.1:1235' })
      expect(await pending).toMatchObject({ message: expect.stringMatching(/aborted|revoked/) })
      expect(http.requests.map((request) => request.path)).toEqual(['/api/device-host/open'])
      await driver.close()
    } finally {
      await client.dispose()
    }
  },
)

it.each(['abort', 'revoke'] as const)(
  'does not open a remote simulator after %s during SSH acquisition',
  async (mode) => {
    let resolveTunnel!: (value: Awaited<ReturnType<typeof ssh.open>>) => void
    ssh.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTunnel = resolve
        }),
    )
    const client = new DeviceHostClient()
    const controller = new AbortController()
    let revoked = false
    const pending = client
      .driver(
        host,
        'task',
        {
          id: 'ios:device',
          name: 'iPhone',
          platform: 'ios',
          runtime: 'iOS',
          state: 'booted',
        },
        () => {
          if (revoked) throw new Error('Credential revoked')
        },
        controller.signal,
      )
      .catch((error: unknown) => error)
    try {
      expect(ssh.open).toHaveBeenCalledOnce()
      if (mode === 'abort') controller.abort()
      else revoked = true
      resolveTunnel({ child: new ChildProcess(), port: 1234, address: 'http://127.0.0.1:1234' })
      expect(await pending).toMatchObject({ message: expect.stringMatching(/aborted|revoked/) })
      expect(http.requests).toHaveLength(0)
    } finally {
      await client.dispose()
    }
  },
)

it('does not reopen a remote simulator after its viewer stops during SSH reconnection', async () => {
  const child = new ChildProcess()
  ssh.open.mockResolvedValue({ child, port: 1234, address: 'http://127.0.0.1:1234' })
  const client = new DeviceHostClient()
  try {
    const driver = await client.driver(host, 'task', {
      id: 'ios:device',
      name: 'iPhone',
      platform: 'ios',
      runtime: 'iOS',
      state: 'booted',
    })
    child.emit('exit', 1)
    let resolveTunnel!: (value: Awaited<ReturnType<typeof ssh.open>>) => void
    ssh.open.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTunnel = resolve
        }),
    )
    const errors = vi.fn<(error: Error) => void>()
    const detach = driver.start(vi.fn<Parameters<typeof driver.start>[0]>(), errors)
    expect(ssh.open).toHaveBeenCalledTimes(2)
    detach()
    resolveTunnel({ child: new ChildProcess(), port: 1235, address: 'http://127.0.0.1:1235' })
    // Drain acquisition and attachment continuations before inspecting outbound HTTP.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(http.requests.map((request) => request.path)).toEqual(['/api/device-host/open'])
    expect(sockets).toHaveLength(0)
    expect(errors).not.toHaveBeenCalled()
    await driver.close()
  } finally {
    await client.dispose()
  }
})
