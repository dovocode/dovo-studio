import Database from 'better-sqlite3'
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { uptime } from 'node:os'
import { randomUUID } from 'node:crypto'

/** SQLite holds an OS-backed lock until close or process death; its file must never be unlinked. */
export function acquireProcessLock(path: string) {
  const lock = new Database(path + '.sqlite', { timeout: 0 })
  const content = JSON.stringify({ pid: process.pid, nonce: randomUUID() })
  try {
    chmodSync(path + '.sqlite', 0o600)
    try {
      lock.exec('BEGIN EXCLUSIVE')
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'SQLITE_BUSY')
        throw new Error(`Another runtime operation is active. Lock: ${path}`, { cause })
      throw cause
    }
    // Retain the PID record for compatibility with an already running older binary.
    // All new contenders hold the SQLite lock before inspecting/removing stale metadata.
    if (existsSync(path)) {
      let value: unknown
      try {
        value = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        // A truncated record (killed mid-write, disk full) must name the file to remove.
        throw new Error(`Invalid process lock: ${path}. Inspect it before removing it.`)
      }
      if (
        !value ||
        typeof value !== 'object' ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isInteger(value.pid) ||
        value.pid < 1
      )
        throw new Error(`Invalid process lock: ${path}. Inspect it before removing it.`)
      // A record written before this boot names a PID the OS has since reused for something
      // else; only a record from the current boot can belong to a live runtime.
      const bootedAt = Date.now() - uptime() * 1000
      if (statSync(path).mtimeMs >= bootedAt)
        try {
          process.kill(value.pid, 0)
          throw new Error(
            `Another runtime operation is active (process ${value.pid}). Lock: ${path}`,
          )
        } catch (cause) {
          // EPERM: the PID belongs to another user's process, never to this runtime.
          if (
            !(
              cause instanceof Error &&
              'code' in cause &&
              (cause.code === 'ESRCH' || cause.code === 'EPERM')
            )
          )
            throw cause
        }
      unlinkSync(path)
    }
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  } catch (cause) {
    lock.close()
    throw cause
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      if (existsSync(path) && readFileSync(path, 'utf8') === content) unlinkSync(path)
    } finally {
      lock.close()
    }
  }
}
