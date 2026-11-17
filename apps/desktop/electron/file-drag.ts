import { app, ipcMain } from 'electron'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireTrustedRenderer } from './renderer-trust.js'

const maxBytes = 32 * 1024 * 1024
const lifetime = 15 * 60_000
/** Only files written by this bridge can leave the renderer through native drag. */
export function registerFileDrag(rendererPath: string) {
  let pendingBytes = 0,
    pendingCount = 0
  const entries = new Map<
    string,
    {
      owner: number
      path: string
      directory: string
      bytes: number
      expires: number
      icon: Electron.NativeImage
    }
  >()
  const prune = async () => {
    for (const [id, entry] of entries)
      if (entry.expires <= Date.now()) {
        entries.delete(id)
        await rm(entry.directory, { recursive: true, force: true })
      }
  }
  ipcMain.handle('files:prepare-drag', async (event, name: unknown, data: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 240 ||
      /[\p{C}\\/]/u.test(name) ||
      basename(name) !== name ||
      name === '.' ||
      name === '..'
    )
      throw new Error('Invalid drag filename')
    if (!(data instanceof Uint8Array) || data.byteLength > maxBytes)
      throw new Error('Drag files must be at most 32 MB. Use Download for larger files.')
    await prune()
    if (
      entries.size + pendingCount >= 32 ||
      [...entries.values()].reduce((total, entry) => total + entry.bytes, 0) +
        pendingBytes +
        data.byteLength >
        128 * 1024 * 1024
    )
      throw new Error('Drag storage is full. Use Download or try again later.')
    pendingBytes += data.byteLength
    pendingCount++
    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'dovo-drag-'))
      const path = join(directory, name)
      await writeFile(path, data, { mode: 0o600 })
      const icon = await app.getFileIcon(path)
      const id = randomUUID()
      entries.set(id, {
        owner: event.sender.id,
        directory,
        path,
        icon,
        bytes: data.byteLength,
        expires: Date.now() + lifetime,
      })
      return id
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true })
      throw error
    } finally {
      pendingBytes -= data.byteLength
      pendingCount--
    }
  })
  ipcMain.on('files:start-drag', (event, id: unknown) => {
    try {
      requireTrustedRenderer(event, rendererPath)
      const entry = typeof id === 'string' ? entries.get(id) : undefined
      if (!entry || entry.owner !== event.sender.id || entry.expires <= Date.now())
        throw new Error('Prepare this file again before dragging.')
      event.sender.startDrag({ file: entry.path, icon: entry.icon })
      event.returnValue = {}
    } catch (error) {
      event.returnValue = { error: error instanceof Error ? error.message : String(error) }
    }
  })
  const timer = setInterval(() => {
    void prune().catch((error: unknown) => console.error('Could not clear drag files', error))
  }, 60_000)
  timer.unref()
  app.once('will-quit', () => {
    clearInterval(timer)
    for (const entry of entries.values())
      void rm(entry.directory, { recursive: true, force: true }).catch((error: unknown) =>
        console.error('Could not clear drag file', error),
      )
  })
}
