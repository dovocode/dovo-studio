import type { ChildProcess } from 'node:child_process'

export class OwnedProcessShutdownError extends Error {}

const stopping = new WeakMap<ChildProcess, Promise<void>>()

/** Owned launchers must be spawned detached on Unix so their descendants share a killable group. */
export function stopOwnedChild(child: ChildProcess): Promise<void> {
  const existing = stopping.get(child)
  if (existing) return existing
  const stopped = new Promise<void>((resolve, reject) => {
    if (!child.pid) return resolve()
    const group = process.platform !== 'win32'
    const pid = group ? -child.pid : child.pid
    const alive = () => {
      if (!group && (child.exitCode !== null || child.signalCode !== null)) return false
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        throw error
      }
    }
    let poll: ReturnType<typeof setInterval> | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown) => {
      clearInterval(poll)
      clearTimeout(escalation)
      clearTimeout(deadline)
      if (error)
        reject(
          new OwnedProcessShutdownError(
            `Provider shutdown was not confirmed: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown shutdown error'}`,
          ),
        )
      else resolve()
    }
    const signal = (kind: NodeJS.Signals) => {
      try {
        process.kill(pid, kind)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
      }
    }
    try {
      if (!alive()) return resolve()
      signal('SIGTERM')
      poll = setInterval(() => {
        try {
          if (!alive()) finish()
        } catch (error) {
          // macOS may report EPERM while a killed group is being reaped. Keep
          // waiting for ESRCH; the deadline still rejects an unconfirmed exit.
          if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) finish(error)
        }
      }, 25)
      escalation = setTimeout(() => {
        try {
          signal('SIGKILL')
        } catch (error) {
          finish(error)
        }
      }, 1000)
      deadline = setTimeout(() => {
        try {
          finish(
            alive() ? new Error('Provider process did not exit after forced shutdown') : undefined,
          )
        } catch (error) {
          finish(error)
        }
      }, 2000)
    } catch (error) {
      finish(error)
    }
  })
  stopping.set(child, stopped)
  // Abort handlers may begin cleanup without awaiting it; the owner still awaits this same promise.
  void stopped.catch(() => undefined)
  return stopped
}
