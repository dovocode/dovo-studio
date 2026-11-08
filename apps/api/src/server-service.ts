import { acquireProcessLock } from './process-lock.js'
import { githubReleaseToken } from '@dovo/protocol/github-release-auth'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { persistRuntimeEnvironment, readRuntimeEnvironment } from './runtime-environment.js'
import { readServerConfig, setupServer, writePrivateJson } from './server-config.js'
import { processExists, serverStatus, runtimeStartupTimeoutMs } from './server-manager.js'
import { selectedEntrypoint, updateServer } from './server-update.js'
import {
  activatePackagedRelease,
  packagedServiceWarning,
  prepareLaunch,
  recoverServerUpdate,
  settleLaunch,
  verifyPendingLaunch,
  type ServiceControls,
} from './server-update-recovery.js'
import {
  CHILD_OOM_SCORE_ENV,
  disableProtection,
  enableProtection,
  inspectProtection,
  protectionPlan,
  protectionStatus,
  releaseChildOomProtection,
  systemProtectionHost,
  type ProtectionHost,
} from './server-service-protection.js'

type ServicePlatform = 'darwin' | 'linux'
type ServiceRecord = { platform: ServicePlatform; name: string; path: string; launcher: string }
const recordPath = (directory: string) => join(directory, 'server-service.json')
const supportedPlatform = (): ServicePlatform => {
  if (process.platform !== 'darwin' && process.platform !== 'linux')
    throw new Error('Server service registration currently supports macOS and Linux.')
  return process.platform
}
const serviceName = (directory: string) =>
  `dovo-server-${createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 12)}`
