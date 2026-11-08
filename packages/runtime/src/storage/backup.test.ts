import { expect, it } from 'vite-plus/test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
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
    const mask = process.umask(0)
    try {
      const pending = backupRuntimeDatabase(source, target)
      try {
        expect(statSync(target).mode & 0o777).toBe(0o600)
      } finally {
        await pending
      }
    } finally {
      process.umask(mask)
    }
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

it('never overwrites an existing snapshot destination', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-backup-owned-'))
  const source = join(directory, 'source.sqlite'),
    target = join(directory, 'backup.sqlite')
  const database = new Database(source)
  try {
    database.exec('CREATE TABLE fixture (value TEXT)')
    writeFileSync(target, 'existing recovery bytes')
    await expect(backupRuntimeDatabase(source, target)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(target, 'utf8')).toBe('existing recovery bytes')
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
