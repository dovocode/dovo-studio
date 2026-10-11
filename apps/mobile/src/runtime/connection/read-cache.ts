import { nativeEffect, mobileWorkflow } from '../state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { Directory, File, Paths } from 'expo-file-system'
import { writeAsStringAsync, deleteAsync, makeDirectoryAsync } from 'expo-file-system/legacy'
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto'
import { createRuntimeReadCache, type CacheStorage, type RuntimeConnection } from '@dovo/protocol'
const digest = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)
const root = () => new Directory(Paths.document, 'runtime-read-cache')
function fileFor(key: string) {
  return mobileWorkflow(function* () {
    const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.([a-f0-9]{64})\.(.+)$/.exec(key)
    if (!match) return yield* Effect.fail(new Error('Invalid offline cache key'))
    const directory = new Directory(root(), match[1], match[2])
    return {
      directory,
      file: new File(directory, `${yield* nativeEffect(() => digest(match[3]))}.json`),
    }
  })
}
// Large histories exceed AsyncStorage's Android SQLite limits. Use app-private files.
const storage: CacheStorage = {
  getItem(key) {
    return runClientEffect(
      mobileWorkflow(function* () {
        const { file } = yield* fileFor(key)
        return file.exists ? yield* nativeEffect(() => file.text()) : null
      }),
    )
  },
  setItem(key, value) {
    return runClientEffect(
      mobileWorkflow(function* () {
        const { directory, file } = yield* fileFor(key)
        if (!directory.exists)
          yield* nativeEffect(() => makeDirectoryAsync(directory.uri, { intermediates: true }))
        const temporary = new File(directory, `${file.name}.tmp`)
        const temporaryUri = temporary.uri
        yield* nativeEffect(async () => {
          try {
            await writeAsStringAsync(temporaryUri, value)
            await temporary.move(file, { overwrite: true })
          } finally {
            await deleteAsync(temporaryUri, { idempotent: true })
          }
        })
      }),
    )
  },
  removeItem(key) {
    return runClientEffect(
      mobileWorkflow(function* () {
        const { file } = yield* fileFor(key)
        yield* nativeEffect(() => deleteAsync(file.uri, { idempotent: true }))
      }),
    )
  },
  removePrefix(prefix) {
    return runClientEffect(
      mobileWorkflow(function* () {
        const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.$/.exec(prefix)
        if (!match) return yield* Effect.fail(new Error('Invalid offline cache namespace'))
        const directory = new Directory(root(), match[1])
        yield* nativeEffect(() => deleteAsync(directory.uri, { idempotent: true }))
      }),
    )
  },
}
export const mobileReadCache = (connection: RuntimeConnection) =>
  createRuntimeReadCache(connection, storage, digest)
