import Database from 'better-sqlite3'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (
        !value ||
        typeof value !== 'object' ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isInteger(value.pid) ||
        value.pid < 1
      )
        throw new Error(`Invalid process lock: ${path}. Inspect it before removing it.`)
      try {
        process.kill(value.pid, 0)
        throw new Error(`Another runtime operation is active (process ${value.pid}). Lock: ${path}`)
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) throw cause
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
