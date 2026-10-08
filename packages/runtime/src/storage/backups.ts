import { decode, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import Database from 'better-sqlite3'
import { mkdir, readdir, stat, rm, rename, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { backupRuntimeDatabase } from './backup.js'
import { acquireProcessLock } from './process-lock.js'

const MAX_BACKUPS = 5
const MAX_BYTES = 512 * 1024 * 1024
const failureSchema = Schema.NullOr(mutableStruct({ at: Schema.String, message: Schema.String }))
export function verifyRuntimeBackup(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('Backup failed SQLite integrity check')
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get())
      throw new Error('This is not a Dovo runtime database')
  } finally {
    db.close()
  }
}
/** Verified SQLite snapshots include committed WAL data and attachment BLOBs. */
export class RuntimeBackups {
  private active?: Promise<{ path: string; size: number; createdAt: string }>
  private failure: { at: string; message: string } | null = null
  readonly directory: string
  constructor(readonly databasePath: string) {
    this.directory = join(dirname(resolve(databasePath)), 'backups')
  }
  async settle() {
    await this.active?.catch(() => undefined)
  }
  async list() {
    const names = await readdir(this.directory).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    })
    const entries = await Promise.all(
      names
        .filter((name) => /^runtime-(backup|before)-.*\.sqlite$/.test(name))
        .map(async (name) => {
          const path = join(this.directory, name)
          const info = await stat(path).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
              return undefined
            throw error
          })
          return info ? { path, size: info.size, createdAt: info.mtime.toISOString() } : undefined
        }),
    )
    return entries
      .filter((entry) => entry !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.path.localeCompare(a.path))
  }
  private async savedFailure() {
    if (this.failure) return this.failure
    if (this.databasePath === ':memory:') return null
    try {
      return decode(
        failureSchema,
        JSON.parse(await readFile(join(this.directory, 'status.json'), 'utf8')),
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }
  private async saveFailure() {
    const path = join(this.directory, 'status.json'),
      temporary = path + `.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(this.failure), { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async status() {
    return {
      entries: await this.list(),
      failure: await this.savedFailure(),
      active: !!this.active,
      maxCount: MAX_BACKUPS,
      maxBytes: MAX_BYTES,
    }
  }
  create() {
    if (this.databasePath === ':memory:')
      return Promise.reject(new Error('An in-memory runtime cannot create persistent backups'))
    if (this.active) return this.active
    this.active = this.withLock(() => this.write())
      .catch(async (error) => {
        this.failure = {
          at: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        }
        try {
          await this.saveFailure()
        } catch (statusError) {
          console.error('Could not persist backup failure status', statusError)
        }
        throw error
      })
      .finally(() => {
        this.active = undefined
      })
    return this.active
  }
  private async withLock<A>(run: () => Promise<A>) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const release = acquireProcessLock(join(this.directory, 'backup-operation.lock'))
    try {
      return await run()
    } finally {
      release()
    }
  }
  private async write() {
    // A killed writer may leave partial snapshots. The OS lock proves none is still active.
    for (const name of await readdir(this.directory))
      if (/^runtime-backup-.*\.sqlite\.partial$/.test(name)) await rm(join(this.directory, name))
    const path = join(this.directory, `runtime-backup-${Date.now()}-${randomUUID()}.sqlite`)
    const temporary = path + '.partial'
    try {
      await backupRuntimeDatabase(this.databasePath, temporary)
      verifyRuntimeBackup(temporary)
      const info = await stat(temporary)
      if (info.size > MAX_BYTES)
        throw new Error(
          'Database exceeds the 512 MB backup budget. Create an operator-managed backup before recovery.',
        )
      await rename(temporary, path)
      this.failure = null
      await this.pruneEntries()
      await this.saveFailure()
      return { path, size: info.size, createdAt: info.mtime.toISOString() }
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async prune() {
    return this.withLock(() => this.pruneEntries())
  }
  private async pruneEntries() {
    let bytes = 0,
      count = 0
    for (const entry of await this.list()) {
      bytes += entry.size
      if (++count > MAX_BACKUPS || (bytes > MAX_BYTES && count > 1)) await rm(entry.path)
    }
  }
  async automatic(now = Date.now()) {
    if (this.databasePath === ':memory:') return
    const latest = (await this.list())[0]
    if (!latest || now - Date.parse(latest.createdAt) >= 86_400_000) await this.create()
    else await this.prune()
  }
}
/** Offline only: the same OS-backed lock used by every runtime launcher prevents concurrent writes. */
export async function restoreRuntimeBackup(databasePath: string, source: string) {
  if (resolve(databasePath) === resolve(source)) throw new Error('Select a separate backup file')
  verifyRuntimeBackup(source)
  const release = acquireProcessLock(join(dirname(resolve(databasePath)), 'runtime-process.lock'))
  const temporary = databasePath + `.restore-${randomUUID()}`
  try {
    // Stage the selected source before retention can remove an older in-directory backup.
    await backupRuntimeDatabase(source, temporary)
    verifyRuntimeBackup(temporary)
    const backups = new RuntimeBackups(databasePath)
    // Keep the pre-restore database even if its conversation records cannot hydrate.
    try {
      await backups.create()
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'SQLITE_CANTOPEN'))
        throw error
    }
    await rm(databasePath + '-wal', { force: true })
    await rm(databasePath + '-shm', { force: true })
    await rename(temporary, databasePath)
    return { restored: databasePath, backup: source }
  } finally {
    await rm(temporary, { force: true })
    release()
  }
}