const servicePath = (platform: ServicePlatform, name: string) =>
  platform === 'darwin'
    ? join(homedir(), 'Library', 'LaunchAgents', `com.dovo.${name}.plist`)
    : join(homedir(), '.config', 'systemd', 'user', `${name}.service`)
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const systemd = (value: string) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$')}"`
export function serviceDefinition(
  platform: ServicePlatform,
  name: string,
  directory: string,
  args: string[],
  envPath: string,
) {
  if (platform === 'darwin') {
    const items = args.map((part) => `<string>${xml(part)}</string>`).join('')
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.dovo.${name}</string><key>ProgramArguments</key><array>${items}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>EnvironmentVariables</key><dict><key>DOVO_RUNTIME_ENV_FILE</key><string>${xml(envPath)}</string></dict><key>StandardOutPath</key><string>${xml(join(directory, 'service.log'))}</string><key>StandardErrorPath</key><string>${xml(join(directory, 'service.log'))}</string></dict></plist>\n`
  }
  return `[Unit]\nDescription=Dovo server (${name})\nAfter=network-online.target\n[Service]\nType=simple\nWorkingDirectory=${directory.replaceAll('%', '%%')}\nExecStart=${args.map(systemd).join(' ')}\nEnvironment=DOVO_RUNTIME_ENV_FILE=${systemd(envPath)}\nRestart=on-failure\nRestartSec=3\n[Install]\nWantedBy=default.target\n`
}
export function repairServiceDefinition(definition: string, directory: string) {
  return definition.replace(
    `WorkingDirectory=${systemd(directory)}\n`,
    `WorkingDirectory=${directory.replaceAll('%', '%%')}\n`,
  )
}
function readService(directory: string): ServiceRecord {
  const path = recordPath(directory)
  if (!existsSync(path))
    throw new Error('No server service is registered. Run server service install first.')
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('platform' in value) ||
    !('name' in value) ||
    !('path' in value) ||
    !('launcher' in value) ||
    (value.platform !== 'darwin' && value.platform !== 'linux') ||
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.launcher !== 'string' ||
    value.name !== serviceName(directory) ||
    value.path !== servicePath(value.platform, value.name)
  )
    throw new Error(`Invalid server service record: ${path}`)
  return value as ServiceRecord
}
async function run(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    cwd,
    ...(env ? { env } : {}),
    ...(command === 'launchctl'
      ? { timeout: args[0] === 'bootout' ? 40000 : 10000, killSignal: 'SIGKILL' as const }
      : {}),
  })
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exit) => resolve(exit ?? 1))
  })
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${code}`)
}
async function output(command: string, args: string[]) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    ...(command === 'launchctl' ? { timeout: 10000, killSignal: 'SIGKILL' as const } : {}),
  })
  let text = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    text += chunk
  })
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exit) => resolve(exit ?? 1))
  })
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${code}`)
  return text.trim()
}
async function launchdLoaded(target: string) {
  const child = spawn('launchctl', ['print', target], {
    stdio: 'ignore',
    timeout: 10000,
    killSignal: 'SIGKILL',
  })
  return new Promise<boolean>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`launchctl print ${target} terminated by ${signal}`))
      else resolve(code === 0)
    })
  })
}
async function control(
  record: ServiceRecord,
  action: 'start' | 'stop' | 'restart' | 'remove',
  directory: string,
) {
  if (record.platform === 'darwin') {
    const target = `gui/${process.getuid?.() ?? 0}/com.dovo.${record.name}`
    const loaded = await launchdLoaded(target)
    if (action === 'stop' || action === 'remove') {
      if (loaded) await run('launchctl', ['bootout', target])
    } else if (action === 'restart' && loaded) await run('launchctl', ['kickstart', '-k', target])
    else if (!loaded) {
      await run('launchctl', ['bootstrap', `gui/${process.getuid?.() ?? 0}`, record.path])
      await run('launchctl', ['kickstart', '-k', target])
    }
  } else {
    if (action === 'start' || action === 'restart') {
      const definition = readFileSync(record.path, 'utf8')
      const repaired = repairServiceDefinition(definition, directory)
      if (repaired !== definition) writeFileSync(record.path, repaired, { mode: 0o600 })
      await run('systemctl', ['--user', 'daemon-reload'])
    }
    if (action === 'remove') await run('systemctl', ['--user', 'disable', '--now', record.name])
    else if (action === 'start') await run('systemctl', ['--user', 'enable', '--now', record.name])
    else await run('systemctl', ['--user', action, record.name])
  }
}
export async function waitForRuntime(directory: string, previousPid?: number) {
  const deadline = Date.now() + runtimeStartupTimeoutMs
  let lastError = 'no authenticated runtime connection yet'
  while (Date.now() < deadline) {
    const status = await serverStatus(directory)
    if (status.running && status.pid !== previousPid) return status
    lastError = status.running
      ? `runtime process ${status.pid} has not changed from ${previousPid}`
      : (status.error ?? lastError)
    await delay(250)
  }
  throw new Error(
    `The service did not start a reachable runtime: ${lastError}. Check the service log and server status.`,
  )
}
async function stopServiceRuntime(directory: string, record: ServiceRecord) {
  const previous = await serverStatus(directory)
  await control(record, 'stop', directory)
  if (!previous.pid) {
    const release = acquireProcessLock(
      join(dirname(readServerConfig(directory).databasePath), 'runtime-process.lock'),
    )
    release()
    return
  }
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (!processExists(previous.pid)) {
      const release = acquireProcessLock(
        join(dirname(readServerConfig(directory).databasePath), 'runtime-process.lock'),
      )
      release()
      return
    }
    await delay(100)
  }
  throw new Error(`Runtime ${previous.pid} is still shutting down after the service stopped.`)
}
/** Source-update controls; start waits for a runtime other than `previousPid`. */
function sourceUpdateControls(
  directory: string,
  record: ServiceRecord,
  previousPid?: number,
): ServiceControls {
  return {
    stop: () => stopServiceRuntime(directory, record),
    start: async () => {
      await control(record, 'start', directory)
      await waitForRuntime(directory, previousPid)
    },
  }
}
/**
 * Commit the launched candidate once it serves its owner API. Exiting first decides rollback,
 * unless the service manager stopped it; the next launch then verifies it again.
 */
async function verifyLaunch(
  directory: string,
  child: ChildProcess,
  stopped: () => boolean,
  finished: () => boolean,
) {
  while (!finished()) {
    const status = await serverStatus(directory).catch(() => undefined)
    if (status?.running && status.pid === child.pid) {
      try {
        await verifyPendingLaunch(directory)
        for (const warning of settleLaunch(directory, true)) console.error(warning)
      } catch (error) {
        console.error('Service release verification failed', error)
        if (!stopped()) settleLaunch(directory, false)
        child.kill('SIGTERM')
      }
      return
    }
    await delay(250)
  }
  if (!stopped()) settleLaunch(directory, false)
}
export async function runService(directory: string) {
  const config = readServerConfig(directory)
  const environmentPath = join(directory, 'runtime-environment.json')
  const packaged =
    process.env.DOVO_SERVER_DISTRIBUTION === 'archive' && !!process.env.DOVO_SERVER_LAUNCHER
  // The service manager can launch at boot without a server command, after an interrupted update.
  const verify = await prepareLaunch(directory)
  const selectedLauncher = packaged ? realpathSync(join(directory, 'service-launcher')) : undefined
  // A rollback can select another package. Its own launcher chooses its bundled Node and runtime.
  const redirect =
    selectedLauncher &&
    realpathSync(selectedEntrypoint(directory)) !==
      realpathSync(join(dirname(selectedLauncher), '..', 'libexec', 'server', 'dist', 'index.js'))
  const child = spawn(
    redirect ? selectedLauncher : process.execPath,
    redirect ? ['service', 'run', '--data-dir', directory] : [selectedEntrypoint(directory)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...readRuntimeEnvironment(environmentPath),
        DOVO_DATABASE_PATH: config.databasePath,
        DOVO_HOST: config.host,
        PORT: String(config.port),
        DOVO_RUNTIME_ENV_FILE: environmentPath,
        ELECTRON_RUN_AS_NODE: undefined,
        ...(selectedLauncher ? { DOVO_SERVER_LAUNCHER: selectedLauncher } : {}),
        // A redirected launcher is itself a supervisor and releases its runtime's children.
        ...(redirect ? {} : { [CHILD_OOM_SCORE_ENV]: undefined }),
      },
    },
  )
  // Set only by the opt-in protection drop-in. A redirected launcher does this itself.
  const childScore = Number(process.env[CHILD_OOM_SCORE_ENV])
  const stopReleasing =
    !redirect && process.env[CHILD_OOM_SCORE_ENV] && Number.isInteger(childScore)
      ? releaseChildOomProtection(childScore, () =>
          [process.pid, process.ppid, child.pid].filter((pid) => pid !== undefined),
        )
      : undefined
  let stopping = false
  const terminate = () => {
    stopping = true
    child.kill('SIGTERM')
  }
  const interrupt = () => {
    stopping = true
    child.kill('SIGINT')
  }
  process.on('SIGTERM', terminate)
  process.on('SIGINT', interrupt)
  let finished = false
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      finished = true
      reject(error)
    })
    child.once('exit', (code) => {
      finished = true
      resolve(code ?? 1)
    })
  })
  const verified =
    verify && !redirect
      ? verifyLaunch(
          directory,
          child,
          () => stopping,
          () => finished,
        )
      : undefined
  try {
    process.exitCode = await exited
  } finally {
    stopReleasing?.()
    process.removeListener('SIGTERM', terminate)
    process.removeListener('SIGINT', interrupt)
    await verified
  }
}
export async function installService(
  directory: string,
  options: { host?: string; port?: string; database?: string; publicAddress?: string },
) {
  const platform = supportedPlatform()
  if (existsSync(recordPath(directory)))
    throw new Error('A server service is already registered. Use server service restart or update.')
  // The service will launch the selected release, so an interrupted update must finish first.
  if (existsSync(join(directory, 'server.json'))) await recoverServerUpdate(directory)
  if (existsSync(join(directory, 'server.json')) && (await serverStatus(directory)).running)
    throw new Error(
      'A runtime is already running for this data directory. Stop it before registering a service.',
    )
  if (!existsSync(join(directory, 'server.json'))) setupServer(directory, options)
  else if (options.host || options.port || options.database || options.publicAddress)
    setupServer(directory, options)
  if ((await serverStatus(directory)).running)
    throw new Error(
      'A runtime is already running for this data directory. Stop it before registering a service.',
    )
  if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive')
    await run(
      'pnpm',
      ['--filter', '@dovo/api...', '-r', 'build'],
      resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
    )
  if (!existsSync(selectedEntrypoint(directory)))
    throw new Error(
      'Build the server first with pnpm --filter @dovo/api... -r build, then retry service install.',
    )
  const name = serviceName(directory)
  const path = servicePath(platform, name)
  const builtCli = fileURLToPath(
    new URL(
      import.meta.url.endsWith('.ts') ? '../dist/server-cli.js' : './server-cli.js',
      import.meta.url,
    ),
  )
  const launcher = process.env.DOVO_SERVER_LAUNCHER
    ? resolve(process.env.DOVO_SERVER_LAUNCHER)
    : `${process.execPath} ${builtCli}`
  const record: ServiceRecord = { platform, name, path, launcher }
  const command = process.env.DOVO_SERVER_LAUNCHER
    ? [join(directory, 'service-launcher')]
    : [process.execPath, builtCli]
  const args = [...command, 'service', 'run', '--data-dir', directory]
  const envPath = persistRuntimeEnvironment(directory, process.env)
  if (process.env.DOVO_SERVER_LAUNCHER) symlinkSync(launcher, join(directory, 'service-launcher'))
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, serviceDefinition(platform, name, directory, args, envPath), { mode: 0o600 })
  if (platform === 'linux') await run('systemctl', ['--user', 'daemon-reload'])
  writePrivateJson(recordPath(directory), record)
  try {
    await control(record, 'start', directory)
    return await waitForRuntime(directory)
  } catch (error) {
    throw new Error(
      `Service registration was written but startup failed. Check ${path} and ${join(directory, 'service.log')}. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
