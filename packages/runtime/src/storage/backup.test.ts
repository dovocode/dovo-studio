import { expect, it } from 'vite-plus/test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backupRuntimeDatabase } from './backup'

it('backs up committed WAL data while the source remains open and restricts backup permissions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-backup-'))
  const source = join(directory, 'source.sqlite')
  const target = join(directory, 'backup.sqlite')
  const database = new Database(source)
  try {
    database.pragma('journal_mode = WAL')
    database.exec("CREATE TABLE test (value TEXT); INSERT INTO test VALUES ('saved work')")
    await backupRuntimeDatabase(source, target)
    const backup = new Database(target, { readonly: true })
    try {
      expect(backup.prepare('SELECT value FROM test').get()).toEqual({ value: 'saved work' })
    } finally {
      backup.close()
    }
    expect(statSync(target).mode & 0o777).toBe(0o600)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
