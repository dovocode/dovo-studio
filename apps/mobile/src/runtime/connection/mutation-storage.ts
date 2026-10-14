import { Effect, Semaphore } from 'effect'
import { Directory, File, Paths } from 'expo-file-system'
import { digestStringAsync, CryptoDigestAlgorithm, randomUUID } from 'expo-crypto'
import {
  decode,
  mutationOutboxSchema,
  workspaceRecoveriesSchema,
  type MutationStorage,
  type RuntimeConnection,
} from '@dovo/protocol'
async function fileFor(connection: RuntimeConnection, suffix = '') {
  const key = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([new URL(connection.address).origin, connection.token]),
  )
  const directory = new Directory(Paths.document, 'runtime-mutations')
  return { directory, file: new File(directory, `${key}${suffix}.json`) }
}
const writer = Effect.runSync(Semaphore.make(1))
async function recoveryEntries(connection: RuntimeConnection) {
  const { directory, file: legacy } = await fileFor(connection, '.recoveries')
  const records = new Directory(directory, legacy.name.replace(/\.json$/, ''))
  // An interrupted migration leaves its source intact. Existing records make retry a no-op.
  if (legacy.exists) {
    const edits = decode(workspaceRecoveriesSchema, JSON.parse(await legacy.text())).edits
    records.create({ intermediates: true, idempotent: true })
    for (const edit of edits) await writeRecoveryEntry(records, edit)
    legacy.delete()
  }
  return records
}
async function writeRecoveryEntry(
  directory: Directory,
  edit: import('@dovo/protocol').WorkspaceRecovery,
) {
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA256, edit.id)
  const file = new File(directory, name + '.json')
  if (file.exists) return
  directory.create({ intermediates: true, idempotent: true })
  const temporary = new File(directory, name + '.tmp')
  temporary.write(JSON.stringify(edit))
  await temporary.move(file, { overwrite: true })
}
const recoveryOperation = <A>(run: () => Promise<A>) =>
  Effect.runPromise(
    writer
      .withPermits(1)(
        Effect.tryPromise({
          try: run,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      )
      .pipe(Effect.uninterruptible),
  )
export const mobileMutationStorage: MutationStorage = {
  workspaceRecoveries(connection) {
    return recoveryOperation(async () => {
      const directory = await recoveryEntries(connection)
      if (!directory.exists) return []
      const files = directory
        .list()
        .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
      const edits = await Promise.all(files.map(async (file) => JSON.parse(await file.text())))
      return decode(workspaceRecoveriesSchema, { edits }).edits
    })
  },
  recoverWorkspaceEdit(connection, edit) {
    return recoveryOperation(async () =>
      writeRecoveryEntry(await recoveryEntries(connection), edit),
    )
  },
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
