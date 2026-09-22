import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/** Desktop and background launches share the same local owner identity. */
export function runtimeOwnerToken(directory: string, supplied?: string) {
  let token = supplied
  if (!token) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'owner-token')
    try {
      token = readFileSync(path, 'utf8').trim()
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      token = randomBytes(32).toString('base64url')
      try {
        writeFileSync(path, token, { mode: 0o600, flag: 'wx' })
      } catch (error) {
        // Two launchers can discover a missing token before the process lock is acquired.
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        token = readFileSync(path, 'utf8').trim()
      }
    }
    chmodSync(path, 0o600)
  }
  if (token.length < 32) throw new Error('Runtime owner token must contain at least 32 characters')
  return token
}
