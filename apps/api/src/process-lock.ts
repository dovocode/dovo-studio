import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export function acquireProcessLock(path: string) {
  const nonce = randomUUID()
  const content = JSON.stringify({ pid: process.pid, nonce })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, content, { mode: 0o600, flag: 'wx' })
      return () => {
        if (existsSync(path) && readFileSync(path, 'utf8') === content) unlinkSync(path)
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const previous = readFileSync(path, 'utf8')
      const value: unknown = JSON.parse(previous)
      if (
        !value ||
        typeof value !== 'object' ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isInteger(value.pid) ||
        value.pid < 1
      )
        throw new Error(`Invalid process lock: ${path}. Inspect it before removing it.`)
      let active = true
      try {
        process.kill(value.pid, 0)
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') active = false
        else throw cause
      }
      if (active)
        throw new Error(`Another runtime operation is active (process ${value.pid}). Lock: ${path}`)
      if (readFileSync(path, 'utf8') === previous) unlinkSync(path)
    }
  }
  throw new Error(`Could not acquire runtime lock: ${path}`)
}
