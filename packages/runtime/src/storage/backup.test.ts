import { expect, it, vi } from 'vite-plus/test'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
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
      await backupRuntimeDatabase(source, target)
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

it('keeps a fixed WAL snapshot while another connection commits a change', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-backup-live-'))
  const source = join(directory, 'source.sqlite')
  const target = join(directory, 'backup.sqlite')
  const writer = new Database(source)
  try {
    writer.pragma('journal_mode = WAL')
    writer.exec(`
      CREATE TABLE test (value TEXT, padding BLOB);
      INSERT INTO test VALUES ('before backup', zeroblob(16 * 1024 * 1024));
    `)
    const pending = backupRuntimeDatabase(source, target)
    try {
      await Promise.race([
        vi.waitFor(() => expect(existsSync(target)).toBe(true), { interval: 1, timeout: 3000 }),
        pending,
      ])
      expect(statSync(target).mode & 0o777).toBe(0o600)
      writer.exec("UPDATE test SET value = 'saved during backup'")
    } finally {
      await pending
    }
    const copy = new Database(target, { readonly: true })
    try {
      expect(copy.prepare('SELECT value FROM test').pluck().get()).toBe('before backup')
      expect(writer.prepare('SELECT value FROM test').pluck().get()).toBe('saved during backup')
    } finally {
      copy.close()
    }
  } finally {
    writer.close()
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
