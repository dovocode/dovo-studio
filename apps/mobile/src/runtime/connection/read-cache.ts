import { Directory, File, Paths } from 'expo-file-system'
import { writeAsStringAsync, deleteAsync, makeDirectoryAsync } from 'expo-file-system/legacy'
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'
import { createRuntimeReadCache, type CacheStorage, type RuntimeConnection } from '@dovo/protocol'
const digest = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)
const root = () => new Directory(Paths.document, 'runtime-read-cache')
async function fileFor(key: string) {
  const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.([a-f0-9]{64})\.(.+)$/.exec(key)
  if (!match) throw new Error('Invalid offline cache key')
  const directory = new Directory(root(), match[1], match[2])
  const name = `${await digest(match[3])}.json`
  return {
    directory,
    name,
    file: new File(directory, name),
    backup: new File(directory, name + '.backup'),
  }
}
async function readIfPresent(file: File, backup?: File) {
  if (!file.exists) return null
  try {
    return await file.text()
  } catch (error) {
    if (file.exists && !backup?.exists) throw error
    return null
  }
}
function isCompleteJson(value: string | null) {
  if (value === null) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}
// Large histories exceed AsyncStorage's Android SQLite limits. Use app-private files.
const storage: CacheStorage = {
  async getItem(key) {
    const { file, backup } = await fileFor(key)
    const published = await readIfPresent(file, backup)
    if (published !== null && (!backup.exists || isCompleteJson(published))) return published
    // Publication can overlap this read. Check the primary again if cleanup removed the backup.
    return (await readIfPresent(backup)) ?? (await readIfPresent(file))
  },
  async setItem(key, value) {
    const { directory, name, file, backup } = await fileFor(key)
    if (!directory.exists) await makeDirectoryAsync(directory.uri, { intermediates: true })
    const temporary = new File(directory, `${name}.tmp`)
    const temporaryUri = temporary.uri
    try {
      await writeAsStringAsync(temporaryUri, value)
      // Expo overwrite can remove the old file before the move succeeds.
      if (file.exists) {
        if (backup.exists && !isCompleteJson(await readIfPresent(file, backup))) {
          await deleteAsync(file.uri, { idempotent: true })
        } else {
          await deleteAsync(backup.uri, { idempotent: true })
          await file.move(backup)
        }
      }
      await temporary.move(new File(directory, name))
    } catch (error) {
      await deleteAsync(temporaryUri, { idempotent: true }).catch(() => {})
      throw error
    }
    await deleteAsync(backup.uri, { idempotent: true }).catch(() => {})
  },
  async removeItem(key) {
    const { file, backup } = await fileFor(key)
    await deleteAsync(backup.uri, { idempotent: true })
    await deleteAsync(file.uri, { idempotent: true })
  },
  async removePrefix(prefix) {
    const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.$/.exec(prefix)
    if (!match) throw new Error('Invalid offline cache namespace')
    const directory = new Directory(root(), match[1])
    await deleteAsync(directory.uri, { idempotent: true })
  },
}
export const mobileReadCache = (connection: RuntimeConnection) =>
  createRuntimeReadCache(connection, storage, digest)
