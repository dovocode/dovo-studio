import { afterEach, expect, it } from 'vite-plus/test'
import { DatabaseSync } from 'node:sqlite'
const openDatabase = (path: string) => new DatabaseSync(path)
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activateServerRelease } from './server-activation'
const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-activation-'))
  paths.push(directory)
  const databasePath = join(directory, 'runtime.sqlite'),
    backupPath = join(directory, 'backups', 'before.sqlite')
  const db = openDatabase(databasePath)
  db.exec("CREATE TABLE fixture (version TEXT); INSERT INTO fixture VALUES ('old')")
  db.close()
  let selected = 'old',
    running = true,
    starts = 0
  const options = {
    databasePath,
    backupPath,
    wasRunning: true,
    stop: async () => {
      running = false
    },
    select: () => {
      selected = 'new'
    },
    rollback: () => {
      selected = 'old'
    },
    start: async () => {
      starts++
      running = true
      if (selected === 'new') {
        const db = openDatabase(databasePath)
        try {
          db.exec('PRAGMA journal_mode=WAL')
          db.exec("UPDATE fixture SET version = 'migrated'")
        } finally {
          db.close()
        }
      }
    },
    verify: async () => {
      throw new Error('Authenticated version verification failed')
    },
  }
  const version = () => {
    const db = openDatabase(databasePath)
    try {
      return db.prepare('SELECT version FROM fixture').get()
    } finally {
      db.close()
    }
  }
  return { options, version, state: () => ({ selected, running, starts }) }
}
it('restores the original database and release after migration and verification failure', async () => {
  const f = fixture()
  await expect(activateServerRelease(f.options)).rejects.toThrow(
    'previous release and database were restored',
  )
  expect(f.version()).toEqual({ version: 'old' })
  expect(f.state()).toEqual({ selected: 'old', running: true, starts: 2 })
})
it('recovers selection failures and reports a failed recovery restart', async () => {
  const f = fixture()
  f.options.select = async () => {
    await Promise.resolve()
    throw new Error('launcher write failed')
  }
  f.options.start = async () => {
    throw new Error('old release cannot restart')
  }
  await expect(activateServerRelease(f.options)).rejects.toThrow('activation and recovery failed')
  expect(f.version()).toEqual({ version: 'old' })
  expect(f.state().selected).toBe('old')
})
it('never overwrites the database if the candidate cannot be stopped', async () => {
  const f = fixture()
  let stops = 0
  f.options.stop = async () => {
    if (++stops > 1) throw new Error('runtime is still alive')
  }
  await expect(activateServerRelease(f.options)).rejects.toThrow('database was not restored')
  expect(f.version()).toEqual({ version: 'migrated' })
  expect(f.state().selected).toBe('new')
  const backup = openDatabase(f.options.backupPath)
  try {
    expect(backup.prepare('SELECT version FROM fixture').get()).toEqual({ version: 'old' })
  } finally {
    backup.close()
  }
})
