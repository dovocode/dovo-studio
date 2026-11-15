import type Database from 'better-sqlite3'
import { stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { decode, databaseSpaceSchema } from '@dovo/protocol'
import { RuntimeBackups } from './backups.js'

async function bytes(path: string) {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}
export async function databaseSpace(db: Database.Database) {
  const persistent = db.name !== ':memory:'
  const pageSize = Number(db.pragma('page_size', { simple: true }))
  const pages = Number(db.pragma('page_count', { simple: true }))
  const freePages = Number(db.pragma('freelist_count', { simple: true }))
  const [fileBytes, walBytes, disk] = persistent
    ? await Promise.all([bytes(db.name), bytes(db.name + '-wal'), statfs(dirname(db.name))])
    : [0, 0, null]
  return decode(databaseSpaceSchema, {
    persistent,
    fileBytes,
    walBytes,
    logicalBytes: pages * pageSize,
    reclaimableBytes: freePages * pageSize,
    freeBytes: disk ? disk.bavail * disk.bsize : null,
  })
}

/** VACUUM uses the owning connection, so other runtime writes cannot race its transaction.
 * The explicit action briefly blocks requests. SQLite atomically preserves the original on failure.
 * Never replace database files or sidecars while the runtime holds an open connection. */
export class DatabaseSpaceRecovery {
  private busy = false
  constructor(
    private db: Database.Database,
    private backups: RuntimeBackups,
  ) {}
  get active() {
    return this.busy
  }
  async recover() {
    if (this.busy) throw new Error('Database space recovery is already running.')
    this.busy = true
    try {
      const before = await databaseSpace(this.db)
      if (!before.persistent) throw new Error('This runtime uses an in-memory database.')
      // Reserve space for a backup, a full temporary database and the WAL commit.
      const required = before.logicalBytes * 3 + before.walBytes + 32 * 1024 * 1024
      if (before.freeBytes === null || before.freeBytes < required)
        throw new Error('Not enough free disk space. Free space before recovering database space.')
      const backup = await this.backups.create()
      const space = await databaseSpace(this.db)
      if (
        space.freeBytes === null ||
        space.freeBytes < space.logicalBytes * 2 + space.walBytes + 16 * 1024 * 1024
      )
        throw new Error(
          'Free disk space changed. Recovery stopped. The verified backup is available.',
        )
      if (this.db.inTransaction) throw new Error('Finish the current database transaction first.')
      const started = performance.now()
      this.db.exec('VACUUM')
      // A long reader can keep WAL pages pinned. Report that space instead of deleting sidecars.
      this.db.pragma('wal_checkpoint(TRUNCATE)')
      return {
        before,
        after: await databaseSpace(this.db),
        backup,
        durationMs: performance.now() - started,
      }
    } finally {
      this.busy = false
    }
  }
}
