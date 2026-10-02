import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { Effect } from 'effect'
import type { AgentDiscovery } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'

export function opencodeHeaders(env: Record<string, string> = {}): Record<string, string> {
  const password = env.OPENCODE_SERVER_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD
  const username =
    env.OPENCODE_SERVER_USERNAME ?? process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'
  return password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
    : {}
}

type Connection = { endpoint: string; env: Record<string, string> }
type OwnedServer = { child: ChildProcess; ready: Promise<Connection> }
/** One local server per launch configuration. Explicit URLs are never launched or stopped. */
export class OpenCodeServers {
  constructor(
    private launch: (
      command: string,
      args: string[],
      options: SpawnOptions,
    ) => ChildProcess = spawn,
  ) {}
  private servers = new Map<string, OwnedServer>()
  private shutdown = new AbortController()
  async resolve<T extends AgentDiscovery>(agent: T): Promise<T & Connection> {
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
      return { ...agent, env: agent.env ?? {} }
    }
    const path = agent.executablePath || 'opencode'
    const command = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
    const args = agent.args ?? []
    if (args.some((arg) => /^--(?:hostname|port|mdns|cors)(?:=|$)/.test(arg)))
      throw new Error(
        'Dovo manages the local OpenCode listener. Configure a server URL to use custom network flags.',
      )
    const key = JSON.stringify([command, args, agent.env])
    let owned = this.servers.get(key)
    if (!owned) {
      if (this.servers.size >= 16)
        throw new Error(
          'Too many local OpenCode configurations are running. Restart the runtime to release them.',
        )
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
        if (this.servers.get(key)?.child === child) this.servers.delete(key)
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
        if (this.servers.get(key)?.child === child) this.servers.delete(key)
        await stopOwnedChild(child)
        throw error
      })
      owned = { child, ready }
      this.servers.set(key, owned)
    }
    const connection = await owned.ready
    return { ...agent, ...connection }
  }
  async dispose() {
    this.shutdown.abort()
    const owned = [...this.servers.values()]
    this.servers.clear()
    const results = await Promise.allSettled(
      owned.map(async ({ child, ready }) => {
        // Drain initialization rejection as well as the process shutdown.
        await Promise.allSettled([ready])
        await stopOwnedChild(child)
      }),
    )
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (errors.length) throw new AggregateError(errors, 'Could not stop local OpenCode servers')
  }
}
