import {
  RuntimeBackups,
  restoreRuntimeBackup,
  exportRuntimeRecovery,
  startStudioMcp,
} from '@dovo/runtime'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readServerConfig, serverDirectory, setupServer } from './server-config.js'
import { serverStatus, startServer, stopServer } from './server-manager.js'
import { acquireProcessLock } from './process-lock.js'
import { existsSync, mkdirSync } from 'node:fs'
import { selectedEntrypoint, sourceEntrypoint, updateServer } from './server-update.js'
import { recoverServerUpdate, packagedServiceWarning } from './server-update-recovery.js'
import { serverDoctor } from './server-doctor.js'
import { protectionReportText } from './server-service-protection.js'
import { runRemoteServerUpdate } from './server-remote-update.js'
import {
  installService,
  removeService,
  restartService,
  runService,
  serviceProtection,
  serviceStatus,
  updateService,
} from './server-service.js'

async function forwardNode(args: string[]) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      database: { type: 'string' },
      backup: { type: 'string' },
      output: { type: 'string' },
      'public-address': { type: 'string' },
      launcher: { type: 'string' },
      'memory-low': { type: 'string' },
      version: { type: 'string' },
      network: { type: 'string' },
      manual: { type: 'boolean' },
      'check-updates': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const packaged = process.env.DOVO_SERVER_DISTRIBUTION === 'archive'
  const cliName = packaged ? 'dovo-server' : 'pnpm server'
  const [command = 'status', ...args] = positionals
  if (command === 'update' && packaged && !values.help)
    throw new Error(
      'This server is managed by Homebrew, mise or an archive install. Finish active work, stop the server, upgrade with your package manager, then run dovo-server start. Your data directory is preserved.',
    )
  if (values.help) {
    console.log(`Usage: ${cliName} <setup | start | status | stop | restart | pair | connect | studio-tools | doctor | backup | backups | restore | recovery-export | update | service install|status|restart|update|remove | service protect preview|status|enable|disable> [options]
  --data-dir <directory>    Workspace data directory (default: ~/.dovo)
  --host <host>             Setup: 0.0.0.0, an IP, local, tailscale, or netbird
  --port <number>           Setup: fixed port (default: 51464)
  --database <path>         Setup: database in the selected data directory
  --public-address <url>    Setup/pair: reachable LAN/VPN or HTTPS proxy origin
  --launcher <path>         Service update: new mise/archive bin/dovo-server path
  --memory-low <size>       Service protect enable/preview: optional systemd MemoryLow, e.g. 512M
  --backup <path>          Restore: verified SQLite backup (runtime must be stopped)
  --output <directory>     Recovery export: new private output directory
  --json                   Print status/configuration as JSON, never owner tokens
  --check-updates           Doctor: compare installed adapters with npm registry versions

Setup preserves the existing database and saved listening address. Start runs in the
background, independently of the terminal or desktop app. Logs: <data-dir>/server.log.
Plain start does not install an OS service or restart after reboot. See docs/server-setup.md.
Service install creates a user-level launchd (macOS) or systemd (Linux) service and starts it.
Service protect (Linux, opt-in) writes one reversible systemd user drop-in so an agent's OOM kill
leaves the runtime running. Preview and status change nothing; disable removes only Dovo's drop-in.
Connect on|off|status manages account-authorized internet access (browser sign-in, no device pairing).
Pair accepts code/devices/relay-key/approve/deny and --network/--manual, like pnpm pair.
${
  packaged
    ? 'Update with Homebrew or mise after stopping the server, then start again. Data is preserved.'
    : `Update stages this checkout's locked source, installs/builds/tests it, then restarts.
Failed builds keep the current server running. No Git pull or dependency upgrade is performed.
Build first: pnpm --filter @dovo/api... -r build`
}`)
    return
  }
  if (
    ![
      'setup',
      'start',
      'status',
      'stop',
      'restart',
      'pair',
      'connect',
      'studio-tools',
      'doctor',
      'backup',
      'backups',
      'restore',
      'recovery-export',
      'update',
      'service',
      'remote-update',
    ].includes(command) ||
    (command !== 'pair' && command !== 'connect' && command !== 'service' && args.length) ||
    (command === 'service' &&
      (args[0] === 'protect'
        ? args.length !== 2 || !['preview', 'status', 'enable', 'disable'].includes(args[1])
        : args.length !== 1 ||
          !['install', 'status', 'restart', 'update', 'remove', 'run'].includes(args[0])))
  )
    throw new Error(`Invalid command. Run ${cliName} --help.`)
  if (command === 'studio-tools') {
    await startStudioMcp()
    return
  }
  if (
    command !== 'setup' &&
    !(command === 'service' && args[0] === 'install') &&
    (values.host || values.port || values.database)
  )
    throw new Error(
      '--host, --port and --database are setup options. Run setup, then restart to apply changes.',
    )
  if (command !== 'doctor' && values['check-updates'])
    throw new Error('--check-updates is a doctor option.')
  if (
    !['setup', 'pair'].includes(command) &&
    !(command === 'service' && args[0] === 'install') &&
    values['public-address']
  )
    throw new Error('--public-address is a setup or pair option.')
  if (command !== 'pair' && (values.network || values.manual))
    throw new Error('--network and --manual are pair options.')
  if (!(command === 'service' && args[0] === 'update') && values.launcher)
    throw new Error('--launcher is a service update option.')
  if (
    !(command === 'service' && args[0] === 'protect' && ['enable', 'preview'].includes(args[1])) &&
    values['memory-low']
  )
    throw new Error('--memory-low is a service protect enable or preview option.')
  if (command === 'service' && args[0] === 'protect') {
    const action = args[1] as 'preview' | 'status' | 'enable' | 'disable'
    const directory = serverDirectory(values['data-dir'])
    // Only a registered service has a directory to lock; otherwise report that it is missing.
    const release =
      (action === 'enable' || action === 'disable') && existsSync(directory)
        ? acquireProcessLock(join(directory, 'server-operation.lock'))
        : () => {}
    let report: Awaited<ReturnType<typeof serviceProtection>>
    try {
      report = await serviceProtection(directory, action, {
        memoryLow: values['memory-low'],
      })
    } finally {
      release()
    }
    if (values.json) console.log(JSON.stringify(report))
    else console.log(protectionReportText(report))
    return
  }
  if (command !== 'remote-update' && values.version)
    throw new Error('--version is a remote update option.')
  if ((values.backup && command !== 'restore') || (values.output && command !== 'recovery-export'))
    throw new Error('--backup is a restore option; --output is a recovery-export option.')
  if (command === 'restore' && !values.backup)
    throw new Error('Restore requires --backup <path>. Stop the runtime and its service first.')
  if (command === 'recovery-export' && !values.output)
    throw new Error('Recovery export requires --output <new-directory>.')
  const directory = serverDirectory(values['data-dir'])
  if (command === 'service' && args[0] === 'run') {
    await runService(directory)
    return
  }
  if (command === 'doctor') {
    const selected = selectedEntrypoint(directory)
    if (resolve(selected) !== resolve(sourceEntrypoint())) {
      const doctorArgs = [
        join(dirname(selected), 'server-cli.js'),
        'doctor',
        '--data-dir',
        directory,
      ]
      if (values['check-updates']) doctorArgs.push('--check-updates')
      if (values.json) doctorArgs.push('--json')
      await forwardNode(doctorArgs)
      return
    }
    const report = await serverDoctor(directory, values['check-updates'])
    if (values.json) console.log(JSON.stringify(report))
    else
      console.log(
        `Dovo ${report.version} · Node ${report.nodeVersion} · ${report.platform}\nRuntime: ${report.runtime.running ? 'running' : 'offline'}${report.runtime.address ? ` at ${report.runtime.address}` : ''}\n${report.warnings.map((warning) => `Note: ${warning}\n`).join('')}\n${report.adapters.map((adapter) => `${adapter.name}: ${adapter.installedVersion ?? 'not detected'}${adapter.latestVersion ? ` (latest ${adapter.latestVersion})` : ''} — ${adapter.updateStatus}\n  ${adapter.detail}\n  ${adapter.guidance}`).join('\n\n')}`,
      )
    if (!report.runtime.running) process.exitCode = 1
    return
  }
  if (command === 'pair' || command === 'connect') {
    const config = readServerConfig(directory)
    const pairArgs = [
      ...(command === 'connect' ? ['internet', ...args] : args),
      '--connection',
      join(directory, 'runtime-connection.json'),
    ]
    const address = values['public-address'] ?? config.publicAddress
    if (address) pairArgs.push('--public-address', address)
    if (values.network) pairArgs.push('--network', values.network)
    if (values.manual) pairArgs.push('--manual')
    if (values.json) pairArgs.push('--json')
    const cli = fileURLToPath(
      new URL(import.meta.url.endsWith('.ts') ? './cli.ts' : './cli.js', import.meta.url),
    )
    await forwardNode([...process.execArgv, cli, ...pairArgs])
    return
  }
  let result: unknown
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const release =
    command === 'status' ? () => {} : acquireProcessLock(join(directory, 'server-operation.lock'))
  try {
    if (['backup', 'backups', 'restore', 'recovery-export'].includes(command)) {
      const config = readServerConfig(directory)
      const backups = new RuntimeBackups(config.databasePath)
      if (command === 'backup') result = await backups.create()
      else if (command === 'backups') result = await backups.status()
      else if (command === 'restore')
        result = await restoreRuntimeBackup(config.databasePath, resolve(values.backup!))
      else result = await exportRuntimeRecovery(config.databasePath, resolve(values.output!))
    } else if (command === 'setup')
      result = setupServer(directory, {
        host: values.host,
        port: values.port,
        database: values.database,
        publicAddress: values['public-address'],
      })
    else if (command === 'remote-update')
      result = await runRemoteServerUpdate(directory, values.version ?? '')
    else if (command === 'stop') result = await stopServer(directory)
    else if (command === 'status') {
      const status = await serverStatus(directory)
      result = status
      if (!status.running) process.exitCode = 1
    } else if (command === 'update') result = await updateServer(directory)
    else if (command === 'service') {
      if (args[0] === 'install')
        result = await installService(directory, {
          host: values.host,
          port: values.port,
          database: values.database,
          publicAddress: values['public-address'],
        })
      else if (args[0] === 'status') result = await serviceStatus(directory)
      else if (args[0] === 'restart') result = await restartService(directory)
      else if (args[0] === 'update') result = await updateService(directory, values.launcher)
      else result = await removeService(directory)
    } else {
      if (command === 'restart') await stopServer(directory)
      // An interrupted update decides which release and database may start.
      const recovered = await recoverServerUpdate(directory)
      result = {
        ...(await startServer(directory, selectedEntrypoint(directory))),
        ...(recovered ? { recovered } : {}),
      }
      if (recovered && !values.json)
        console.log(
          `Interrupted update ${recovered.id} was ${recovered.outcome === 'completed' ? 'completed' : recovered.outcome === 'abandoned' ? 'abandoned before activation' : 'rolled back'}.${'error' in recovered && typeof recovered.error === 'string' && recovered.error ? ` The resumed release failed: ${recovered.error}` : ''}${'preserved' in recovered && typeof recovered.preserved === 'string' && recovered.preserved ? ` The replaced database is kept at ${recovered.preserved}.` : ''}${recovered.warnings.map((warning) => `\n${warning}`).join('')}`,
        )
    }
  } finally {
    release()
  }
  if (values.json || ['backup', 'backups', 'restore', 'recovery-export'].includes(command))
    console.log(JSON.stringify(result, null, values.json ? undefined : 2))
  else if (command === 'setup')
    console.log(
      `Server configured in ${directory}.\nStart: ${cliName} start --data-dir ${JSON.stringify(directory)}\nPair: ${cliName} pair --data-dir ${JSON.stringify(directory)}`,
    )
  else if (command === 'stop')
    console.log('Server stopped. Workspace and device pairings are preserved.')
  else if (command === 'service' && args[0] === 'remove')
    console.log('Server service removed. Workspace and device pairings are preserved.')
  else {
    // Problems after a successful activation are reported without calling it a failed update.
    if (
      result &&
      typeof result === 'object' &&
      'warnings' in result &&
      Array.isArray(result.warnings)
    )
      for (const warning of result.warnings) console.warn(`Warning: ${String(warning)}`)
    const status = await serverStatus(directory)
    console.log(
      `${status.running ? 'Running' : 'Offline'}${status.running ? (status.managed ? ' in the background' : ' (started by another launcher)') : ''}\nData: ${directory}\nListen: ${status.host}:${status.port}\n${status.address ? `Connect: ${status.address}\n` : ''}${status.addresses.map((entry) => `${entry.name}: ${entry.address}\n`).join('')}Logs: ${status.logPath}${status.error ? `\n${status.error}` : ''}`,
    )
    if (command === 'service') {
      const warning = packagedServiceWarning(directory)
      if (warning) console.error(`Warning: ${warning}`)
    }
    if (
      status.running &&
      status.address &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(status.address).hostname)
    )
      console.log(
        'This loopback address works only on this computer. Run setup --host 0.0.0.0, then restart, to connect a phone over LAN or VPN.',
      )
    if (!status.running) process.exitCode = 1
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
