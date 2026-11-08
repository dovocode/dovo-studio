import { rotateRuntimeLogs, stopOwnedChild } from '@dovo/runtime'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readConnection, type LocalConnection } from './connection.js'
import { discoverNetworks, networkUrls } from './network.js'
import { readServerConfig, writePrivateJson } from './server-config.js'
// Cold databases may need to rebuild derived search indexes before publishing a connection.
export const runtimeStartupTimeoutMs = 5 * 60_000
export class ServerShutdownUnconfirmedError extends Error {}
// An admitted launch waits here, before the runtime loads, until its owner has recorded the PID.
// If the owner dies first, stdin closes and the process exits without opening the database.
// Inherited execArgv stays inert in descendants because the gate removes its variable.
const launchGate = `data:text/javascript,${encodeURIComponent(
  "if(process.env.DOVO_LAUNCH_GATE==='1'){delete process.env.DOVO_LAUNCH_GATE;let admission='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)admission+=chunk;if(admission!=='admitted'){console.error('Runtime launch was not admitted by its owner; exiting before opening the database.');process.exit(75)}}",
)}`
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
  const response = await fetch(`${connection.address}/api/snapshot?scope=overview`, {
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
/** `admit` must durably record the PID; only then may the launched runtime open the database. */
export async function startServer(
  directory: string,
  entrypoint: string,
  admit?: (pid: number) => void,
) {
  const config = readServerConfig(directory)
  const status = await serverStatus(directory)
  // An admitted launch verifies its own process; a runtime that is already running is not it.
  if (status.running && admit)
    throw new Error(
      `Runtime process ${status.pid ?? 'unknown'} is already running for this data directory; the new release was not started.`,
    )
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
  await rotateRuntimeLogs(directory)
  const log = openSync(status.logPath, 'a', 0o600)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOVO_DATABASE_PATH: config.databasePath,
    DOVO_HOST: config.host,
    PORT: String(config.port),
  }
  delete env.ELECTRON_RUN_AS_NODE
  // A standalone server binds to its saved configuration even when launched from Dovo.
  delete env.DOVO_DESKTOP_DUAL_LISTENER
  const child = spawn(
    process.execPath,
    admit ? ['--import', launchGate, entrypoint] : [entrypoint],
    {
      windowsHide: true,
      detached: true,
      stdio: [admit ? 'pipe' : 'ignore', log, log],
      env: admit ? { ...env, DOVO_LAUNCH_GATE: '1' } : env,
    },
  )
  // A launch that exits before admission is observed below; its closed pipe is not an error.
  child.stdin?.on('error', () => {})
  try {
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
    if (admit) {
      admit(pid)
      child.stdin?.end('admitted')
    }
    const deadline = Date.now() + runtimeStartupTimeoutMs
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const connection = readConnection(join(directory, 'runtime-connection.json'))
        if (connection.pid === pid) {
          // A large workspace on a cold database can take more than a second to answer.
          await accessible(connection, 5000)
          const ready = await serverStatus(directory)
          if (ready.running && ready.pid === pid && ready.managed) {
            child.unref()
            return ready
          }
        }
      } catch {
        /* Startup has not published an authenticated connection yet. */
      }
      await delay(100)
    }
    throw new Error(
      `Runtime did not start. Read ${status.logPath}. Check that port ${config.port} is available and the selected network is connected.`,
    )
  } catch (error) {
    child.stdin?.destroy()
    // The spawned child remains ours even if publishing its PID fails. Do not
    // let an updater restore the database beneath an untracked candidate.
    try {
      await stopOwnedChild(child)
    } catch (cause) {
      throw new ServerShutdownUnconfirmedError(
        `Runtime startup failed and shutdown was not confirmed. Inspect process ${child.pid ?? 'unknown'} and ${status.logPath} before recovery.`,
        { cause: new AggregateError([error, cause], 'Startup and shutdown failed') },
      )
    }
    throw error
  }
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
