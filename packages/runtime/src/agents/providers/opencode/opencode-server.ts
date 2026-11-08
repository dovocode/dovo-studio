import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { Effect } from 'effect'
import type { AgentDiscovery } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'
import { OwnedProcessShutdownError, stopOwnedChild } from '../../execution/stop-owned-child.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'

export function opencodeHeaders(env: Record<string, string> = {}): Record<string, string> {
  const password = env.OPENCODE_SERVER_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD
  const username =
    env.OPENCODE_SERVER_USERNAME ?? process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'
  return password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
    : {}
}

export const opencodeAddress = (address: string) =>
  (address || 'http://127.0.0.1:4096').replace(/\/$/, '')

/** A V1 server has no /api/info route. Authentication errors must not silently select V1. */
export async function isOpencodeV2(
  address: string,
  env?: Record<string, string>,
): Promise<boolean> {
  const response = await fetch(`${opencodeAddress(address)}/api/info`, {
    headers: opencodeHeaders(env),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  }).catch((cause: unknown) => {
    const url = new URL(opencodeAddress(address))
    throw new Error(
      `Cannot connect to OpenCode at ${url.origin}. Check that opencode serve is running there, or clear the server URL so Dovo starts it automatically.`,
      { cause },
    )
  })
  if (response.status === 404) return false
  // V1 serves its browser SPA for unknown routes, including /api/info.
  if (response.ok && response.headers.get('content-type')?.includes('text/html')) return false
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'OpenCode rejected authentication. Set OPENCODE_SERVER_PASSWORD and optionally OPENCODE_SERVER_USERNAME in the agent environment or runtime host environment.',
    )
  if (!response.ok) throw new Error(`OpenCode server info failed (${response.status})`)
  const info: unknown = await response.json()
  return (
    typeof info === 'object' &&
    info !== null &&
    'version' in info &&
    typeof info.version === 'string' &&
    /^2\./.test(info.version)
  )
}

export type OpenCodeConnection = { endpoint: string; env: Record<string, string> }
type Connection = OpenCodeConnection
type OwnedServer = {
  key: string
  child: ChildProcess
  ready: Promise<Connection>
  /** Turns and catalog reads currently using this server. */
  active: number
  /** Tasks whose latest turn used this configuration. */
  tasks: Set<string>
  /** Once a task owned it, losing every task owner means it was replaced or released. */
  claimed: boolean
  /** A failed turn may have left native sessions running until the server confirms otherwise. */
  pinned: boolean
  failures: number
  idleAt: number
  /** Backoff for asking a pinned server again when no turn, release or pressure does. */
  recheck?: { timer: ReturnType<typeof setTimeout>; delay: number }
  directories: Set<string>
  /** Set once retirement starts. The map slot stays reserved until the process is confirmed gone. */
  retiring?: Promise<void>
}
export type OpenCodeLease<T> = { agent: T & Connection; release: (completed?: boolean) => void }
const maxServers = 16
const firstRecheck = 30_000
const maxRecheck = 10 * 60_000

/** One local server per launch configuration, retired once no turn or native work owns it.
 * Explicit URLs are never launched or stopped. */
