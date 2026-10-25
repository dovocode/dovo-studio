import { ipcMain, safeStorage } from 'electron'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { ACCOUNT_DIRECTORY_URL, connectServiceOrigin } from '@dovo/protocol'
import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { requireTrustedRenderer } from './renderer-trust.js'
export function registerAccountStorage(rendererPath: string) {
  const sharingPath = (origin: unknown, user: unknown) => {
    if (typeof origin !== 'string' || typeof user !== 'string' || !user || user.length > 500)
      throw new Error('Invalid sharing identity')
    return join(
      desktopRuntimeDirectory(),
      `sharing-key-${createHash('sha256')
        .update(JSON.stringify([connectServiceOrigin(origin), user]))
        .digest('hex')}.enc`,
    )
  }
  const pathFor = (origin: unknown) => {
    if (origin !== undefined && typeof origin !== 'string') throw new Error('Invalid Connect URL')
    const normalized = connectServiceOrigin(origin ?? ACCOUNT_DIRECTORY_URL)
    return join(
      desktopRuntimeDirectory(),
      normalized === ACCOUNT_DIRECTORY_URL
        ? 'account-session.enc'
        : `account-session-${createHash('sha256').update(normalized).digest('hex')}.enc`,
    )
  }
  let writes: Promise<unknown> = Promise.resolve()
  const unlocked = () => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Unlock your system keychain to sign in securely')
  }
  ipcMain.handle('sharing-key:read', async (event, origin: unknown, user: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    unlocked()
    const path = sharingPath(origin, user)
    await writes
    try {
      return safeStorage.decryptString(await readFile(path))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  })
  ipcMain.handle('sharing-key:write', (event, key: unknown, origin: unknown, user: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    unlocked()
    const path = sharingPath(origin, user)
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
      throw new Error('Invalid sharing key')
    const save = async () => {
      const temporary = path + '.' + randomUUID()
      try {
        await writeFile(temporary, safeStorage.encryptString(key), { mode: 0o600 })
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    const operation = writes.then(save, save)
    writes = operation
    return operation
  })
  ipcMain.handle('account:read', async (event, origin: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    unlocked()
    const path = pathFor(origin)
    await writes
    try {
      return safeStorage.decryptString(await readFile(path))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  })
  ipcMain.handle('account:write', (event, token: unknown, origin: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    unlocked()
    const path = pathFor(origin)
    if (token !== null && (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)))
      throw new Error('Invalid account session')
    const save = async () => {
      if (token === null) {
        await rm(path, { force: true })
        return
      }
      const temporary = path + '.' + randomUUID()
      try {
        await writeFile(temporary, safeStorage.encryptString(token), { mode: 0o600 })
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true })
      }
    }
    const operation = writes.then(save, save)
    writes = operation
    return operation
  })
}
