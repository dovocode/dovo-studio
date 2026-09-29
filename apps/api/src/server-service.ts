import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { persistRuntimeEnvironment } from './runtime-environment.js'
import { readServerConfig, setupServer, writePrivateJson } from './server-config.js'
import { processExists, serverStatus } from './server-manager.js'
import { selectedEntrypoint, updateServer } from './server-update.js'

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
  return `[Unit]\nDescription=Dovo server (${name})\nAfter=network-online.target\n[Service]\nType=simple\nWorkingDirectory=${systemd(directory)}\nExecStart=${args.map(systemd).join(' ')}\nEnvironment=DOVO_RUNTIME_ENV_FILE=${systemd(envPath)}\nRestart=on-failure\nRestartSec=3\n[Install]\nWantedBy=default.target\n`
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
async function run(command: string, args: string[], cwd?: string) {
  const child = spawn(command, args, { stdio: 'inherit', cwd })
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exit) => resolve(exit ?? 1))
  })
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${code}`)
}
async function output(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] })
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
  const child = spawn('launchctl', ['print', target], { stdio: 'ignore' })
  return new Promise<boolean>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code === 0))
  })
}
async function control(record: ServiceRecord, action: 'start' | 'stop' | 'restart' | 'remove') {
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
    if (action === 'remove') await run('systemctl', ['--user', 'disable', '--now', record.name])
    else if (action === 'start') await run('systemctl', ['--user', 'enable', '--now', record.name])
    else await run('systemctl', ['--user', action, record.name])
  }
}
async function waitForRuntime(directory: string, previousPid?: number) {
  const deadline = Date.now() + 30000
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
  await control(record, 'stop')
  if (!previous.pid) return
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (!processExists(previous.pid)) return
    await delay(100)
  }
  throw new Error(`Runtime ${previous.pid} is still shutting down after the service stopped.`)
}
export async function runService(directory: string) {
  const config = readServerConfig(directory)
  const child = spawn(process.execPath, [selectedEntrypoint(directory)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DOVO_DATABASE_PATH: config.databasePath,
      DOVO_HOST: config.host,
      PORT: String(config.port),
      DOVO_RUNTIME_ENV_FILE: join(directory, 'runtime-environment.json'),
      ELECTRON_RUN_AS_NODE: undefined,
    },
  })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal))
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}
export async function installService(
  directory: string,
  options: { host?: string; port?: string; database?: string; publicAddress?: string },
) {
  const platform = supportedPlatform()
  if (existsSync(recordPath(directory)))
    throw new Error('A server service is already registered. Use server service restart or update.')
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
    await control(record, 'start')
    return await waitForRuntime(directory)
  } catch (error) {
    throw new Error(
      `Service registration was written but startup failed. Check ${path} and ${join(directory, 'service.log')}. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
export async function serviceStatus(directory: string) {
  const record = readService(directory)
  return { service: record, ...(await serverStatus(directory)) }
}
export async function restartService(directory: string) {
  const record = readService(directory)
  const previous = await serverStatus(directory)
  await control(record, 'restart')
  return waitForRuntime(directory, previous.pid)
}
export async function removeService(directory: string) {
  const record = readService(directory)
  await stopServiceRuntime(directory, record)
  if (record.platform === 'linux') await control(record, 'remove')
  rmSync(record.path, { force: true })
  rmSync(recordPath(directory), { force: true })
  rmSync(join(directory, 'service-launcher'), { force: true })
  if (record.platform === 'linux') await run('systemctl', ['--user', 'daemon-reload'])
  return { removed: true, directory }
}
export async function updateService(directory: string, nextLauncher?: string) {
  const record = readService(directory)
  if (nextLauncher) {
    if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive')
      throw new Error('--launcher is for packaged server installations.')
    const replacement = resolve(nextLauncher)
    if (!existsSync(replacement) || basename(replacement) !== basename(record.launcher))
      throw new Error('The replacement launcher must exist and match the current server channel.')
    await run(replacement, ['--help'])
    const status = await serverStatus(directory)
    if (status.running) await stopServiceRuntime(directory, record)
    const link = join(directory, 'service-launcher')
    const temporary = `${link}.${process.pid}.tmp`
    symlinkSync(replacement, temporary)
    renameSync(temporary, link)
    writePrivateJson(recordPath(directory), { ...record, launcher: replacement })
    try {
      await control(record, 'start')
      return await waitForRuntime(directory, status.pid)
    } catch (error) {
      await stopServiceRuntime(directory, record)
      symlinkSync(record.launcher, temporary)
      renameSync(temporary, link)
      writePrivateJson(recordPath(directory), record)
      if (status.running) await control(record, 'start').catch(() => undefined)
      throw error
    }
  }
  if (process.env.DOVO_SERVER_DISTRIBUTION !== 'archive') {
    const previous = await serverStatus(directory)
    return updateServer(directory, {
      stop: () => stopServiceRuntime(directory, record),
      start: async () => {
        await control(record, 'start')
        await waitForRuntime(directory, previous.pid)
      },
    })
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
  const status = await serverStatus(directory)
  // Download and switch the formula while the old process is still serving clients.
  await run('brew', ['upgrade', formula])
  if (status.running) await stopServiceRuntime(directory, record)
  try {
    await control(record, 'start')
    return waitForRuntime(directory, status.pid)
  } catch (error) {
    if (status.running) await control(record, 'start').catch(() => undefined)
    throw error
  }
}
