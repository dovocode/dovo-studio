import { Effect, Semaphore } from 'effect'
import { Directory, File, Paths } from 'expo-file-system'
import { digestStringAsync, CryptoDigestAlgorithm, randomUUID } from 'expo-crypto'
import {
  decode,
  mutationOutboxSchema,
  workspaceRecoveriesSchema,
  type MutationStorage,
  type MutationOutbox,
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
  await temporary.write(JSON.stringify(edit))
  await temporary.move(file, { overwrite: true })
}
const storageOperation = <A>(run: () => Promise<A>) =>
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
async function readOutbox({ directory, file }: Awaited<ReturnType<typeof fileFor>>) {
  const backup = new File(directory, `${file.name}.backup`)
  const committed = file.exists ? file : backup.exists ? backup : undefined
  return committed ? decode(mutationOutboxSchema, JSON.parse(await committed.text())) : []
}
async function writeOutbox(
  { directory, file }: Awaited<ReturnType<typeof fileFor>>,
  pending: MutationOutbox,
) {
  const name = file.name
  const backup = new File(directory, `${name}.backup`)
  const temporary = new File(directory, `${name}.tmp`)
  directory.create({ intermediates: true, idempotent: true })
  // Empty queues are committed too. A crash during clear must never restore an old queue.
  await temporary.write(JSON.stringify(pending))
  if (file.exists) await file.move(backup, { overwrite: true })
  // Expo overwrite deletes its destination first; this destination must not exist.
  await temporary.move(new File(directory, name))
  if (backup.exists) backup.delete()
}
export const mobileMutationStorage: MutationStorage = {
  workspaceRecoveries(connection) {
    return storageOperation(async () => {
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
    return storageOperation(async () => writeRecoveryEntry(await recoveryEntries(connection), edit))
  },
  id: randomUUID,
  read(connection) {
    return storageOperation(async () => readOutbox(await fileFor(connection)))
  },
  clear(connection) {
    return storageOperation(async () => writeOutbox(await fileFor(connection), []))
  },
  update(connection, change) {
    return storageOperation(async () => {
      const location = await fileFor(connection)
      const pending = change(await readOutbox(location))
      await writeOutbox(location, pending)
      return pending
    })
  },
}
