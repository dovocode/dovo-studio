import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { IPty } from 'node-pty'

const execute = promisify(execFile)
type ProcessIdentity = {
  pid: number
  parent: number
  group: number
  started: string
  zombie: boolean
}
async function processes() {
  const { stdout } = await execute('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], {
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 2 * 1024 * 1024,
  })
  const result = new Map<number, ProcessIdentity>()
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    result.set(pid, {
      pid,
      parent: Number(match[2]),
      group: Number(match[3]),
      zombie: match[4]!.startsWith('Z'),
      started: match[5]!,
    })
  }
  return result
}
function signal(identity: ProcessIdentity, kind: NodeJS.Signals) {
  try {
    process.kill(identity.pid, kind)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

/** Capture children before signalling the shell: once it exits they are reparented, and a
 * foreground shell job may have its own process group. Never follow an already exited PID. */
export async function stopUnixTerminal(
  terminal: Pick<IPty, 'pid' | 'kill'>,
  exited: () => boolean,
) {
  if (exited()) return
  const before = await processes()
  const root = before.get(terminal.pid)
  if (!root) {
    if (!exited()) throw new Error('Could not identify the terminal process before shutdown')
    return
  }
  const children = new Map<number, ProcessIdentity[]>()
  for (const process of before.values()) {
    const siblings = children.get(process.parent) ?? []
    siblings.push(process)
    children.set(process.parent, siblings)
  }
  const owned = [root]
  for (let index = 0; index < owned.length; index++)
    owned.push(...(children.get(owned[index]!.pid) ?? []))

  const survivors = (current: Map<number, ProcessIdentity>) =>
    owned.filter((original) => {
      const next = current.get(original.pid)
      // PID, process group and start time must still match; a recycled PID is not ours to kill.
      return (
        next && !next.zombie && next.group === original.group && next.started === original.started
      )
    })
  const live = survivors(await processes())
  for (const child of [...live].reverse()) if (child.pid !== root.pid) signal(child, 'SIGTERM')
  if (!exited() && live.some((identity) => identity.pid === root.pid)) terminal.kill()
  const started = Date.now()
  let forced = false
  while (true) {
    const remaining = survivors(await processes())
    if (!remaining.length) return
    if (!forced && Date.now() - started >= 1000) {
      for (const child of [...remaining].reverse()) signal(child, 'SIGKILL')
      forced = true
    }
    if (Date.now() - started >= 3000)
      throw new Error('Terminal child processes did not exit during shutdown')
    await delay(100)
  }
}
