import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
export function registerConnectionStorage(rendererPath: string) {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted connection storage request')
    const source = new URL(event.senderFrame.url)
    if (
      process.env.VITE_DEV_SERVER_URL
        ? source.origin !== new URL(process.env.VITE_DEV_SERVER_URL).origin
        : source.href !== pathToFileURL(rendererPath).href
    )
      throw new Error('Untrusted connection storage request')
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Unlock your system keychain to save runtime connections securely')
  }
  const path = () => join(app.getPath('userData'), 'runtime-connections.enc')
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
