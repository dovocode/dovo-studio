import { Directory, File, Paths } from 'expo-file-system'
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'
import { createRuntimeReadCache, type CacheStorage, type RuntimeConnection } from '@dovo/protocol'

const digest = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)
const root = () => new Directory(Paths.document, 'runtime-read-cache')
async function fileFor(key: string) {
  const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.([a-f0-9]{64})\.(.+)$/.exec(key)
  if (!match) throw new Error('Invalid offline cache key')
  const directory = new Directory(root(), match[1], match[2])
  return { directory, file: new File(directory, `${await digest(match[3])}.json`) }
}
// Large histories exceed AsyncStorage's Android SQLite limits. Use app-private files.
const storage: CacheStorage = {
  async getItem(key) {
    const { file } = await fileFor(key)
    return file.exists ? file.text() : null
  },
  async setItem(key, value) {
    const { directory, file } = await fileFor(key)
    directory.create({ intermediates: true, idempotent: true })
    const temporary = new File(directory, `${file.name}.tmp`)
    temporary.write(value)
    await temporary.move(file, { overwrite: true })
  },
  async removeItem(key) {
    const { file } = await fileFor(key)
    if (file.exists) file.delete()
  },
  async removePrefix(prefix) {
    const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.$/.exec(prefix)
    if (!match) throw new Error('Invalid offline cache namespace')
    const directory = new Directory(root(), match[1])
    if (directory.exists) directory.delete()
  },
}
export const mobileReadCache = (connection: RuntimeConnection) =>
  createRuntimeReadCache(connection, storage, digest)
