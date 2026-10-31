import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { OpenCodeServers, opencodeHeaders } from './opencode-server'
import { createOpenCodeAdapter } from './opencode'
import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'
import { runtimeIntegration } from '../../../testing/integration'
vi.setConfig(runtimeIntegration)
const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

const stop = vi.hoisted(() => ({
  fail: undefined as OwnedProcessShutdownError | undefined,
  gate: undefined as Promise<void> | undefined,
}))
vi.mock('../../execution/stop-owned-child.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../execution/stop-owned-child.js')>()
  return {
    ...actual,
    stopOwnedChild: async (child: ChildProcess) => {
      await stop.gate
      if (stop.fail) throw stop.fail
      return actual.stopOwnedChild(child)
    },
  }
})
const { stopOwnedChild } = await vi.importActual<
  typeof import('../../execution/stop-owned-child.js')
>('../../execution/stop-owned-child.js')

// Slow catalog responses keep a model request in flight while the pool is under pressure.
const fixture = `
const http = require('node:http');
const expected = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expected) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/info') { response.writeHead(404); response.end('{}'); return; }
  setTimeout(() => response.end('{"all":[{"id":"test","name":"Test","models":{"model":{"id":"model","name":"Model"}}}],"connected":["test"]}'), Number(process.env.FIXTURE_DELAY || 0));
});
server.listen(0, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + server.address().port));
`
const agent = {
  id: 'agent',
  name: 'Test',
  provider: 'opencode' as const,
  endpoint: '',
  model: '',
  permission: 'read-only' as const,
  instructions: '',
}
const thread = (taskId: string, extra: Record<string, string> = {}) => ({
  ...agent,
  env: { DOVO_THREAD_SERVER_TASK: taskId, ...extra },
})
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null
const fixtureLaunch = () =>
  vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )

it('keeps the slot of a server whose shutdown is unconfirmed instead of launching a duplicate', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  const confirmed = Promise.withResolvers<void>()
  try {
    ;(await servers.acquire(thread('task'), 'task', '/tmp')).release()
    stop.fail = new OwnedProcessShutdownError('Provider shutdown was not confirmed: test', {
      confirmed: confirmed.promise,
    })
    await expect(servers.releaseTask('task')).rejects.toThrow('not confirmed')
    await expect(servers.acquire(thread('task'), 'task', '/tmp')).rejects.toThrow('not confirmed')
    expect(launch).toHaveBeenCalledTimes(1)
    stop.fail = undefined
    await stopOwnedChild(launch.mock.results[0].value)
    confirmed.resolve()
    await vi.waitFor(async () => {
      const lease = await servers.acquire(thread('task'), 'task', '/tmp')
      lease.release()
    })
    expect(launch).toHaveBeenCalledTimes(2)
  } finally {
    stop.fail = undefined
    await servers.dispose()
  }
})

it('holds the server for the whole model request', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  try {
    const leases = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        servers.acquire(thread(`task-${index}`), `task-${index}`, '/tmp'),
      ),
    )
    let finished = false
    const catalog = adapter.models!({ ...agent, env: { FIXTURE_DELAY: '1500' } }).finally(() => {
      finished = true
    })
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(16))
    await expect(servers.acquire(thread('task-16'), 'task-16', '/tmp')).rejects.toThrow(
      'configurations are busy',
    )
    expect(finished).toBe(false)
    expect((await catalog).models).toHaveLength(1)
    // Once the request ends, the catalog server is the unused one reclaimed for a new thread.
    const next = await servers.acquire(thread('task-16'), 'task-16', '/tmp')
    expect(running(launch.mock.results[15].value)).toBe(false)
    for (const lease of [...leases, next]) lease.release()
  } finally {
    await adapter.dispose?.()
  }
})

it('keeps a turn lease until its unconfirmed stop is confirmed', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch, async () => true)
  const adapter = createOpenCodeAdapter(servers)
  const confirmed = Promise.withResolvers<void>()
  try {
    await expect(
      adapter.run({
        agent: thread('task'),
        taskId: 'task',
        cwd: '/tmp',
        prompt: 'Test',
        signal: new AbortController().signal,
        onSession: () => {
          throw new OwnedProcessShutdownError('OpenCode shutdown was not confirmed.', {
            confirmed: confirmed.promise,
          })
        },
        onText: () => {},
        onActivity: () => {},
        approve: async () => 'deny',
        ask: async () => null,
      }),
    ).rejects.toThrow('not confirmed')
    const child = launch.mock.results[0].value
    await servers.releaseTask('task')
    expect(running(child)).toBe(true)
    confirmed.resolve()
    await vi.waitFor(() => expect(running(child)).toBe(false))
  } finally {
    await adapter.dispose?.()
  }
})

it('keeps the reservation when a failed launch cannot be confirmed stopped', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', 'process.exit(3)'], options),
  )
  const servers = new OpenCodeServers(launch)
  const confirmed = Promise.withResolvers<void>()
  stop.fail = new OwnedProcessShutdownError('Provider shutdown was not confirmed: test', {
    confirmed: confirmed.promise,
  })
  try {
    // The caller must keep treating the provider as running: same class and confirmation.
    const failure = await servers.acquire(thread('task'), 'task', '/tmp').catch((error) => error)
    expect(failure).toBeInstanceOf(OwnedProcessShutdownError)
    expect(failure.message).toContain('not confirmed')
    expect(failure.confirmed).toBe(confirmed.promise)
    expect(failure.cause.message).toContain('exited before becoming available')
    // The same configuration reports the unconfirmed stop rather than launching beside it.
    await expect(servers.acquire(thread('task'), 'task', '/tmp')).rejects.toThrow('not confirmed')
    expect(launch).toHaveBeenCalledTimes(1)
    stop.fail = undefined
    confirmed.resolve()
    await vi.waitFor(async () => {
      await expect(servers.acquire(thread('task'), 'task', '/tmp')).rejects.toThrow(
        'exited before becoming available',
      )
      expect(launch).toHaveBeenCalledTimes(2)
    })
  } finally {
    stop.fail = undefined
    await servers.dispose()
  }
})

