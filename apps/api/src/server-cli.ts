import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readServerConfig, serverDirectory, setupServer } from './server-config.js'
import { serverStatus, startServer, stopServer } from './server-manager.js'
import { acquireProcessLock } from './process-lock.js'
import { mkdirSync } from 'node:fs'
import { selectedEntrypoint, sourceEntrypoint, updateServer } from './server-update.js'
import { serverDoctor } from './server-doctor.js'

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
      'public-address': { type: 'string' },
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
    console.log(`Usage: ${cliName} <setup | start | status | stop | restart | pair | doctor | update> [options]
  --data-dir <directory>    Workspace data directory (default: ~/.dovo)
  --host <host>             Setup: 0.0.0.0, an IP, local, tailscale, or netbird
  --port <number>           Setup: fixed port (default: 51464)
  --database <path>         Setup: database in the selected data directory
  --public-address <url>    Setup/pair: reachable LAN/VPN or HTTPS proxy origin
  --json                   Print status/configuration as JSON, never owner tokens
  --check-updates           Doctor: compare installed adapters with npm registry versions

Setup preserves the existing database and saved listening address. Start runs in the
background, independently of the terminal or desktop app. Logs: <data-dir>/server.log.
This does not install an OS service or restart after reboot. See docs/server-setup.md.
Pair accepts code/devices/approve/deny and --network/--manual, like pnpm pair.
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
    !['setup', 'start', 'status', 'stop', 'restart', 'pair', 'doctor', 'update'].includes(
      command,
    ) ||
    (command !== 'pair' && args.length)
  )
    throw new Error(`Invalid command. Run ${cliName} --help.`)
  if (command !== 'setup' && (values.host || values.port || values.database))
    throw new Error(
      '--host, --port and --database are setup options. Run setup, then restart to apply changes.',
    )
  if (command !== 'doctor' && values['check-updates'])
    throw new Error('--check-updates is a doctor option.')
  if (!['setup', 'pair'].includes(command) && values['public-address'])
    throw new Error('--public-address is a setup or pair option.')
  if (command !== 'pair' && (values.network || values.manual))
    throw new Error('--network and --manual are pair options.')
  const directory = serverDirectory(values['data-dir'])
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
  if (command === 'pair') {
    const config = readServerConfig(directory)
    const pairArgs = [...args, '--connection', join(directory, 'runtime-connection.json')]
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
    if (command === 'setup')
      result = setupServer(directory, {
        host: values.host,
        port: values.port,
        database: values.database,
        publicAddress: values['public-address'],
      })
    else if (command === 'stop') result = await stopServer(directory)
    else if (command === 'status') {
      const status = await serverStatus(directory)
      result = status
      if (!status.running) process.exitCode = 1
    } else if (command === 'update') result = await updateServer(directory)
    else {
      if (command === 'restart') await stopServer(directory)
      result = await startServer(directory, selectedEntrypoint(directory))
    }
  } finally {
    release()
  }
  if (values.json) console.log(JSON.stringify(result))
  else if (command === 'setup')
    console.log(
      `Server configured in ${directory}.\nStart: ${cliName} start --data-dir ${JSON.stringify(directory)}\nPair: ${cliName} pair --data-dir ${JSON.stringify(directory)}`,
    )
  else if (command === 'stop')
    console.log('Server stopped. Workspace and device pairings are preserved.')
  else {
    const status = await serverStatus(directory)
    console.log(
      `${status.running ? 'Running' : 'Offline'}${status.running ? (status.managed ? ' in the background' : ' (started by another launcher)') : ''}\nData: ${directory}\nListen: ${status.host}:${status.port}\n${status.address ? `Connect: ${status.address}\n` : ''}${status.addresses.map((entry) => `${entry.name}: ${entry.address}\n`).join('')}Logs: ${status.logPath}${status.error ? `\n${status.error}` : ''}`,
    )
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
