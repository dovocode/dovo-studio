import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

export type TerminalHolderSupervisor = 'systemd' | 'launchd'

export function terminalHolderSupervisor(
  environment = process.env,
  platform = process.platform,
): TerminalHolderSupervisor | undefined {
  const manager = environment.DOVO_TERMINAL_HOLDER_SUPERVISOR
  if (platform === 'linux' && manager === 'systemd') return 'systemd'
  if (platform === 'darwin' && manager === 'launchd') return 'launchd'
}

type SupervisorHost = {
  execute: (command: string, args: string[]) => Promise<string>
  node: string
  uid?: number
}

const exec = promisify(execFile)
const host: SupervisorHost = {
  execute: async (command, args) => (await exec(command, args, { timeout: 10000 })).stdout,
  node: process.execPath,
  uid: process.getuid?.(),
}

const holderId = (directory: string) =>
  createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 24)
const systemdUnit = (directory: string) => `dovo-terminal-holder-${holderId(directory)}.service`
const xml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function launchdJob(directory: string, uid?: number) {
  if (uid === undefined) throw new Error('Cannot identify the launchd session for this user.')
  const domain = `gui/${uid}`
  const label = `com.dovo.terminal-holder-${holderId(directory)}`
  return { domain, label, target: `${domain}/${label}` }
}

async function launchdState(target: string, host: SupervisorHost) {
  try {
    return await host.execute('/bin/launchctl', ['print', target])
  } catch (cause) {
    // launchctl returns an exit status for an absent job. A failed command or timeout is different.
    if (
      cause &&
      typeof cause === 'object' &&
      'code' in cause &&
      (cause.code === 3 || cause.code === 113)
    )
      return undefined
    throw cause
  }
}

/** Start a separate holder job. Return false if its job was already running. The caller checks its socket. */
export async function launchTerminalHolder(
  { helper, directory }: { helper: string; directory: string },
  supervisor = terminalHolderSupervisor(),
  system = host,
) {
  if (!isAbsolute(helper) || !isAbsolute(directory))
    throw new Error('Terminal holder paths must be absolute.')
  if (supervisor === 'systemd') {
    // systemd expands dollars in arguments after receiving the transient service request.
    const args = [helper, directory].map((part) => part.replaceAll('$', () => '$$'))
    await system.execute('systemd-run', [
      '--user',
      '--collect',
      '--quiet',
      `--unit=${systemdUnit(directory)}`,
      '--property=Type=exec',
      '--property=KillMode=control-group',
      '--',
      system.node,
      ...args,
    ])
    return true
  }
  if (supervisor !== 'launchd') throw new Error('No terminal holder supervisor is configured.')
  const { domain, label, target } = launchdJob(directory, system.uid)
  const state = await launchdState(target, system)
  if (state !== undefined) {
    // A prior launch may already be starting. The socket check can wait for that holder.
    if (/^\s*pid = [1-9]\d*\s*$/m.test(state)) return false
    // An exited job carries the previous release path until it is unloaded.
    await system.execute('/bin/launchctl', ['bootout', target])
  }
  const plist = join(directory, 'holder-launch-agent.plist')
  const argumentsXml = [system.node, helper, directory]
    .map((argument) => `<string>${xml(argument)}</string>`)
    .join('')
  const log = xml(join(directory, 'holder.log'))
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${argumentsXml}</array>\n<key>RunAtLoad</key><true/>\n<key>StandardOutPath</key><string>${log}</string>\n<key>StandardErrorPath</key><string>${log}</string>\n</dict></plist>\n`,
    { mode: 0o600 },
  )
  await system.execute('/bin/launchctl', ['bootstrap', domain, plist])
  return true
}

/** Stop only this holder's independent unit after a failed startup. */
export async function stopTerminalHolder(
  directory: string,
  supervisor = terminalHolderSupervisor(),
  system = host,
) {
  if (supervisor === 'systemd') {
    await system.execute('systemctl', ['--user', 'stop', systemdUnit(directory)])
  } else if (supervisor === 'launchd') {
    const { target } = launchdJob(directory, system.uid)
    if ((await launchdState(target, system)) !== undefined)
      await system.execute('/bin/launchctl', ['bootout', target])
  }
}
