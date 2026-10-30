import { execFile, type ChildProcess } from 'node:child_process'
import { win32 } from 'node:path'

export class OwnedProcessShutdownError extends Error {
  /** Resolves only when the owned process tree is confirmed gone, even after a timeout. */
  readonly confirmed?: Promise<void>
  constructor(message: string, options?: ErrorOptions & { confirmed?: Promise<void> }) {
    super(message, options)
    this.confirmed = options?.confirmed
  }
}

const stopping = new WeakMap<ChildProcess, Promise<void>>()

/** Owned launchers must be spawned detached on Unix so their descendants share a killable group. */
export function stopOwnedChild(child: ChildProcess): Promise<void> {
  const existing = stopping.get(child)
  if (existing) return existing
  let confirm!: () => void
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve
  })
  const stopped = new Promise<void>((resolve, reject) => {
    if (!child.pid) {
      confirm()
      return resolve()
    }
    const group = process.platform !== 'win32'
    const pid = group ? -child.pid : child.pid
    const alive = () => {
      if (!group && (child.exitCode !== null || child.signalCode !== null)) return false
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
        // macOS reports EPERM for a group whose last process is being reaped.
        // This is not proof of exit: keep observing until ESRCH or the deadline.
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') return true
        throw error
      }
    }
    let poll: ReturnType<typeof setInterval> | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const drained = () =>
      (child.exitCode !== null || child.signalCode !== null) &&
      (!child.stdout || child.stdout.destroyed || child.stdout.readableEnded) &&
      (!child.stderr || child.stderr.destroyed || child.stderr.readableEnded)
    const observe = () => {
      // Observation never signals an old PID. A launcher exit alone does not prove
      // its descendants stopped; Unix must lose the group, Windows must drain stdio.
      try {
        if (group ? alive() : !drained()) return
      } catch {
        // A failed liveness probe cannot release the reservation. The original
        // shutdown error remains reported while we wait for positive confirmation.
        return
      }
      clearInterval(poll)
      confirm()
    }
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(escalation)
      clearTimeout(deadline)
      if (error) {
        // Keep observing, without retries or further signals, after reporting the
        // bounded shutdown failure. This timer must not keep the runtime alive.
        poll = setInterval(observe, 250)
        poll.unref()
        observe()
        reject(
          new OwnedProcessShutdownError(
            `Provider shutdown was not confirmed: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown shutdown error'}`,
            { cause: error, confirmed },
          ),
        )
      } else {
        confirm()
        resolve()
      }
    }
    if (!group) {
      if (drained()) return finish()
      const waitForDrain = () => {
        if (drained()) return finish()
        poll = setInterval(() => {
          if (drained()) finish()
        }, 25)
        deadline = setTimeout(
          () => finish(new Error('Provider process tree did not drain after forced shutdown')),
          2000,
        )
      }
      // A crashed launcher can have pending stdio EOF events. Its old PID is no
      // longer ours to terminate, so only wait for the remaining pipes to drain.
      if (child.exitCode !== null || child.signalCode !== null) return waitForDrain()
      // Windows signals stop only the launcher. taskkill /T owns descendant
      // termination too; do not release ownership until its inherited pipes drain.
      execFile(
        win32.join(
          process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
          'System32',
          'taskkill.exe',
        ),
        ['/PID', String(child.pid), '/T', '/F'],
        { timeout: 2000, windowsHide: true },
        (error) => {
          if (error && child.exitCode === null && child.signalCode === null) return finish(error)
          waitForDrain()
        },
      )
      return
    }
    const signal = (kind: NodeJS.Signals) => {
      try {
        process.kill(pid, kind)
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ESRCH' || error.code === 'EPERM')
          )
        )
          throw error
      }
    }
    try {
      if (!alive()) return finish()
      signal('SIGTERM')
      poll = setInterval(() => {
        try {
          if (!alive()) finish()
        } catch (error) {
          finish(error)
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
  // Preserve the failed result until exit is proven. Once confirmed, future cleanup
  // calls succeed without signalling a PID that may have been reused.
  void confirmed.then(() => stopping.set(child, confirmed))
  // Abort handlers may begin cleanup without awaiting it; the owner still awaits this same promise.
  void stopped.catch(() => undefined)
  return stopped
}
