import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain, safeStorage, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
export function registerConnectionStorage(rendererPath: string) {
  const trustedFrame = (event: IpcMainEvent | IpcMainInvokeEvent, allowLauncher = false) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted connection storage request')
    const source = new URL(event.senderFrame.url)
    // The standalone launcher may read appearance settings; other popup frames
    // retain their existing storage restrictions.
    if (allowLauncher && source.hash === '#task-launcher') source.hash = ''
    if (source.hash) throw new Error('Untrusted connection storage request')
    if (
      process.env.VITE_DEV_SERVER_URL
        ? source.origin !== new URL(process.env.VITE_DEV_SERVER_URL).origin
        : source.href !== pathToFileURL(rendererPath).href
    )
      throw new Error('Untrusted connection storage request')
  }
  const trusted = (event: IpcMainInvokeEvent) => {
    trustedFrame(event)
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Unlock your system keychain to save runtime connections securely')
  }
  const path = () => join(desktopRuntimeDirectory(), 'runtime-connections.enc')
  ipcMain.on('app:settings-read', (event) => {
    try {
      trustedFrame(event, true)
      event.returnValue = { value: readLocalSettingsSection('app') ?? null }
    } catch (error) {
      event.returnValue = { error: String(error) }
    }
  })
  ipcMain.on('app:settings-write', (event, encoded: unknown) => {
    try {
      trustedFrame(event)
      if (typeof encoded !== 'string' || encoded.length > 1024 * 1024)
        throw new Error('Invalid app settings')
      const value: unknown = JSON.parse(encoded)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid app settings')
      writeLocalSettingsSection('app', () => value)
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = { error: String(error) }
    }
  })
  ipcMain.handle('runtime:registry-read', async (event) => {
    trusted(event)
    try {
      return safeStorage.decryptString(await readFile(path()))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  })
  ipcMain.handle('runtime:registry-write', async (event, encoded: unknown) => {
    trusted(event)
    if (typeof encoded !== 'string' || encoded.length > 1024 * 1024)
      throw new Error('Invalid runtime registry')
    JSON.parse(encoded)
    const target = path()
    await writeFile(target + '.tmp', safeStorage.encryptString(encoded), {
      mode: 0o600,
    })
    await rename(target + '.tmp', target)
  })
}
