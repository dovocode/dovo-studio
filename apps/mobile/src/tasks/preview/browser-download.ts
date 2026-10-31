import { Directory, File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { createDownloadResumable } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { BROWSER_DOWNLOAD_MAX_BYTES } from '@dovo/protocol'

const active = new Map<string, number>()
const retentionMs = 24 * 60 * 60 * 1000
const maxExports = 10
const maxExportBytes = 100 * 1024 * 1024
const maxActive = 2

export async function shareBrowserDownload(options: {
  url: string
  origin: string
  name: string
  size: number
  signal: AbortSignal
}) {
  const target = new URL(options.url)
  if (
    target.origin !== options.origin ||
    !/^\/api\/previews\/browser\/download\/[A-Za-z0-9_-]+$/.test(target.pathname) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error('Invalid browser download address.')
  if (
    !Number.isSafeInteger(options.size) ||
    options.size < 0 ||
    options.size > BROWSER_DOWNLOAD_MAX_BYTES
  )
    throw new Error('Invalid browser download size.')
  if (options.signal.aborted) throw new Error('Download cancelled.')
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File sharing is unavailable on this device.')
  if (options.signal.aborted) throw new Error('Download cancelled.')
  if (active.size >= maxActive) throw new Error('Two browser downloads are already being saved.')
  const root = new Directory(Paths.cache, 'browser-download-exports')
  let count = active.size
  let bytes = [...active.values()].reduce((total, size) => total + size, 0)
  if (root.exists)
    for (const entry of root.list()) {
      if (!(entry instanceof Directory) || active.has(entry.uri)) continue
      const info = entry.info()
      if (info.modificationTime != null && Date.now() - info.modificationTime >= retentionMs) {
        entry.delete()
        continue
      }
      if (info.size == null || !Number.isSafeInteger(info.size) || info.size < 0)
        throw new Error('Could not determine browser download cache size.')
      count++
      bytes += info.size
    }
  if (count >= maxExports || bytes + options.size > maxExportBytes)
    throw new Error('Browser download cache is full. Try again after older shared files expire.')
  const directory = new Directory(root, randomUUID())
  active.set(directory.uri, options.size)
  let shared = false
  try {
    directory.create({ intermediates: true })
    const name =
      options.name
        .replace(/[/\\]|\p{Cc}/gu, '_')
        .replace(/^\.+$/, '_')
        .slice(0, 200) || 'download'
    const file = new File(directory, name)
    let oversized = false
    const task = createDownloadResumable(options.url, file.uri, {}, ({ totalBytesWritten }) => {
      if (totalBytesWritten > options.size) {
        oversized = true
        void task
          .cancelAsync()
          .catch((error: unknown) =>
            console.warn('Could not cancel oversized browser download', error),
          )
      }
    })
    const cancel = () => {
      void task
        .cancelAsync()
        .catch((error: unknown) => console.warn('Could not cancel browser download', error))
    }
    options.signal.addEventListener('abort', cancel, { once: true })
    try {
      if (options.signal.aborted) throw new Error('Download cancelled.')
      const response = await task.downloadAsync()
      if (options.signal.aborted) throw new Error('Download cancelled.')
      if (
        oversized ||
        !response ||
        response.status !== 200 ||
        !file.exists ||
        file.size !== options.size
      )
        throw new Error('Download failed or was incomplete.')
      await Sharing.shareAsync(file.uri)
      shared = true
    } finally {
      options.signal.removeEventListener('abort', cancel)
    }
  } finally {
    if (!shared) {
      try {
        if (directory.exists) directory.delete()
      } catch (error) {
        console.warn('Could not remove browser download export', error)
      }
    }
    active.delete(directory.uri)
  }
}
