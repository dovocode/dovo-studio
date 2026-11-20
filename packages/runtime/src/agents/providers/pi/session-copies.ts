import { randomUUID } from 'node:crypto'
import { readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { TaskSummary } from '@dovo/protocol'
import type { WorkspaceStore } from '../../../storage/workspace.js'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const copyName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/

const memoryDirectories = new WeakMap<object, string>()
/** The folder for Dovo's private copies of imported Pi transcripts, next to the database. */
export function piSessionStorage(db: { name: string }) {
  if (db.name !== ':memory:') {
    const file = resolve(db.name)
    return join(dirname(file), `${basename(file)}.pi-sessions`)
  }
  let directory = memoryDirectories.get(db)
  if (!directory) {
    directory = join(tmpdir(), `dovo-pi-${randomUUID()}`)
    memoryDirectories.set(db, directory)
  }
  return directory
}

async function storageRoot(storage: string) {
  return realpath(storage).catch((error: unknown) => {
    if (missing(error)) return undefined
    throw error
  })
}
async function removeCopy(path: string) {
  try {
    await rm(path, { force: true })
  } catch (error) {
    // Startup recovery removes the copy later because the thread deletion is durable.
    console.error(`Could not remove the private Pi transcript ${path}`, error)
  }
}

/** Removes Dovo's private copies for deleted imported Pi threads. Each copy is the import's
 * `<thread id>.jsonl` in the copy folder. The user's original Pi transcript stays in place. */
export async function removePiSessionCopies(
  storage: string,
  tasks: readonly Pick<TaskSummary, 'id' | 'importedPiSession'>[],
) {
  if (!tasks.some((task) => task.importedPiSession?.privatePath)) return
  const root = await storageRoot(storage).catch((error: unknown) => {
    console.error('Could not read the private Pi transcript folder', error)
    return undefined
  })
  if (!root) return
  for (const task of tasks) {
    const copy = task.importedPiSession
    if (
      copy?.privatePath === join(root, `${task.id}.jsonl`) &&
      copy.privatePath !== copy.transcriptPath
    )
      await removeCopy(copy.privatePath)
  }
}

/** A repeated deletion request after a failed file removal. The thread deletion is recorded, so
 * its copy can go. Thread IDs that are not import IDs never name a file here. */
export async function removeDeletedPiCopy(
  storage: string,
  store: Pick<WorkspaceStore, 'get' | 'wasTaskDeleted'>,
  id: string,
) {
  if (
    !copyName.test(`${id}.jsonl`) ||
    store.get().tasks.some((task) => task.id === id) ||
    !store.wasTaskDeleted(id)
  )
    return
  const root = await storageRoot(storage).catch((error: unknown) => {
    console.error('Could not read the private Pi transcript folder', error)
    return undefined
  })
  if (root) await removeCopy(join(root, `${id}.jsonl`))
}

/** Startup: remove copies whose thread deletion committed before its file cleanup ran. Only a
 * recorded deletion removes a copy, so a backup restore without the thread keeps the file.
 * Files changed after `startedAt` belong to imports in progress. */
export async function recoverPiSessionCopies(
  storage: string,
  store: Pick<WorkspaceStore, 'get' | 'wasTaskDeleted'>,
  startedAt: number,
) {
  const root = await storageRoot(storage)
  if (!root) return
  const live = new Set(store.get().tasks.map((task) => task.id))
  for (const name of await readdir(root)) {
    const id = copyName.exec(name)?.[1]
    if (!id || live.has(id) || !store.wasTaskDeleted(id)) continue
    const path = join(root, name)
    const info = await stat(path).catch((error: unknown) => {
      if (missing(error)) return undefined
      throw error
    })
    // Check again after the file read: the thread could have returned meanwhile.
    if (info?.isFile() && info.mtimeMs < startedAt && !store.get().tasks.some((t) => t.id === id))
      await removeCopy(path)
  }
}
