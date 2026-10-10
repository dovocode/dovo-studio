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
type HttpFixture = { requests: RequestOptions[]; timeouts: number[]; status: number; body?: Buffer }
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
        setTimeout(timeout: number) {
          http.timeouts.push(timeout)
        }
        end() {
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
    expect(http.timeouts).toEqual([120000, 210000, 300000, 60000])
  } finally {
    await client.dispose()
  }
})
