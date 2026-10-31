import { afterEach, expect, it, vi } from 'vite-plus/test'
import { DatabaseSync } from 'node:sqlite'
const openDatabase = (path: string) => new DatabaseSync(path)
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  readlinkSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireProcessLock } from './process-lock'
import { activatePackagedRelease } from './server-update-recovery'
const paths: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
type Backup = (
  destination: string,
  options?: { progress?: (step: { totalPages: number; remainingPages: number }) => number },
) => Promise<unknown>
// Rollback restores through the runtime's own SQLite binding; the fault is injected there.
const RuntimeDatabase: { prototype: { backup: Backup } } = createRequire(
  createRequire(import.meta.url).resolve('@dovo/runtime'),
)('better-sqlite3')
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-activation-'))
  paths.push(directory)
  const databasePath = join(directory, 'runtime.sqlite')
  const previous = join(directory, 'old/bin/dovo-server')
  const replacement = join(directory, 'new/bin/dovo-server')
  for (const launcher of [previous, replacement]) {
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '')
  }
  const link = join(directory, 'service-launcher')
  symlinkSync(previous, link)
  writeFileSync(join(directory, 'server-service.json'), JSON.stringify({ launcher: previous }))
  const selected = () => (readlinkSync(link) === replacement ? 'new' : 'old')
  const backupPath = () => {
    const name = readdirSync(join(directory, 'backups')).find((name) =>
      /^runtime-before-[a-f0-9-]+\.sqlite$/.test(name),
    )
    if (!name) throw new Error('Missing pre-update backup')
    return join(directory, 'backups', name)
  }
  const db = openDatabase(databasePath)
  db.exec(
    "CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE fixture (version TEXT); INSERT INTO fixture VALUES ('old')",
  )
  db.close()
  let running = true,
    starts = 0
  const options = {
    databasePath,
    previous,
    replacement,
    candidateRecord: JSON.stringify({ launcher: replacement }),
    running: true,
    service: {
      stop: async () => {
        running = false
      },
      start: async () => {
        starts++
        running = true
        if (selected() === 'new') {
          const db = openDatabase(databasePath)
          try {
            db.exec('PRAGMA journal_mode=WAL')
            db.exec(
              "CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fixture (version TEXT); DELETE FROM fixture; INSERT INTO fixture VALUES ('migrated')",
            )
          } finally {
            db.close()
          }
        }
      },
    },
    prepare: async () => {},
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
  return {
    directory,
    options,
    version,
    backupPath,
    activate: () => activatePackagedRelease(directory, options),
    state: () => ({ selected: selected(), running, starts }),
  }
}
it('restores the original database and release after migration and verification failure', async () => {
  const f = fixture()
  expect(await f.activate()).toMatchObject({ status: 'rolled-back' })
  expect(f.version()).toEqual({ version: 'old' })
  expect(f.state()).toEqual({ selected: 'old', running: true, starts: 2 })
  // The replaced candidate database is preserved next to the pre-update backup.
  const preserved = readdirSync(join(f.directory, 'backups')).find((name) =>
    name.includes('before-rollback-'),
  )
  if (!preserved) throw new Error('Expected the replaced database to be preserved')
  const kept = openDatabase(join(f.directory, 'backups', preserved))
  try {
    expect(kept.prepare('SELECT version FROM fixture').get()).toEqual({ version: 'migrated' })
  } finally {
    kept.close()
  }
})
it('moves a database first created by a failed candidate aside, including its WAL', async () => {
  const f = fixture()
  rmSync(f.options.databasePath)
  expect(await f.activate()).toMatchObject({ status: 'rolled-back' })
  expect(existsSync(f.options.databasePath)).toBe(false)
  expect(existsSync(f.options.databasePath + '-wal')).toBe(false)
  expect(existsSync(f.options.databasePath + '-shm')).toBe(false)
  expect(
    readdirSync(join(f.directory, 'backups')).filter((name) =>
      /^runtime-before-[a-f0-9-]+\.sqlite$/.test(name),
    ),
  ).toEqual([])
  const preserved = readdirSync(join(f.directory, 'backups')).find((name) =>
    name.includes('before-rollback-'),
  )
  if (!preserved) throw new Error('Expected the candidate database to be preserved')
  const kept = openDatabase(join(f.directory, 'backups', preserved))
  try {
    expect(kept.prepare('SELECT version FROM fixture').get()).toEqual({ version: 'migrated' })
  } finally {
    kept.close()
  }
})
it('does not restore while another runtime holds the database lock', async () => {
  const f = fixture()
  let release: (() => void) | undefined
  const stop = f.options.service.stop
  let stops = 0
  // Another launcher takes the runtime lock after the candidate stops.
  f.options.service.stop = async () => {
    await stop()
    if (++stops === 2) release = acquireProcessLock(join(f.directory, 'runtime-process.lock'))
  }
  try {
    expect(await f.activate()).toMatchObject({ status: 'pending' })
  } finally {
    release?.()
  }
  expect(f.version()).toEqual({ version: 'migrated' })
  expect(f.state().selected).toBe('new')
})
it('recovers selection failures and reports a failed recovery restart', async () => {
  const f = fixture()
  f.options.prepare = async () => {
    await Promise.resolve()
    throw new Error('launcher write failed')
  }
  f.options.service.start = async () => {
    throw new Error('old release cannot restart')
  }
  expect(await f.activate()).toMatchObject({
    status: 'not-started',
    warnings: [expect.stringContaining('could not restart')],
  })
  expect(f.version()).toEqual({ version: 'old' })
  expect(f.state().selected).toBe('old')
})
it('never overwrites the database if the candidate cannot be stopped', async () => {
  const f = fixture()
  let stops = 0
  f.options.service.stop = async () => {
    if (++stops > 1) throw new Error('runtime is still alive')
  }
  expect(await f.activate()).toMatchObject({ status: 'pending' })
  expect(f.version()).toEqual({ version: 'migrated' })
  expect(f.state().selected).toBe('new')
  const backup = openDatabase(f.backupPath())
  try {
    expect(backup.prepare('SELECT version FROM fixture').get()).toEqual({ version: 'old' })
  } finally {
    backup.close()
  }
})
it('keeps the candidate database and selection when the restore fails midway', async () => {
  const f = fixture()
  const db = openDatabase(f.options.databasePath)
  db.exec('CREATE TABLE filler (data BLOB)')
  const insert = db.prepare('INSERT INTO filler VALUES (randomblob(4096))')
  db.exec('BEGIN')
  for (let row = 0; row < 2000; row++) insert.run()
  db.exec('COMMIT')
  db.close()
  const original = RuntimeDatabase.prototype.backup
  vi.spyOn(RuntimeDatabase.prototype, 'backup').mockImplementation(function (
    this: unknown,
    path,
    options,
  ) {
    if (path !== f.options.databasePath) return original.call(this, path, options)
    return original.call(this, path, {
      progress: ({ totalPages, remainingPages }) => {
        if (remainingPages < totalPages / 2)
          throw new Error('SQLITE_FULL: database or disk is full')
        return 50
      },
    })
  })
  const result = await f.activate()
  expect(result).toMatchObject({ status: 'pending' })
  if (result.status !== 'pending') throw new Error('Expected pending rollback')
  expect(String(result.cause)).toContain(f.backupPath())
  // The interrupted restore changed nothing, and the previous launcher waits for the database.
  expect(f.version()).toEqual({ version: 'migrated' })
  expect(f.state().selected).toBe('new')
  const backup = openDatabase(f.backupPath())
  try {
    expect(backup.prepare('SELECT version FROM fixture').get()).toEqual({ version: 'old' })
  } finally {
    backup.close()
  }
}, 30_000)
