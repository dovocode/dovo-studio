import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { randomUUID } from '@dovo/protocol'

const retentionMs = 24 * 60 * 60 * 1000
const active = new Set<string>()
const completed = new Map<string, number>()

function pruneExports(root: Directory) {
  try {
    if (!root.exists) return
    for (const entry of root.list()) {
      if (!(entry instanceof Directory) || active.has(entry.uri)) continue
      try {
        const marker = new File(entry, '.shared')
        const modified =
          completed.get(entry.uri) ??
          (marker.exists ? marker.info().modificationTime : entry.info().modificationTime)
        if (modified != null && Date.now() - modified >= retentionMs) {
          entry.delete()
          completed.delete(entry.uri)
        }
      } catch (error) {
        console.warn('Could not prune attachment share export', error)
        continue
      }
    }
  } catch (error) {
    console.warn('Could not inspect attachment share exports', error)
    return
  }
}

export async function shareAttachment(name: string, mime: string, data: string) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File sharing is unavailable on this device')
  const root = new Directory(Paths.cache, 'attachment-share-exports')
  pruneExports(root)
  const directory = new Directory(root, randomUUID())
  active.add(directory.uri)
  let shared = false
  try {
    directory.create({ intermediates: true })
    let safeName = name.replace(/[/\\]|\p{Cc}/gu, '_').replace(/^\.+$/, '_') || 'attachment'
    if (safeName.toLowerCase() === '.shared') safeName = `_${safeName.slice(1)}`
    const file = new File(directory, safeName)
    await file.write(data, { encoding: 'base64' })
    await Sharing.shareAsync(file.uri, { mimeType: mime })
    shared = true
    completed.set(directory.uri, Date.now())
    try {
      await new File(directory, '.shared').write('')
    } catch (error) {
      console.warn('Could not record attachment share retention', error)
    }
  } finally {
    if (!shared) {
      try {
        if (directory.exists) directory.delete()
      } catch (error) {
        console.warn('Could not remove attachment share export', error)
      }
    }
    active.delete(directory.uri)
  }
}