it('never leases a server that is stopping, and retries once its stop is confirmed', async () => {
  const launch = fixtureLaunch()
  const servers = new OpenCodeServers(launch)
  const gate = Promise.withResolvers<void>()
  try {
    const first = await servers.acquire(thread('task'), 'task', '/tmp')
    first.release()
    stop.gate = gate.promise
    const retiring = servers.releaseTask('task')
    let leased = false
    const next = servers.acquire(thread('task'), 'task', '/tmp').then((lease) => {
      leased = true
      return lease
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(leased).toBe(false)
    expect(launch).toHaveBeenCalledTimes(1)
    stop.gate = undefined
    gate.resolve()
    await retiring
    const lease = await next
    expect(lease.agent.endpoint).not.toBe(first.agent.endpoint)
    expect(running(launch.mock.results[0].value)).toBe(false)
    expect(launch).toHaveBeenCalledTimes(2)
    lease.release()
  } finally {
    stop.gate = undefined
    gate.resolve()
    await servers.dispose()
  }
})

// The launcher leaves a descendant in its process group, then exits on request after readiness.
const orphaning = `
const http = require('node:http');
const { spawn } = require('node:child_process');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('node:fs').writeFileSync(process.env.FIXTURE_PID_FILE, String(descendant.pid));
const expected = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expected) { response.writeHead(401); response.end(); return; }
  if (request.url === '/exit') { response.end('{}', () => process.exit(0)); return; }
  response.writeHead(404); response.end('{}');
});
server.listen(0, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + server.address().port));
`
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function orphanedServer(servers: OpenCodeServers, taskId: string) {
  const { mkdtemp, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-opencode-'))
  temporaryDirectories.push(directory)
  const file = join(directory, 'pid')
  const config = thread(taskId, { FIXTURE_PID_FILE: file })
  const lease = await servers.acquire(config, taskId, '/tmp')
  lease.release()
  const descendant = Number(await readFile(file, 'utf8'))
  expect(alive(descendant)).toBe(true)
  await fetch(`${lease.agent.endpoint}/exit`, { headers: opencodeHeaders(lease.agent.env) })
  return { config, descendant }
}
const orphaningLaunch = () =>
  vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) =>
      spawn(process.execPath, ['-e', options.env?.FIXTURE_PID_FILE ? orphaning : fixture], options),
  )

it('cleans up the process group after an unexpected launcher exit before reusing its slot', async () => {
  if (process.platform === 'win32') return
  const launch = orphaningLaunch()
  const servers = new OpenCodeServers(launch)
  try {
    const { config, descendant } = await orphanedServer(servers, 'task')
    await vi.waitFor(() => expect(launch.mock.results[0].value.exitCode).toBe(0))
    // Group cleanup, not the launcher exit, releases the configuration.
    await vi.waitFor(() => expect(alive(descendant)).toBe(false))
    const lease = await servers.acquire(config, 'task', '/tmp')
    expect(launch).toHaveBeenCalledTimes(2)
    lease.release()
  } finally {
    await servers.dispose()
  }
})

it('keeps ownership and capacity after a launcher exit until its group cleanup is confirmed', async () => {
  if (process.platform === 'win32') return
  const launch = orphaningLaunch()
  const servers = new OpenCodeServers(launch)
  const confirmed = Promise.withResolvers<void>()
  const others: { release: () => void }[] = []
  try {
    stop.fail = new OwnedProcessShutdownError('Provider shutdown was not confirmed: test', {
      confirmed: confirmed.promise,
    })
    const { config, descendant } = await orphanedServer(servers, 'task')
    const launcher = launch.mock.results[0].value
    await vi.waitFor(() => expect(launcher.exitCode).toBe(0))
    expect(alive(descendant)).toBe(true)
    // Same configuration: fail closed rather than launching beside surviving descendants.
    await expect(servers.acquire(config, 'task', '/tmp')).rejects.toThrow('not confirmed')
    // The unconfirmed group still occupies one of the sixteen slots.
    stop.fail = undefined
    others.push(
      ...(await Promise.all(
        Array.from({ length: 15 }, (_, index) =>
          servers.acquire(thread(`other-${index}`), `other-${index}`, '/tmp'),
        ),
      )),
    )
    stop.fail = new OwnedProcessShutdownError('Provider shutdown was not confirmed: test', {
      confirmed: confirmed.promise,
    })
    await expect(servers.acquire(thread('extra'), 'extra', '/tmp')).rejects.toThrow('not confirmed')
    expect(launch).toHaveBeenCalledTimes(16)
    stop.fail = undefined
    await stopOwnedChild(launcher)
    expect(alive(descendant)).toBe(false)
    confirmed.resolve()
    await vi.waitFor(async () => {
      const lease = await servers.acquire(config, 'task', '/tmp')
      lease.release()
    })
    expect(launch).toHaveBeenCalledTimes(17)
  } finally {
    stop.fail = undefined
    confirmed.resolve()
    for (const lease of others) lease.release()
    await servers.dispose()
  }
})
