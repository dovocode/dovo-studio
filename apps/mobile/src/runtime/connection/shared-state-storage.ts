import { jsonStateStorage } from '@dovo/durable-connections'
import { Directory, File, Paths } from 'expo-file-system'
import { Effect, Semaphore } from 'effect'

const semaphore = Effect.runSync(Semaphore.make(1))
const serialized = <T>(work: () => Promise<T>) =>
  Effect.runPromise(
    semaphore
      .withPermits(1)(
        Effect.tryPromise({
          try: work,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      )
      .pipe(Effect.uninterruptible),
  )
function files(name: string) {
  const directory = new Directory(Paths.document, 'durable-state')
  return {
    directory,
    file: new File(directory, `${name}.v1.json`),
    backup: new File(directory, `${name}.v1.backup.json`),
    temporary: new File(directory, `${name}.v1.tmp`),
  }
}
async function read(name: string) {
  const { file, backup } = files(name)
  return file.exists ? file.text() : backup.exists ? backup.text() : null
}
async function write(name: string, value: string) {
  const { directory, file, backup, temporary } = files(name)
  directory.create({ intermediates: true, idempotent: true })
  await temporary.write(value)
  // Expo's overwrite removes the destination before moving. Rotate the committed file
  // first: a crash between moves still has a complete backup, and the final move never
  // deletes committed data. File.move mutates its source URI, so recreate the final target.
  if (file.exists) await file.move(backup, { overwrite: true })
  await temporary.move(new File(directory, `${name}.v1.json`))
}
const storage = (name: string) =>
  jsonStateStorage({
    read: () => serialized(() => read(name)),
    write: (value) => serialized(() => write(name, value)),
    update: (change) =>
      serialized(async () => {
        const previous = await read(name)
        const next = change(previous)
        if (next !== previous) await write(name, next)
        return next
      }),
  })
export const mobileSharedStateStorage = storage('shared-settings')
