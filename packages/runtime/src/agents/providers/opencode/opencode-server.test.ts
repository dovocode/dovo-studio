import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { OpenCodeServers, opencodeHeaders } from './opencode-server'
import { createOpenCodeAdapter } from './opencode'
import { runtimeIntegration } from '../../../testing/integration'
vi.setConfig(runtimeIntegration)
const agent = {
  id: 'agent',
  name: 'Test',
  provider: 'opencode' as const,
  endpoint: '',
  model: '',
  permission: 'read-only' as const,
  instructions: '',
}
// A real owned process exercises listener discovery, authentication and process-group cleanup.
const fixture = `
const http = require('node:http');
const password = process.env.FIXTURE_GENERATED_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD;
const expected = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + password).toString('base64');
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expected) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/info') { response.writeHead(404); response.end('{}'); }
  else if (request.url === '/global/health') response.end('{"healthy":true,"version":"1.18.33"}');
  else response.end('{"all":[{"id":"test","name":"Test","models":{"model":{"id":"model","name":"Model"}}}],"connected":["test"]}');
});
server.listen(0, '127.0.0.1', () => {
  console.log('opencode server listening on http://127.0.0.1:' + server.address().port);
  if (process.env.FIXTURE_GENERATED_PASSWORD) console.log('server password ' + password);
});
`
it('shares an authenticated local server across model loading and turns, then stops it', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  let endpoint = ''
  try {
    const [first, second, catalog] = await Promise.all([
      servers.resolve(agent),
      servers.resolve(agent),
      adapter.models!(agent),
    ])
    endpoint = first.endpoint
    expect(first.endpoint).toBe(second.endpoint)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0][2]).toMatchObject({ windowsHide: true })
    expect(launch.mock.calls[0][1]).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '0'])
    expect(catalog.models).toEqual([{ id: 'test/model', name: 'Test / Model', reasoning: [] }])
    expect((await adapter.probe(agent)).available).toBe(true)
    expect((await fetch(`${endpoint}/api/info`)).status).toBe(401)
    expect(first.env?.OPENCODE_SERVER_PASSWORD).toBeTruthy()
  } finally {
    await adapter.dispose?.()
  }
  await expect(fetch(endpoint)).rejects.toThrow(/fetch failed|ECONNREFUSED/)
  await expect(servers.resolve(agent)).rejects.toThrow('shutting down')
})
it('uses a generated server password and keeps launch configurations separate', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  try {
    const first = await servers.resolve({
      ...agent,
      env: {
        FIXTURE_GENERATED_PASSWORD: 'generated-password',
        OPENCODE_SERVER_USERNAME: 'configured-user',
      },
    })
    const second = await servers.resolve({
      ...agent,
      env: { OPENCODE_SERVER_PASSWORD: 'configured-password' },
    })
    expect(first.env.OPENCODE_SERVER_PASSWORD).toBe('generated-password')
    expect(first.endpoint).not.toBe(second.endpoint)
    expect(launch).toHaveBeenCalledTimes(2)
    const response = await fetch(`${first.endpoint}/api/info`, {
      headers: opencodeHeaders(first.env),
    })
    expect(response.status).toBe(404)
  } finally {
    await servers.dispose()
  }
})
it('leaves explicit HTTP URLs alone and reports unreachable URLs clearly', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  const unused = createServer()
  unused.listen(0, '127.0.0.1')
  await once(unused, 'listening')
  const address = unused.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  await new Promise<void>((resolve) => unused.close(() => resolve()))
  const explicit = { ...agent, endpoint: `http://127.0.0.1:${address.port}` }
  try {
    expect(await servers.resolve(explicit)).toMatchObject(explicit)
    await expect(adapter.models!(explicit)).rejects.toThrow('Cannot connect to OpenCode')
    expect(launch).not.toHaveBeenCalled()
    await expect(servers.resolve({ ...agent, endpoint: '/path/to/opencode' })).rejects.toThrow(
      'executable path separately',
    )
  } finally {
    await adapter.dispose?.()
  }
})
it('does not cache a failed launch', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn('/dovo-nonexistent-opencode', [], options),
  )
  const servers = new OpenCodeServers(launch)
  try {
    await expect(servers.resolve(agent)).rejects.toThrow('Install OpenCode')
    await expect(servers.resolve(agent)).rejects.toThrow('Install OpenCode')
    expect(launch).toHaveBeenCalledTimes(2)
  } finally {
    await servers.dispose()
  }
})
it('uses configured credentials rather than the process environment', () => {
  vi.stubEnv('OPENCODE_SERVER_PASSWORD', 'process-password')
  vi.stubEnv('OPENCODE_SERVER_USERNAME', 'process-user')
  try {
    expect(
      opencodeHeaders({
        OPENCODE_SERVER_PASSWORD: 'agent-password',
        OPENCODE_SERVER_USERNAME: 'agent-user',
      }),
    ).toEqual({
      Authorization: `Basic ${Buffer.from('agent-user:agent-password').toString('base64')}`,
    })
    expect(opencodeHeaders({ OPENCODE_SERVER_PASSWORD: '' })).toEqual({})
  } finally {
    vi.unstubAllEnvs()
  }
})

it('stops a server while initialization is still pending', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options),
  )
  const servers = new OpenCodeServers(launch)
  const ready = servers.resolve(agent)
  await Promise.all([expect(ready).rejects.toThrow(/aborted|OpenCode exited/), servers.dispose()])
  expect(
    launch.mock.results[0].value.exitCode !== null ||
      launch.mock.results[0].value.signalCode !== null,
  ).toBe(true)
})

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null
const thread = (taskId: string, extra: Record<string, string> = {}) => ({
  ...agent,
  // Mirrors the per-thread process markers that attribute agent-launched services.
  env: { DOVO_THREAD_SERVER_TASK: taskId, ...extra },
})
const fixtureLaunch = () =>
  vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )

it('retires idle thread servers so a seventeenth thread does not exhaust the pool', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  try {
    for (let index = 0; index < 17; index++) {
      const lease = await servers.acquire(thread(`task-${index}`), `task-${index}`, '/tmp')
      expect(launch.mock.calls[index][2].env).toMatchObject({
        DOVO_THREAD_SERVER_TASK: `task-${index}`,
      })
      lease.release()
    }
    expect(launch).toHaveBeenCalledTimes(17)
    // The shared idle budget keeps at most four warm providers across harnesses.
    await vi.waitFor(() =>
      expect(launch.mock.results.filter(({ value }) => running(value)).length).toBeLessThanOrEqual(
        4,
      ),
    )
  } finally {
    await servers.dispose()
  }
  expect(launch.mock.results.every(({ value }) => !running(value))).toBe(true)
})

it('retires a replaced configuration and released tasks, but never an active turn', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  try {
    const first = await servers.acquire(thread('task', { TOKEN: 'old' }), 'task', '/tmp')
    first.release()
    const second = await servers.acquire(thread('task', { TOKEN: 'new' }), 'task', '/tmp')
    const [old, current] = launch.mock.results.map(({ value }) => value)
    await vi.waitFor(() => expect(running(old)).toBe(false))
    await servers.releaseTask('task')
    expect(running(current)).toBe(true)
    second.release()
    await vi.waitFor(() => expect(running(current)).toBe(false))
    // The thread can resume on a fresh server for the same configuration.
    const resumed = await servers.acquire(thread('task', { TOKEN: 'new' }), 'task', '/tmp')
    expect(resumed.agent.endpoint).not.toBe(second.agent.endpoint)
    resumed.release()
  } finally {
    await servers.dispose()
  }
})

it('reclaims unused servers before refusing, and refuses only when every server is busy', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  try {
    const leases = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        servers.acquire(thread(`task-${index}`), `task-${index}`, '/tmp'),
      ),
    )
    await expect(servers.acquire(thread('task-16'), 'task-16', '/tmp')).rejects.toThrow(
      'configurations are busy',
    )
    leases[3].release()
    const next = await servers.acquire(thread('task-16'), 'task-16', '/tmp')
    expect(running(launch.mock.results[3].value)).toBe(false)
    expect(launch.mock.results.filter(({ value }) => running(value))).toHaveLength(16)
    for (const lease of [...leases, next]) lease.release()
  } finally {
    await servers.dispose()
  }
})

it('keeps a failed turn server until it confirms that no sessions are running', async () => {
  const launch = fixtureLaunch()
  let sessionsIdle = false
  const confirm = vi.fn<() => Promise<boolean>>(async () => sessionsIdle)
  const servers = new OpenCodeServers(launch, confirm)
  try {
    const lease = await servers.acquire(thread('task'), 'task', '/workspace')
    lease.release(false)
    const child = launch.mock.results[0].value
    await servers.releaseTask('task')
    expect(running(child)).toBe(true)
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: lease.agent.endpoint }),
      new Set(['/workspace']),
    )
    // Pool pressure also asks the server rather than assuming native work stopped.
    sessionsIdle = true
    const leases = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        servers.acquire(thread(`other-${index}`), `other-${index}`, '/tmp'),
      ),
    )
    expect(running(child)).toBe(false)
    for (const other of leases) other.release()
  } finally {
    await servers.dispose()
  }
})

it('releases task servers through the adapter', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  try {
    ;(await servers.acquire(thread('task'), 'task', '/tmp')).release()
    await adapter.releaseTask!('task')
    expect(running(launch.mock.results[0].value)).toBe(false)
  } finally {
    await adapter.dispose?.()
  }
})

it('rechecks a pinned server with backoff until its native sessions finish, then retires it', async () => {
  const launch = fixtureLaunch()
  let sessionsIdle = false
  const confirm = vi.fn<() => Promise<boolean>>(async () => sessionsIdle)
  const servers = new OpenCodeServers(launch, confirm)
  try {
    const lease = await servers.acquire(thread('task'), 'task', '/tmp')
    const child = launch.mock.results[0].value
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await servers.releaseTask('task')
    lease.release(false)
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    // No turn, release or pool pressure follows: only the bounded backoff asks again.
    await vi.advanceTimersByTimeAsync(29_000)
    expect(confirm).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(confirm).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(running(child)).toBe(true)
    sessionsIdle = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(confirm).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
    await vi.waitFor(() => expect(running(child)).toBe(false))
  } finally {
    vi.useRealTimers()
    await servers.dispose()
  }
})

it('retires a task local server when the task switches to an explicit URL', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  try {
    const local = await servers.acquire(thread('task'), 'task', '/tmp')
    const child = launch.mock.results[0].value
    const explicit = { ...thread('task'), endpoint: 'http://192.0.2.1:4096' }
    // An active turn on the local server keeps it alive across the switch.
    const external = await servers.acquire(explicit, 'task', '/tmp')
    expect(external.agent.endpoint).toBe(explicit.endpoint)
    expect(running(child)).toBe(true)
    local.release()
    await vi.waitFor(() => expect(running(child)).toBe(false))
    // The external URL is never launched or stopped.
    external.release()
    await servers.releaseTask('task')
    expect(launch).toHaveBeenCalledTimes(1)
  } finally {
    await servers.dispose()
  }
})
