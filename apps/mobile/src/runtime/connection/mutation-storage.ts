import { Effect } from 'effect'
import { Directory, File, Paths } from 'expo-file-system'
import { digestStringAsync, CryptoDigestAlgorithm, randomUUID } from 'expo-crypto'
import {
  decode,
  mutationOutboxSchema,
  type MutationStorage,
  type RuntimeConnection,
} from '@dovo/protocol'
async function fileFor(connection: RuntimeConnection) {
  const key = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([new URL(connection.address).origin, connection.token]),
  )
  const directory = new Directory(Paths.document, 'runtime-mutations')
  return { directory, file: new File(directory, `${key}.json`) }
}
const writer = Effect.runSync(Effect.makeSemaphore(1))
export const mobileMutationStorage: MutationStorage = {
  id: randomUUID,
  async read(connection) {
    const { file } = await fileFor(connection)
    return file.exists ? decode(mutationOutboxSchema, JSON.parse(await file.text())) : []
  },
  clear(connection) {
    return Effect.runPromise(
      writer
        .withPermits(1)(
          Effect.tryPromise({
            try: async () => {
              const { file } = await fileFor(connection)
              if (file.exists) file.delete()
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
        )
        .pipe(Effect.uninterruptible),
    )
  },
  update(connection, change) {
    return Effect.runPromise(
      writer
        .withPermits(1)(
          Effect.tryPromise({
            try: async () => {
              const { directory, file } = await fileFor(connection)
              const pending = change(
                file.exists ? decode(mutationOutboxSchema, JSON.parse(await file.text())) : [],
              )
              if (!pending.length) {
                if (file.exists) file.delete()
                return pending
              }
              directory.create({ intermediates: true, idempotent: true })
              const temporary = new File(directory, `${file.name}.tmp`)
              temporary.write(JSON.stringify(pending))
              await temporary.move(file, { overwrite: true })
              return pending
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
        )
        .pipe(Effect.uninterruptible),
    )
  },
}
