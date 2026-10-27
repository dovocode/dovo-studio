/// <reference types="node" />
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import process from 'node:process'
import { ThreadServers } from './thread-servers.js'

const system = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<string>>(),
  readdir: vi.fn<(path: string) => Promise<string[]>>(),
  readlink: vi.fn<(path: string) => Promise<string>>(),
  exec: vi.fn<
    (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  >(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: system.readFile,
  readdir: system.readdir,
  readlink: system.readlink,
}))
vi.mock('../process.js', () => ({ exec: system.exec }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const environment = (separator: string) =>
  Object.entries(new ThreadServers('runtime').environment('thread', 'agent'))
    .map(([key, value]) => `${key}=${value}`)
    .join(separator)

function linuxFixture(recycle: boolean) {
  const reads: string[] = []
  let replaced = false
  const stat = (started: string) =>
    `41 (node (worker)) ${['S', ...Array<string>(18).fill('0'), started].join(' ')}`
  system.readFile.mockImplementation(async (path) => {
    reads.push(path)
    if (path === '/proc/net/tcp') return 'header\n 0: 0100007F:0BB8 0:0 0A 0:0 0:0 0 1000 0 123 1\n'
    if (path === '/proc/net/tcp6') return 'header\n'
    if (path === '/proc/41/stat') return stat(replaced ? '200' : '100')
    if (path === '/proc/41/environ') {
      // The environment belongs to the old process; the PID is recycled immediately
      // afterwards, before any descriptors or subsequent identity are read.
      replaced = recycle
      return environment('\0')
    }
    if (path === '/proc/41/comm') return 'node\n'
    throw new Error(`Unexpected read: ${path}`)
  })
  system.readdir.mockImplementation(async (path) => {
    if (path === '/proc') return ['41', 'self']
    if (path === '/proc/41/fd') return ['3']
    throw new Error(`Unexpected directory: ${path}`)
  })
  system.readlink.mockResolvedValue('socket:[123]')
  return reads
}

it('rejects Linux PID reuse between reading thread markers and socket ownership', async () => {
  const reads = linuxFixture(true)
  expect(await new ThreadServers('runtime', 'linux').list('thread')).toEqual({
    supported: true,
    servers: [],
  })
  expect(reads.indexOf('/proc/41/stat')).toBeLessThan(reads.indexOf('/proc/41/environ'))
  expect(reads.filter((path) => path === '/proc/41/stat')).toHaveLength(2)
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps a stable Linux process and confirms HTTP on its owned listener', async () => {
  linuxFixture(false)
  expect(await new ThreadServers('runtime', 'linux').list('thread')).toEqual({
    supported: true,
    servers: [
      {
        pid: 41,
        started: '100',
        port: 3000,
        name: 'node',
        source: 'agent',
        url: 'http://127.0.0.1:3000',
      },
    ],
  })
  expect(fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:3000',
    expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
  )
  expect(system.exec).not.toHaveBeenCalled()
})

it('keeps raw TCP services visible without inventing an HTTP Open endpoint', async () => {
  linuxFixture(false)
  vi.mocked(fetch).mockRejectedValue(new TypeError('Not an HTTP service'))
  const result = await new ThreadServers('runtime', 'linux').list('thread')
  expect(result.servers).toEqual([expect.objectContaining({ pid: 41, port: 3000 })])
  expect(result.servers[0]?.url).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('opens an IPv6-only HTTP listener through its verified loopback address', async () => {
  linuxFixture(false)
  vi.mocked(fetch)
    .mockRejectedValueOnce(new TypeError('IPv4 refused'))
    .mockResolvedValueOnce(new Response(null))
  const result = await new ThreadServers('runtime', 'linux').list('thread')
  expect(result.servers[0]?.url).toBe('http://[::1]:3000')
})

it('reports a server that ignores SIGTERM without killing its shared process group', async () => {
  linuxFixture(false)
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  const authorize = vi.fn<() => void>()
  try {
    await expect(
      new ThreadServers('runtime', 'linux').stop(
        {
          taskId: 'thread',
          pid: 41,
          port: 3000,
          started: '100',
        },
        authorize,
      ),
    ).rejects.toThrow('The server is still running after Stop')
    expect(authorize).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledExactlyOnceWith(41, 'SIGTERM')
  } finally {
    kill.mockRestore()
  }
})

function macFixture({ recycled = false, listener = true } = {}) {
  const calls: string[] = []
  let identityReads = 0
  system.exec.mockImplementation(async (command, args) => {
    const call = `${command} ${args.join(' ')}`
    calls.push(call)
    if (command === '/usr/sbin/lsof' && !args.includes('-a'))
      return { stdout: 'p41\ncnode\nn127.0.0.1:3000\nn[::1]:8080\n', stderr: '' }
    if (command === '/bin/ps' && args.includes('lstart=')) {
      identityReads++
      return {
        stdout:
          recycled && identityReads > 1
            ? 'Tue Oct 27 22:30:01 2026\n'
            : 'Tue Oct 27 22:30:00 2026\n',
        stderr: '',
      }
    }
    if (command === '/bin/ps' && args.includes('command='))
      return { stdout: `node server.js ${environment(' ')}\n`, stderr: '' }
    if (command === '/usr/sbin/lsof' && args.includes('-a'))
      return { stdout: listener ? 'p41\nn127.0.0.1:3000\n' : 'p41\nn127.0.0.1:9090\n', stderr: '' }
    throw new Error(`Unexpected command: ${call}`)
  })
  return calls
}

it('brackets macOS environment and fresh PID-scoped listeners with process identity reads', async () => {
  const calls = macFixture()
  const result = await new ThreadServers('runtime', 'darwin').list('thread')
  expect(result).toEqual({
    supported: true,
    servers: [
      {
        pid: 41,
        name: 'node',
        port: 3000,
        source: 'agent',
        started: 'Tue Oct 27 22:30:00 2026',
        url: 'http://127.0.0.1:3000',
      },
    ],
  })
  expect(calls).toEqual([
    '/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -Fpcn',
    '/bin/ps -p 41 -o lstart=',
    '/bin/ps eww -p 41 -o command=',
    '/usr/sbin/lsof -a -p 41 -nP -iTCP -sTCP:LISTEN -Fn',
    '/bin/ps -p 41 -o lstart=',
  ])
  expect(system.readFile).not.toHaveBeenCalled()
})

it('rejects macOS PID reuse even if the environment and initial lsof row look valid', async () => {
  macFixture({ recycled: true })
  expect((await new ThreadServers('runtime', 'darwin').list('thread')).servers).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects stale macOS listener rows even when the PID start identity stays unchanged', async () => {
  macFixture({ listener: false })
  expect((await new ThreadServers('runtime', 'darwin').list('thread')).servers).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('reports unsupported platforms without filesystem, command or network discovery', async () => {
  expect(await new ThreadServers('runtime', 'win32').list('thread')).toEqual({
    supported: false,
    servers: [],
  })
  expect(system.readFile).not.toHaveBeenCalled()
  expect(system.readdir).not.toHaveBeenCalled()
  expect(system.exec).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
