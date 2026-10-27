import { readFile, readdir, readlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { endianness } from 'node:os'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { exec } from '../process.js'
import { HttpError } from '../errors.js'
import type { ThreadServer } from '@dovo/protocol'

type Listener = { port: number; hosts: string[] }
type Server = ThreadServer & { taskId: string; hosts: string[] }
const runtimeKey = 'DOVO_STUDIO_SERVER_RUNTIME'
const taskKey = 'DOVO_STUDIO_SERVER_THREAD'
const sourceKey = 'DOVO_STUDIO_SERVER_SOURCE'
const inaccessible = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  ['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(String(error.code))

async function optionalRead(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (inaccessible(error)) return ''
    throw error
  }
}

export function serverOwner(environment: string, runtimeId: string, separator = '\0') {
  const values = new Map(
    environment.split(separator).map((item) => {
      const split = item.indexOf('=')
      return [item.slice(0, split), item.slice(split + 1)]
    }),
  )
  const taskId = values.get(taskKey)
  const source = values.get(sourceKey)
  if (
    values.get(runtimeKey) !== runtimeId ||
    !taskId ||
    taskId.length > 200 ||
    !['agent', 'terminal'].includes(source ?? '')
  )
    return null
  return { taskId, source: source === 'terminal' ? ('terminal' as const) : ('agent' as const) }
}

function loopbackHosts(address: string, family = '') {
  if (address === '0.0.0.0' || (address === '*' && family === 'IPv4')) return ['127.0.0.1']
  if (address === '::' || (address === '*' && family === 'IPv6')) return ['[::1]']
  if (isIP(address) === 4 && address.startsWith('127.')) return [address]
  if (address === '::1') return ['[::1]']
  return []
}

export function linuxListeningSockets(text: string) {
  const sockets = new Map<string, Listener>()
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (fields[3] !== '0A' || !fields[9]) continue
    const [hex, rawPort] = fields[1]?.split(':') ?? []
    if (!hex || !/^(?:[\da-f]{8}|[\da-f]{32})$/i.test(hex)) continue
    const port = Number.parseInt(rawPort ?? '', 16)
    const bytes = Buffer.from(hex, 'hex')
    if (endianness() === 'LE') bytes.swap32()
    const address =
      bytes.length === 4
        ? [...bytes].join('.')
        : new URL(
            `http://[${Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(index * 2).toString(16)).join(':')}]`,
          ).hostname.slice(1, -1)
    if (port > 0 && port <= 65535) sockets.set(fields[9], { port, hosts: loopbackHosts(address) })
  }
  return sockets
}

function macListeningSockets(text: string) {
  const rows: Array<Listener & { pid: number; name: string; key: string }> = []
  let pid = 0,
    name = '',
    family = ''
  for (const line of text.split('\n')) {
    if (line[0] === 'p') {
      pid = Number(line.slice(1))
      family = ''
    } else if (line[0] === 'c') name = basename(line.slice(1))
    else if (line[0] === 't') family = line.slice(1)
    else if (line[0] === 'n') {
      const match = /^(.*):(\d+)$/.exec(line.slice(1))
      const port = Number(match?.[2])
      if (!match || !(pid > 0 && port > 0 && port <= 65535)) continue
      const address = match[1]!.replace(/^\[|\]$/g, '')
      rows.push({
        pid,
        name,
        port,
        hosts: loopbackHosts(address, family),
        key: `${family}:${line}`,
      })
    }
  }
  return rows
}

/** Only marked processes on this runtime are considered. Markers identify provenance,
 * not permissions: the authenticated route separately authorizes every read and stop. */
