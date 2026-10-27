import { readFile, readdir, readlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { exec } from '../process.js'
import { HttpError } from '../errors.js'
import type { ThreadServer } from '@dovo/protocol'

type Server = ThreadServer & { taskId: string }
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

export function linuxListeningSockets(text: string) {
  const sockets = new Map<string, number>()
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (fields[3] !== '0A' || !fields[9]) continue
    const port = Number.parseInt(fields[1]?.split(':')[1] ?? '', 16)
    if (port > 0 && port <= 65535) sockets.set(fields[9], port)
  }
  return sockets
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
          const ports = new Set<number>()
          for (const descriptor of descriptors) {
            let link: string
            try {
              link = await readlink(`/proc/${pid}/fd/${descriptor}`)
            } catch (error) {
              if (inaccessible(error)) continue
              throw error
            }
            const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1]
            const port = inode && sockets.get(inode)
            if (port) ports.add(port)
          }
          const name = (await optionalRead(`/proc/${pid}/comm`)).trim()
          // Verify the process did not change identity during filesystem reads.
          const current = await optionalRead(`/proc/${pid}/stat`)
          if (current.slice(current.lastIndexOf(')') + 2).split(' ')[19] !== started) continue
          for (const port of ports)
            servers.push({ pid: Number(pid), started, name, port, ...owner })
        }
      }),
    )
    return servers
  }
  private async mac() {
    let output: string
    try {
      output = (
        await exec('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], {
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
    const rows: Array<{ pid: number; name: string; port: number }> = []
    let pid = 0,
      name = ''
    for (const line of output.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1))
      else if (line[0] === 'c') name = line.slice(1)
      else if (line[0] === 'n') {
        const port = Number(/:(\d+)$/.exec(line)?.[1])
        if (pid > 0 && port > 0 && port <= 65535) rows.push({ pid, name: basename(name), port })
      }
    }
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
            ['-a', '-p', String(pid), '-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'],
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
      const ports = new Set(
        listeners
          .split('\n')
          .filter((line) => line[0] === 'n')
          .map((line) => Number(/:(\d+)$/.exec(line)?.[1])),
      )
      for (const row of rows.filter((row) => row.pid === pid && ports.has(row.port)))
        servers.push({ ...row, ...owner, started: identity })
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
        const unique = [
          ...new Map(servers.map((server) => [`${server.pid}:${server.port}`, server])).values(),
        ]
        this.cached = { at: Date.now(), servers: unique }
        return unique
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
  async list(taskId: string) {
    const servers: ThreadServer[] = (await this.scan())
      .filter((server) => server.taskId === taskId)
      .map(({ pid, port, started, name, source }) => ({ pid, port, started, name, source }))
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(4, servers.length) }, async () => {
        while (next < servers.length) {
          const server = servers[next++]!
          for (const host of ['127.0.0.1', '[::1]']) {
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
      servers,
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