export class OpenCodeServers {
  constructor(
    private launch: (
      command: string,
      args: string[],
      options: SpawnOptions,
    ) => ChildProcess = spawn,
    /** Confirms a server has no running sessions. Unconfirmed servers stay up. */
    private sessionsIdle: (
      connection: Connection,
      directories: ReadonlySet<string>,
    ) => Promise<boolean> = opencodeSessionsIdle,
  ) {}
  private servers = new Map<string, OwnedServer>()
  private taskServers = new Map<string, OwnedServer>()
  private idle = new IdleProviders<OwnedServer>(
    (owned) => this.retire(owned),
    (owned) => owned.active > 0 || owned.pinned,
  )
  private shutdown = new AbortController()
  async resolve<T extends AgentDiscovery>(agent: T): Promise<T & Connection> {
    const lease = await this.acquire(agent)
    lease.release()
    return lease.agent
  }
  /** Holds a server until release. A run that did not complete pins it for native-work review. */
  async acquire<T extends AgentDiscovery>(
    agent: T,
    taskId?: string,
    directory?: string,
  ): Promise<OpenCodeLease<T>> {
    if (this.shutdown.signal.aborted) throw new Error('OpenCode is shutting down')
    if (agent.endpoint.trim()) {
      let url: URL
      try {
        url = new URL(agent.endpoint)
      } catch {
        throw new Error(
          'OpenCode requires an HTTP or HTTPS server URL. Set its executable path separately.',
        )
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error(
          'Use an HTTP or HTTPS OpenCode URL and put credentials in the agent environment settings.',
        )
      // The task left its local server for this URL; that server retires once unused.
      if (taskId) {
        const previous = this.unassign(taskId)
        if (previous) this.settleInBackground(previous)
      }
      return { agent: { ...agent, env: agent.env ?? {} }, release: () => {} }
    }
    const path = agent.executablePath || 'opencode'
    const command = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
    const args = agent.args ?? []
    if (args.some((arg) => /^--(?:hostname|port|mdns|cors)(?:=|$)/.test(arg)))
      throw new Error(
        'Dovo manages the local OpenCode listener. Configure a server URL to use custom network flags.',
      )
    const key = JSON.stringify([command, args, agent.env])
    let owned: OwnedServer | undefined
    while (true) {
      const existing = this.servers.get(key)
      if (existing && !existing.retiring) {
        owned = existing
        break
      }
      // Never launch a duplicate beside a server whose shutdown is unconfirmed.
      if (existing) {
        await existing.retiring
        continue
      }
      if (this.servers.size < maxServers) {
        owned = this.start(key, command, args, agent)
        break
      }
      if (!(await this.reserve()))
        throw new Error(
          'Too many local OpenCode configurations are busy. Wait for a running thread to finish, or restart the runtime to release them.',
        )
      if (this.shutdown.signal.aborted) throw new Error('OpenCode is shutting down')
    }
    const server = owned
    server.active++
    this.idle.delete(key)
    clearTimeout(server.recheck?.timer)
    if (directory) server.directories.add(directory)
    if (taskId) this.assign(taskId, server)
    let released = false
    const release = (completed = true) => {
      if (released) return
      released = true
      server.active--
      if (!completed) {
        server.pinned = true
        server.failures++
      }
      this.settleInBackground(server)
    }
    try {
      return { agent: { ...agent, ...(await server.ready) }, release }
    } catch (error) {
      release()
      throw error
    }
  }
  /** Retires the task's configuration unless another task, a turn or native work still owns it. */
  async releaseTask(taskId: string) {
    const owned = this.unassign(taskId)
    if (owned) await this.settle(owned)
  }
  private unassign(taskId: string) {
    const owned = this.taskServers.get(taskId)
    if (!owned) return
    this.taskServers.delete(taskId)
    owned.tasks.delete(taskId)
    return owned
  }
  private start(key: string, command: string, args: string[], agent: AgentDiscovery) {
    const env = {
      ...processEnvironment(agent.env),
      OPENCODE_SERVER_USERNAME: agent.env?.OPENCODE_SERVER_USERNAME || 'opencode',
      OPENCODE_SERVER_PASSWORD:
        agent.env?.OPENCODE_SERVER_PASSWORD || randomBytes(32).toString('base64url'),
    }
    const child = this.launch(
      command,
      ['serve', ...args, '--hostname', '127.0.0.1', '--port', '0'],
      {
        windowsHide: true,
        cwd: homedir(),
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let endpoint = '',
      startupError: Error | undefined
    let output = ''
    const read = (chunk: Buffer) => {
      output = (output + stripVTControlCharacters(chunk.toString())).slice(-8192)
      const address = /(?:server listening on|listening at)\s+(http:\/\/127\.0\.0\.1:\d+)/i.exec(
        output,
      )?.[1]
      if (address) endpoint = address
      const password = /server password\s+(\S+)/i.exec(output)?.[1]
      if (password) env.OPENCODE_SERVER_PASSWORD = password
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.once('error', (cause) => {
      startupError = new Error(
        `Cannot start OpenCode executable ${command}. Install OpenCode on this runtime or set its executable path.`,
        { cause },
      )
    })
    child.once('exit', (code) => {
      startupError ??= new Error(
        `OpenCode exited before becoming available (exit ${code ?? 'signal'}). Check its configuration on the runtime host.`,
      )
      // A launcher exit does not prove its process group stopped; keep the slot until it does.
      void this.beginStop(owned)
    })
    const ready = (async () => {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        this.shutdown.signal.throwIfAborted()
        if (startupError) throw startupError
        if (endpoint) {
          try {
            const response = await fetch(`${endpoint}/api/info`, {
              headers: opencodeHeaders(env),
              signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(2000)]),
              redirect: 'error',
            })
            // V1 has no info route. Any responding non-auth/non-server-error status proves readiness.
            await response.body?.cancel()
            if (response.status < 500 && response.status !== 401 && response.status !== 403)
              return {
                endpoint,
                env: {
                  ...agent.env,
                  OPENCODE_SERVER_USERNAME: env.OPENCODE_SERVER_USERNAME,
                  OPENCODE_SERVER_PASSWORD: env.OPENCODE_SERVER_PASSWORD,
                },
              }
          } catch (error) {
            if (this.shutdown.signal.aborted) throw error
          }
        }
        await Effect.runPromise(Effect.sleep('100 millis'))
      }
      throw new Error(
        'OpenCode did not become ready within 20 seconds. Check its installation and configuration on the runtime host.',
      )
    })().catch(async (error: unknown) => {
      // Only a confirmed stop reports the startup cause alone. Otherwise callers must keep
      // treating the provider as running, so preserve the shutdown error and its confirmation.
      try {
        await this.beginStop(owned)
      } catch (stopError) {
        if (!(stopError instanceof OwnedProcessShutdownError)) throw stopError
        throw new OwnedProcessShutdownError(
          `${error instanceof Error ? error.message : 'OpenCode could not start.'} ${stopError.message}`,
          { cause: error, confirmed: stopError.confirmed },
        )
      }
      throw error
    })
    const owned: OwnedServer = {
      key,
      child,
      ready,
      active: 0,
      tasks: new Set(),
      claimed: false,
      pinned: false,
      failures: 0,
      idleAt: Date.now(),
      directories: new Set(),
    }
    this.servers.set(key, owned)
    return owned
  }
  /** A task follows its latest configuration; the configuration it left is retired once unused. */
  private assign(taskId: string, owned: OwnedServer) {
    const previous = this.taskServers.get(taskId)
    owned.tasks.add(taskId)
    owned.claimed = true
    this.taskServers.set(taskId, owned)
    if (previous && previous !== owned) {
      previous.tasks.delete(taskId)
      this.settleInBackground(previous)
    }
  }
  private settleInBackground(owned: OwnedServer) {
    void this.settle(owned).catch((error: unknown) =>
      console.error('Could not retire a local OpenCode server:', error),
    )
  }
  private async settle(owned: OwnedServer) {
    const unused = () => this.servers.get(owned.key) === owned && !owned.active && !owned.retiring
    if (!unused()) return
    if (owned.pinned && !(await this.confirmIdle(owned))) return this.recheck(owned)
    if (!unused()) return
    owned.idleAt = Date.now()
    if (owned.claimed && !owned.tasks.size) return this.retire(owned)
    this.idle.set(owned.key, owned)
    await this.idle.prune(releaseIdleProvider())
  }
  /** Unpins a failed turn's server only when it reports no running sessions. */
  private async confirmIdle(owned: OwnedServer) {
    if (!owned.pinned) return true
    const failures = owned.failures
    try {
      const idle = await this.sessionsIdle(await owned.ready, owned.directories)
      // A newer turn may have started or failed while the server answered.
      if (!idle || owned.active || owned.failures !== failures) return false
      owned.pinned = false
      owned.recheck = undefined
      return true
    } catch {
      return false
    }
  }
  /** Frees one slot by retiring the oldest unused server; never one that a turn still holds. */
  private async reserve() {
    const servers = [...this.servers.values()]
    const unused = servers
      .filter((owned) => !owned.active && !owned.retiring)
      .sort((a, b) => Number(a.pinned) - Number(b.pinned) || a.idleAt - b.idleAt)
    for (const owned of unused) {
      if (!(await this.confirmIdle(owned))) continue
      if (this.servers.get(owned.key) !== owned || owned.active || owned.retiring) continue
      await this.retire(owned)
      return true
    }
    const retiring = servers.flatMap((owned) => (owned.retiring ? [owned.retiring] : []))
    if (!retiring.length) return false
    // A confirmed retirement frees its slot; an unconfirmed one reports why it cannot.
    await Promise.race(retiring)
    return true
  }
  /** Drops task and idle ownership. The map slot is released separately, after shutdown. */
  /** Native sessions can finish without any Dovo event, so ask again with a bounded backoff. */
  private recheck(owned: OwnedServer) {
    if (this.shutdown.signal.aborted || !owned.pinned || owned.active || owned.retiring) return
    clearTimeout(owned.recheck?.timer)
    const delay = owned.recheck ? Math.min(owned.recheck.delay * 2, maxRecheck) : firstRecheck
    const timer = setTimeout(() => this.settleInBackground(owned), delay)
    timer.unref()
    owned.recheck = { timer, delay }
  }
  private detach(owned: OwnedServer) {
    clearTimeout(owned.recheck?.timer)
    if (this.idle.get(owned.key) === owned) this.idle.delete(owned.key)
    for (const taskId of owned.tasks)
      if (this.taskServers.get(taskId) === owned) this.taskServers.delete(taskId)
  }
  private forget(owned: OwnedServer) {
    this.detach(owned)
    if (this.servers.get(owned.key) === owned) this.servers.delete(owned.key)
  }
  private async stop(owned: OwnedServer) {
    try {
      await stopOwnedChild(owned.child)
    } catch (error) {
      if (error instanceof OwnedProcessShutdownError && error.confirmed)
        void error.confirmed.then(() => this.forget(owned))
      throw error
    }
    this.forget(owned)
  }
  /** Stops without waiting for startup; retirement may already be waiting on it. */
  private beginStop(owned: OwnedServer) {
    // stopOwnedChild is idempotent per child, so a later retirement shares this stop.
    const stopping = this.stop(owned)
    void stopping.catch(() => undefined)
    owned.retiring ??= stopping
    return stopping
  }
  /** IdleProviders drops its record before closing; this map keeps the slot until stop confirms. */
  private retire(owned: OwnedServer) {
    owned.retiring ??= (async () => {
      this.detach(owned)
      // Drain initialization rejection as well as the process shutdown.
      await Promise.allSettled([owned.ready])
      await this.stop(owned)
    })()
    return owned.retiring
  }
  async dispose() {
    this.shutdown.abort()
    this.idle.clear()
    const results = await Promise.allSettled(
      [...this.servers.values()].map((owned) => this.retire(owned)),
    )
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (errors.length) throw new AggregateError(errors, 'Could not stop local OpenCode servers')
  }
}

/** Asks the server itself, so a failed turn's native sessions are never assumed stopped. */
export async function opencodeSessionsIdle(
  connection: Connection,
  directories: ReadonlySet<string>,
): Promise<boolean> {
  const headers = opencodeHeaders(connection.env)
  const signal = AbortSignal.timeout(5000)
  if (await isOpencodeV2(connection.endpoint, connection.env)) {
    const { OpenCode } = await import('@opencode/client')
    const api = OpenCode.make({ baseUrl: connection.endpoint, headers })
    return !Object.keys(await api.session.active({ signal })).length
  }
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2')
  const api = createOpencodeClient({ baseUrl: connection.endpoint, headers, throwOnError: true })
  for (const directory of directories) {
    const states = await api.session.status({ directory }, { throwOnError: true, signal })
    if (Object.values(states.data).some((state) => state.type !== 'idle')) return false
  }
  return true
}
