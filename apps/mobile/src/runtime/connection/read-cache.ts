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
  return {
    directory,
    file: new File(directory, `${await digest(match[3])}.json`),
  }
}
// Large histories exceed AsyncStorage's Android SQLite limits. Use app-private files.
const storage: CacheStorage = {
  async getItem(key) {
    const { file } = await fileFor(key)
    return file.exists ? file.text() : null
  },
  async setItem(key, value) {
    const { directory, file } = await fileFor(key)
    if (!directory.exists) await makeDirectoryAsync(directory.uri, { intermediates: true })
    const temporary = new File(directory, `${file.name}.tmp`)
    const temporaryUri = temporary.uri
    try {
      await writeAsStringAsync(temporaryUri, value)
      await temporary.move(file, { overwrite: true })
    } finally {
      await deleteAsync(temporaryUri, { idempotent: true })
    }
  },
  async removeItem(key) {
    const { file } = await fileFor(key)
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
