import { decode, runtimeRegistrySchema, threadWindowTargetSchema } from '@dovo/protocol'
import { desktopRuntimeDirectory } from './runtime-data-directory.js'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain, safeStorage, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  decodeRuntimeRegistry,
  mergeRuntimeRegistry,
} from '../../../packages/studio-core/src/workspace/runtime-registry.js'
import { pathToFileURL } from 'node:url'
import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
export function registerConnectionStorage(rendererPath: string) {
  let writes: Promise<unknown> = Promise.resolve()
  const readers = new Set<Electron.WebContents>()
  const appReaders = new Set<Electron.WebContents>()
  const read = async () => {
    try {
      return safeStorage.decryptString(await readFile(path()))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }
  const trustedFrame = (event: IpcMainEvent | IpcMainInvokeEvent, allowLauncher = false) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted connection storage request')
    const source = new URL(event.senderFrame.url)
    // The launcher may read appearance settings. Thread windows run the trusted
    // workbench and need its normal settings and connection storage access.
    if (allowLauncher && source.hash === '#task-launcher') source.hash = ''
    const threadHash = ['#thread=', '#thread-share='].find((prefix) =>
      source.hash.startsWith(prefix),
    )
    if (threadHash) {
      decode(
        threadWindowTargetSchema,
        JSON.parse(decodeURIComponent(source.hash.slice(threadHash.length))),
      )
      source.hash = ''
    }
    if (
      /^#browser-window=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        source.hash,
      )
    )
      source.hash = ''
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
      appReaders.add(event.sender)
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
      for (const reader of appReaders) {
        if (reader.isDestroyed()) appReaders.delete(reader)
        else if (reader !== event.sender) reader.send('app:settings-changed')
      }
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = { error: String(error) }
    }
  })
  ipcMain.handle('runtime:registry-read', async (event) => {
    trusted(event)
    readers.add(event.sender)
    await writes
    return read()
  })
  ipcMain.handle('runtime:registry-write', async (event, encoded: unknown, previous: unknown) => {
    trusted(event)
    const parse = (value: unknown) => {
      if (typeof value !== 'string' || value.length > 1024 * 1024)
        throw new Error('Invalid runtime registry')
      return decode(runtimeRegistrySchema, JSON.parse(value))
    }
    const next = parse(encoded)
    const before = parse(previous)
    const save = writes.then(async () => {
      const current = decodeRuntimeRegistry(await read(), null)
      const committed = JSON.stringify(mergeRuntimeRegistry(current, before, next))
      const target = path()
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, safeStorage.encryptString(committed), {
          mode: 0o600,
          flag: 'wx',
        })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
      for (const reader of readers) {
        if (reader.isDestroyed()) readers.delete(reader)
        else if (reader !== event.sender) reader.send('runtime:registry-changed')
      }
      return committed
    })
    // A rejected save must not poison subsequent reads or writes.
    writes = save.catch(() => {})
    return save
  })
}