export class ThreadServers {
  private pending?: Promise<Server[]>
  private cached?: { at: number; servers: Server[] }
  constructor(
    private runtimeId: string,
    private platform: NodeJS.Platform = process.platform,
  ) {}
  environment(taskId: string, source: ThreadServer['source']) {
    return { [runtimeKey]: this.runtimeId, [taskKey]: taskId, [sourceKey]: source }
  }
  private async linux() {
    const [tcp, tcp6, directories] = await Promise.all([
      readFile('/proc/net/tcp', 'utf8'),
      optionalRead('/proc/net/tcp6'),
      readdir('/proc'),
    ])
    const sockets = new Map([...linuxListeningSockets(tcp), ...linuxListeningSockets(tcp6)])
    if (!sockets.size) return []
    const pids = directories.filter((name) => /^\d+$/.test(name))
    const servers: Server[] = []
    // Bounded parallel filesystem work; no external commands or background scanner.
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(12, pids.length) }, async () => {
        while (next < pids.length) {
          const pid = pids[next++]!
          const stat = await optionalRead(`/proc/${pid}/stat`)
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
          const started = fields[19]
          if (!started || fields[0] === 'Z') continue
          const owner = serverOwner(await optionalRead(`/proc/${pid}/environ`), this.runtimeId)
          if (!owner) continue
          let descriptors: string[]
          try {
            descriptors = await readdir(`/proc/${pid}/fd`)
          } catch (error) {
            if (inaccessible(error)) continue
            throw error
          }
          const listeners = new Map<string, Listener>()
          for (const descriptor of descriptors) {
            let link: string
            try {
              link = await readlink(`/proc/${pid}/fd/${descriptor}`)
            } catch (error) {
              if (inaccessible(error)) continue
              throw error
            }
            const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1]
            const listener = inode && sockets.get(inode)
            if (listener) listeners.set(inode, listener)
          }
          const name = (await optionalRead(`/proc/${pid}/comm`)).trim()
          // Verify the process did not change identity during filesystem reads.
          const current = await optionalRead(`/proc/${pid}/stat`)
          if (current.slice(current.lastIndexOf(')') + 2).split(' ')[19] !== started) continue
          for (const listener of listeners.values())
            servers.push({
              pid: Number(pid),
              started,
              name,
              ...listener,
              ...owner,
              hosts: listener.hosts.filter((host) =>
                [...sockets].every(
                  ([inode, other]) =>
                    other.port !== listener.port ||
                    !other.hosts.includes(host) ||
                    listeners.has(inode),
                ),
              ),
            })
        }
      }),
    )
    return servers
  }
  private async mac() {
    let output: string
    try {
      output = (
        await exec('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcnt'], {
          timeout: 5000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout
    } catch (error) {
      // lsof exits 1 when there are no listening sockets.
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 1 &&
        'stdout' in error &&
        error.stdout === ''
      )
        return []
      throw error
    }
    const rows = macListeningSockets(output)
    const servers: Server[] = []
    for (const pid of new Set(rows.map((row) => row.pid))) {
      // Read one PID at a time to avoid truncating long launch environments.
      let environment: string, identity: string, listeners: string, current: string
      try {
        identity = (
          await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 })
        ).stdout.trim()
        environment = (
          await exec('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {
            timeout: 2000,
            maxBuffer: 1024 * 1024,
          })
        ).stdout
        if (!serverOwner(environment.trim(), this.runtimeId, ' ')) continue
        listeners = (
          await exec(
            '/usr/sbin/lsof',
            ['-a', '-p', String(pid), '-nP', '-iTCP', '-sTCP:LISTEN', '-Fnt'],
            { timeout: 2000, maxBuffer: 1024 * 1024 },
          )
        ).stdout
        current = (
          await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 })
        ).stdout.trim()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 1) continue
        throw error
      }
      const owner = serverOwner(environment.trim(), this.runtimeId, ' ')
      if (!owner || !identity || identity !== current) continue
      const currentListeners = new Set(macListeningSockets(listeners).map((row) => row.key))
      for (const row of rows.filter((row) => row.pid === pid && currentListeners.has(row.key)))
        servers.push({
          ...row,
          ...owner,
          started: identity,
          hosts: row.hosts.filter((host) =>
            rows.every(
              (other) =>
                other.pid === pid || other.port !== row.port || !other.hosts.includes(host),
            ),
          ),
        })
    }
    return servers
  }
  private scan(fresh = false): Promise<Server[]> {
    if (this.pending) return this.pending
    if (!fresh && this.cached && Date.now() - this.cached.at < 2000)
      return Promise.resolve(this.cached.servers)
    this.pending = (
      this.platform === 'linux'
        ? this.linux()
        : this.platform === 'darwin'
          ? this.mac()
          : Promise.resolve([])
    )
      .then((servers) => {
        const byProcessPort = new Map<string, Server>()
        for (const server of servers) {
          const key = `${server.pid}:${server.port}`
          const existing = byProcessPort.get(key)
          byProcessPort.set(key, {
            ...server,
            hosts: [...new Set([...(existing?.hosts ?? []), ...server.hosts])],
          })
        }
        const unique = [...byProcessPort.values()]
        this.cached = { at: Date.now(), servers: unique }
        return unique
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
  async list(taskId: string) {
    const targets = (await this.scan())
      .filter((server) => server.taskId === taskId)
      .map<{ server: ThreadServer; hosts: string[] }>(
        ({ pid, port, started, name, source, hosts }) => ({
          server: { pid, port, started, name, source },
          hosts,
        }),
      )
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (next < targets.length) {
          const { server, hosts } = targets[next++]!
          for (const host of hosts) {
            const url = `http://${host}:${server.port}`
            try {
              const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(500),
              })
              await response.body?.cancel()
              server.url = url
              break
            } catch (error) {
              // Refused sockets, HTTPS-only services and timeouts are not HTTP previews.
              if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error
            }
          }
        }
      }),
    )
    return {
      supported: this.platform === 'linux' || this.platform === 'darwin',
      servers: targets.map(({ server }) => server),
    }
  }
  async stop(
    input: { taskId: string; pid: number; port: number; started: string },
    authorize: () => void,
  ) {
    // Drain a cached/in-flight read before forcing a new ownership/identity scan.
    if (this.pending) await this.pending
    const server = (await this.scan(true)).find(
      (server) =>
        server.taskId === input.taskId &&
        server.pid === input.pid &&
        server.port === input.port &&
        server.started === input.started,
    )
    if (!server || server.pid === process.pid)
      throw new HttpError(409, 'This server has stopped or changed. Refresh the list.')
    authorize()
    try {
      process.kill(server.pid, 'SIGTERM')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
    }
    // No process-group kill: a server may share its group with the agent or terminal.
    const deadline = Date.now() + 1500
    while (true) {
      this.cached = undefined
      await delay(150)
      if (this.pending) await this.pending
      const remains = (await this.scan(true)).some(
        (current) =>
          current.pid === server.pid &&
          current.started === server.started &&
          current.port === server.port,
      )
      if (!remains) return { ok: true }
      if (Date.now() >= deadline)
        throw new HttpError(
          409,
          'The server is still running after Stop. Stop it from its terminal or agent.',
        )
    }
  }
}