export async function serviceStatus(directory: string) {
  const record = readService(directory)
  const warning = packagedServiceWarning(directory)
  return { service: record, ...(await serverStatus(directory)), warnings: warning ? [warning] : [] }
}
/** Linux memory-pressure settings. Only `enable` and `disable` change anything. */
export async function serviceProtection(
  directory: string,
  action: 'preview' | 'status' | 'enable' | 'disable',
  options: { memoryLow?: string } = {},
  host: ProtectionHost = systemProtectionHost(),
) {
  const record = readService(directory)
  if (record.platform !== 'linux')
    throw new Error('Service protection uses systemd and is available for Linux services only.')
  if (action === 'enable') return enableProtection(record, host, options)
  if (action === 'disable') return disableProtection(record, host)
  if (action === 'status') return protectionStatus(record, host)
  return {
    preview: true as const,
    ...protectionPlan(await inspectProtection(record, host), options),
  }
}
export async function restartService(directory: string) {
  const record = readService(directory)
  // An interrupted update decides which release and database the service may start.
  await recoverServerUpdate(
    directory,
    sourceUpdateControls(directory, record, (await serverStatus(directory)).pid),
  )
  const previous = await serverStatus(directory)
  await control(record, 'restart', directory)
  return waitForRuntime(directory, previous.pid)
}
export async function removeService(directory: string) {
  const record = readService(directory)
  // Only this service's controls can finish an update it was running.
  await recoverServerUpdate(
    directory,
    sourceUpdateControls(directory, record, (await serverStatus(directory)).pid),
  )
  await stopServiceRuntime(directory, record)
  if (record.platform === 'linux') await control(record, 'remove', directory)
  // Only Dovo's own protection drop-in goes with the unit; anything else stays.
  if (record.platform === 'linux')
    await disableProtection(record, systemProtectionHost()).catch((error: unknown) =>
      console.error(error instanceof Error ? error.message : String(error)),
    )
  rmSync(record.path, { force: true })
  rmSync(recordPath(directory), { force: true })
  rmSync(join(directory, 'service-launcher'), { force: true })
  if (record.platform === 'linux') await run('systemctl', ['--user', 'daemon-reload'])
  return { removed: true, directory }
}
export async function updateService(
  directory: string,
  nextLauncher?: string,
  expectedVersion?: string,
) {
  await recoverServerUpdate(
    directory,
    sourceUpdateControls(directory, readService(directory), (await serverStatus(directory)).pid),
  )
  const record = readService(directory)
  const activateLauncher = async (
    replacement: string,
    previousLauncher = realpathSync(join(directory, 'service-launcher')),
    prepare?: () => Promise<void>,
  ) => {
    const status = await serverStatus(directory)
    const result = await activatePackagedRelease(directory, {
      replacement,
      previous: previousLauncher,
      candidateRecord: JSON.stringify({ ...record, launcher: replacement }, null, 2) + '\n',
      databasePath: status.databasePath,
      running: status.running,
      service: sourceUpdateControls(directory, record, status.pid),
      prepare,
      expectedVersion,
    })
    if (result.status === 'pending') throw result.cause
    for (const warning of result.warnings) console.error(warning)
    if (result.status !== 'active')
      throw new Error(
        `Release activation failed: ${result.error instanceof Error ? result.error.message : String(result.error)}. Previous release and database were restored.${result.status === 'rolled-back' && result.preserved ? ` The replaced database is kept at ${result.preserved}.` : ''}`,
        { cause: result.error },
      )
    return serverStatus(directory)
  }
  if (nextLauncher) {
    if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive')
      throw new Error('--launcher is for packaged server installations.')
    const replacement = resolve(nextLauncher)
    if (!existsSync(replacement) || basename(replacement) !== basename(record.launcher))
      throw new Error('The replacement launcher must exist and match the current server channel.')
    await run(replacement, ['--help'])
    return activateLauncher(replacement)
  }
  if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive') {
    const previous = await serverStatus(directory)
    return updateServer(directory, sourceUpdateControls(directory, record, previous.pid))
  }
  const formula = basename(record.launcher).includes('nightly')
    ? 'dovo-server-nightly'
    : 'dovo-server'
  if (record.platform !== 'darwin')
    throw new Error(
      'Automatic package updates require Homebrew on macOS. For mise or archive installs, install the new package and run server service update --launcher /path/to/new/bin/dovo-server.',
    )
  const brewPrefix = await output('brew', ['--prefix'])
  if (record.launcher !== join(brewPrefix, 'bin', formula))
    throw new Error(
      'This service is not using the Homebrew launcher. Install the new package with its manager, then run server service update --launcher /path/to/new/bin/dovo-server.',
    )
  await run('brew', ['list', '--formula', formula])
  // Preserve the resolved old Cellar launcher; the public brew symlink changes on upgrade.
  const previousLauncher = realpathSync(join(directory, 'service-launcher'))
  const githubToken = process.env.HOMEBREW_GITHUB_API_TOKEN || (await githubReleaseToken())
  return activateLauncher(record.launcher, previousLauncher, () =>
    run('brew', ['upgrade', formula], undefined, {
      ...process.env,
      HOMEBREW_NO_INSTALL_CLEANUP: '1',
      ...(githubToken ? { HOMEBREW_GITHUB_API_TOKEN: githubToken } : {}),
    }),
  )
}
