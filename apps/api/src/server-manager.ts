import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readConnection, type LocalConnection } from './connection.js'
import { discoverNetworks, networkUrls } from './network.js'
import { readServerConfig, writePrivateJson } from './server-config.js'
interface ManagedProcess {
  pid: number
  startedAt: string
}
export function managedProcessIsAlive(directory: string) {
  const managed = managedProcess(directory)
  return !!managed && processExists(managed.pid)
}
function managedProcess(directory: string): ManagedProcess | undefined {
  const path = join(directory, 'server-process.json')
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('pid' in value) ||
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid < 1 ||
    !('startedAt' in value) ||
    typeof value.startedAt !== 'string'
  )
    throw new Error(`Invalid managed process file: ${path}`)
  return {
    pid: value.pid,
    startedAt: value.startedAt,
  }
}
export function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}
async function accessible(connection: LocalConnection, timeout = 5000) {
  const response = await fetch(`${connection.address}/api/snapshot`, {
    headers: {
      Authorization: `Bearer ${connection.token}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok)
    throw new Error(
      `Runtime returned HTTP ${response.status}. Check the connection credentials and server log.`,
    )
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('owner' in value) || value.owner !== true)
    throw new Error('The saved connection does not have runtime owner access.')
}
export async function serverStatus(directory: string) {
  const config = readServerConfig(directory)
  const managed = managedProcess(directory)
  let connection: LocalConnection | undefined
  let error: string | undefined
  try {
    connection = readConnection(join(directory, 'runtime-connection.json'))
    await accessible(connection)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const running = !!connection && !error
  const addresses =
    running && connection
      ? networkUrls(
          connection.bindHost ?? new URL(connection.address).hostname,
          new URL(connection.address).port,
          await discoverNetworks(),
        )
      : []
  return {
    running,
    managed: running && managed?.pid === connection?.pid,
    pid: running ? connection?.pid : undefined,
    startedAt: running && managed?.pid === connection?.pid ? managed?.startedAt : undefined,
    address: running
      ? (config.publicAddress ?? addresses[0]?.address ?? connection?.address)
      : undefined,
    addresses,
    host: running ? (connection?.bindHost ?? config.host) : config.host,
    port: running && connection ? Number(new URL(connection.address).port || 80) : config.port,
    configuredHost: config.host,
    configuredPort: config.port,
    databasePath: config.databasePath,
    logPath: join(directory, 'server.log'),
    ...(error
      ? {
          error: existsSync(join(directory, 'runtime-connection.json'))
            ? error
            : 'Runtime is stopped. Run pnpm server start with the same --data-dir.',
        }
      : {}),
  }
}
export async function startServer(directory: string, entrypoint: string) {
  const config = readServerConfig(directory)
  const status = await serverStatus(directory)
  if (status.running) return status
  for (const record of [
    managedProcess(directory),
    existsSync(join(directory, 'runtime-connection.json'))
      ? readConnection(join(directory, 'runtime-connection.json'))
      : undefined,
  ]) {
    if (record && processExists(record.pid))
      throw new Error(
        `Runtime process ${record.pid} is still running but cannot be reached. Check ${status.logPath}; refusing to start a second process over this database.`,
      )
  }
  if (!existsSync(entrypoint))
    throw new Error(
      'Runtime build is missing. Run pnpm --filter @dovo/api... -r build, then pnpm server start.',
    )
  const log = openSync(status.logPath, 'a', 0o600)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOVO_DATABASE_PATH: config.databasePath,
    DOVO_HOST: config.host,
    PORT: String(config.port),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(process.execPath, [entrypoint], {
    detached: true,
    stdio: ['ignore', log, log],
    env,
  })
  closeSync(log)
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  const pid = child.pid
  if (!pid) throw new Error('Runtime did not create a process.')
  writePrivateJson(join(directory, 'server-process.json'), {
    pid,
    startedAt: new Date().toISOString(),
  })
  child.unref()
  const deadline = Date.now() + 30000
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const connection = readConnection(join(directory, 'runtime-connection.json'))
      if (connection.pid === pid) {
        await accessible(connection, 1000)
        return serverStatus(directory)
      }
    } catch {
      /* Startup has not published an authenticated connection yet. */
    }
    await delay(100)
  }
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    const stopped = Date.now() + 5000
    while (Date.now() < stopped && processExists(pid)) await delay(100)
  }
  throw new Error(
    `Runtime did not start. Read ${status.logPath}. Check that port ${config.port} is available and the selected network is connected.`,
  )
}
export async function stopServer(directory: string) {
  const status = await serverStatus(directory)
  const managed = managedProcess(directory)
  if (!managed || !processExists(managed.pid)) {
    if (status.running)
      throw new Error(
        'This runtime is owned by another launcher. Stop it there; server stop only stops a process started with server start.',
      )
    return {
      stopped: true,
      alreadyStopped: true,
    }
  }
  if (!status.running || !status.managed || status.pid !== managed.pid)
    throw new Error(
      `Cannot verify managed process ${managed.pid}. No signal was sent. Inspect ${status.logPath} and the running process before stopping it manually.`,
    )
  process.kill(managed.pid, 'SIGTERM')
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (!processExists(managed.pid)) {
      const path = join(directory, 'server-process.json')
      if (managedProcess(directory)?.pid === managed.pid) unlinkSync(path)
      return {
        stopped: true,
        alreadyStopped: false,
      }
    }
    await delay(100)
  }
  throw new Error(
    `Runtime ${managed.pid} is still shutting down. Check ${status.logPath}. It was not force-killed.`,
  )
}
