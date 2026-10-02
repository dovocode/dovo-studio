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
export const mobileMutationStorage: MutationStorage = {
  id: randomUUID,
  async read(connection) {
    const { file } = await fileFor(connection)
    return file.exists ? decode(mutationOutboxSchema, JSON.parse(await file.text())) : []
  },
  async write(connection, pending) {
    const { directory, file } = await fileFor(connection)
    if (!pending.length) {
      if (file.exists) file.delete()
      return
    }
    directory.create({ intermediates: true, idempotent: true })
    const temporary = new File(directory, `${file.name}.tmp`)
    temporary.write(JSON.stringify(pending))
    await temporary.move(file, { overwrite: true })
  },
}
