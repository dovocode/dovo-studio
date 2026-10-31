import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Run = { id: string; directory: string; lock: Database.Database }

const RUN = /^run-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.lock)?$/

/** Same OS-backed primitive as acquireProcessLock: SQLite releases it only on close or process
 * death, and reports SQLITE_BUSY to other connections in this process too. */
function tryLock(path: string) {
  const lock = new Database(path, { timeout: 0 })
  try {
    chmodSync(path, 0o600)
    lock.exec('BEGIN EXCLUSIVE')
    return lock
  } catch (cause) {
    lock.close()
    if (cause instanceof Error && 'code' in cause && cause.code === 'SQLITE_BUSY') return
    throw cause
  }
}

async function entry(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
}

async function unlinkLock(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    // Windows refuses while another sweeper has it open; the file then remains a tombstone.
    if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code ?? '')) throw error
  })
}

async function privateRoot(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Browser transfer storage is not a directory: ${root}`)
}

/**
 * Private staging for browser uploads and downloads. Each runtime run owns one directory guarded by
 * an OS lock, so a later run reclaims only runs proven dead, never another live runtime sharing
 * the data directory, and never anything outside its root. Without a root (memory databases) the
 * storage is an isolated temporary directory removed by dispose().
 *
 * Lock files are deleted only once nothing can lock them again: by their owner, or by a sweeper
 * holding the lock while the run directory exists. An owner creates its directory only after
 * locking, so that proves the owner locked earlier and has exited. Otherwise the file stays as a
 * tombstone; unlinking a lock an owner has opened but not yet locked would split it across inodes.
 */
export class BrowserTransferStorage {
  private run?: Promise<Run>
  private recovery?: Promise<number>
  private ephemeral?: Promise<string>
  private disposed = false
  // A plain field keeps this module loadable by Node type stripping in crash-recovery tests.
  private root?: string
  constructor(root?: string) {
    this.root = root
  }

  private claim() {
    return (this.run ??= (async () => {
      const root =
        this.root ?? (await (this.ephemeral ??= mkdtemp(join(tmpdir(), 'dovo-browser-transfers-'))))
      await privateRoot(root)
      // A sweeper can briefly hold a fresh lock before its owner; retry under a new ID.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomUUID()
        const lock = tryLock(join(root, `run-${id}.lock`))
        if (!lock) continue
        const directory = join(root, `run-${id}`)
        try {
          await mkdir(directory, { mode: 0o700 })
        } catch (error) {
          lock.close()
          throw error
        }
        return { id, directory, lock }
      }
      throw new Error('Could not claim browser transfer storage.')
    })().catch((error: unknown) => {
      // A transient failure such as a full disk must not disable later transfers.
      this.run = undefined
      throw error
    }))
  }

  /** Returns a new private directory owned by this run. Callers remove it when finished. */
  async allocate(kind: 'upload' | 'download') {
    if (this.disposed) throw new Error('Browser transfer storage is closed.')
    const run = await this.claim()
    if (this.disposed) throw new Error('Browser transfer storage is closed.')
    const directory = join(run.directory, `${kind}-${randomUUID()}`)
    await mkdir(directory, { mode: 0o700 })
    return directory
  }

  /** Reclaims runs whose owner process has exited. Runs once; resolves to the number removed and
   * rejects with every removal it could not complete, which the next run retries. */
  recover() {
    return (this.recovery ??= this.sweep())
  }

  private async sweep() {
    const root = this.root
    if (!root || !(await entry(root))) return 0
    await privateRoot(root)
    const own = this.run && (await this.run.catch(() => undefined))?.id
    const ids = new Set((await readdir(root)).flatMap((name) => RUN.exec(name)?.[1] ?? []))
    let removed = 0
    const failures: unknown[] = []
    for (const id of ids) {
      if (id === own) continue
      const path = join(root, `run-${id}.lock`)
      try {
        // A directory without a lock file is never deleted: its owner may still be locking.
        if (!(await entry(path))?.isFile()) continue
        const lock = tryLock(path)
        if (!lock) continue
        try {
          const directory = join(root, `run-${id}`)
          const stat = await entry(directory)
          if (!stat) continue
          if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error(`Unexpected browser transfer entry: ${directory}`)
          await rm(directory, { recursive: true, force: true })
          await unlinkLock(path)
          removed++
        } finally {
          lock.close()
        }
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Could not remove stale browser transfers: ${failures.map((error) => (error instanceof Error ? error.message : String(error))).join('; ')}`,
      )
    return removed
  }

  async dispose() {
    this.disposed = true
    const run = await this.run?.catch(() => undefined)
    if (this.ephemeral) {
      const root = await this.ephemeral.catch(() => undefined)
      run?.lock.close()
      if (root) await rm(root, { recursive: true, force: true })
      return
    }
    if (!run || !this.root) return
    try {
      await rm(run.directory, { recursive: true, force: true })
      await unlinkLock(join(this.root, `run-${run.id}.lock`))
    } finally {
      run.lock.close()
    }
  }
}
