import { afterEach, expect, it, vi } from 'vite-plus/test'
import { spawn, type ChildProcess } from 'node:child_process'
import * as files from 'node:fs'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { acquireProcessLock } from './process-lock'
import { setupServer } from './server-config'
import { processExists, serverStatus, stopServer } from './server-manager'
import {
  activateSourceRelease,
  assertLaunchAllowed,
  prepareLaunch,
  recoverServerUpdate,
  settleLaunch,
} from './server-update-recovery'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    rmSync: vi.fn<typeof actual.rmSync>(actual.rmSync),
    renameSync: vi.fn<typeof actual.renameSync>(actual.renameSync),
  }
})
// Crash tests run the built modules in a separate updater process, then recover in this one.
vi.setConfig({ testTimeout: 60_000 })
type Progress = { totalPages: number; remainingPages: number }
type Backup = (
  destination: string,
  options?: { progress?: (step: Progress) => number },
) => Promise<unknown>
// The updater restores through the runtime's own SQLite binding; faults are injected there.
const RuntimeDatabase: { prototype: { backup: Backup } } = createRequire(
  createRequire(import.meta.url).resolve('@dovo/runtime'),
)('better-sqlite3')
/** Fail the in-place restore into `destination` once half of its pages are copied. */
function interruptRestore(destination: string, fault: () => never) {
  const original = RuntimeDatabase.prototype.backup
  return vi.spyOn(RuntimeDatabase.prototype, 'backup').mockImplementation(function (
    this: unknown,
    path,
    options,
  ) {
    if (path !== destination) return original.call(this, path, options)
    return original.call(this, path, {
      progress: ({ totalPages, remainingPages }) => {
        if (remainingPages < totalPages / 2) fault()
        return 50
      },
    })
  })
}
const dist = (name: string) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url))
const directories: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const directory of directories.splice(0)) {
    await stopServer(directory).catch(() => undefined)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const candidateSelection = (entrypoint: string) =>
  JSON.stringify({ entrypoint, version: 'candidate', createdAt: '2026-10-30T00:00:00.000Z' }) + '\n'
const previousSelection =
  JSON.stringify({ entrypoint: '/releases/previous/index.js', version: 'previous' }) + '\n'
async function fixture({ database = true } = {}) {
  // Packaged journals and retained launcher comparisons use canonical paths.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dovo-update-recovery-')))
  directories.push(directory)
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  setupServer(directory, { host: '127.0.0.1', port: String(address.port) })
  const databasePath = join(directory, 'runtime.sqlite')
  if (database) {
    const db = new DatabaseSync(databasePath)
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO documents VALUES ('fixture', 'before update')",
    )
    db.close()
  }
  const candidate = (name: string, after: string) => {
    const path = join(directory, `${name}.mjs`)
    // Migrates in WAL mode and leaves the WAL behind, like a runtime that dies during startup.
    writeFileSync(
      path,
      `import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
const data = dirname(process.env.DOVO_DATABASE_PATH)
const db = new DatabaseSync(process.env.DOVO_DATABASE_PATH)
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT OR REPLACE INTO documents VALUES ('fixture', 'written by candidate')")
${after}`,
    )
    return path
  }
  return {
    directory,
    databasePath,
    record: join(directory, 'server-update-transaction.json'),
    selection: join(directory, 'server-release.json'),
    candidate,
    failing: candidate('failing-candidate', 'process.exit(1)'),
  }
}
/** Enough pages that a restore takes many backup steps. */
function grow(path: string) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE filler (data BLOB)')
  const insert = db.prepare('INSERT INTO filler VALUES (randomblob(4096))')
  db.exec('BEGIN')
  for (let row = 0; row < 2000; row++) insert.run()
  db.exec('COMMIT')
  db.close()
}
function integrity(path: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('PRAGMA quick_check').get()?.quick_check
  } finally {
    db.close()
  }
}
function documentValue(path: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare("SELECT value FROM documents WHERE id = 'fixture'").get()?.value
  } finally {
    db.close()
  }
}
function preservedDatabases(directory: string) {
  return readdirSync(join(directory, 'backups'))
    .filter((name) => name.startsWith('runtime-before-rollback-') && name.endsWith('.sqlite'))
    .map((name) => join(directory, 'backups', name))
}
async function waitFor(condition: () => boolean, label: string) {
  const deadline = Date.now() + 20_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await delay(25)
  }
}
const readRecord = (path: string): { phase: string; candidates: number[] } =>
  JSON.parse(readFileSync(path, 'utf8'))
/** An updater process that SIGKILLs itself once `crash` holds, mid-activation. */
function interruptedUpdater(
  directory: string,
  options: { entrypoint: string; databasePath: string },
  crash: string,
) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { activateSourceRelease } from ${JSON.stringify(pathToFileURL(dist('server-update-recovery.js')).href)}
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const directory = ${JSON.stringify(directory)}
const record = () => { try { return JSON.parse(readFileSync(join(directory, 'server-update-transaction.json'), 'utf8')) } catch { return undefined } }
setInterval(() => { if (${crash}) process.kill(process.pid, 'SIGKILL') }, 5)
await activateSourceRelease(directory, ${JSON.stringify({
        id: 'interrupted',
        entrypoint: options.entrypoint,
        selection: candidateSelection(options.entrypoint),
        databasePath: options.databasePath,
        running: false,
      })})
process.exit(0)`,
    ],
    { stdio: 'ignore' },
  )
  children.push(child)
  return new Promise<NodeJS.Signals | null>((resolve) =>
    child.once('exit', (_code, signal) => resolve(signal)),
  )
}

it('restores the database and the absent selection after a candidate migrated and failed', async () => {
  const f = await fixture()
  const result = await activateSourceRelease(f.directory, {
    id: 'failed-migration',
    entrypoint: f.failing,
    selection: candidateSelection(f.failing),
    databasePath: f.databasePath,
    running: false,
  })
  expect(result).toMatchObject({ status: 'rolled-back' })
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.selection)).toBe(false)
  expect(existsSync(f.record)).toBe(false)
  if (result.status !== 'rolled-back' || !result.preserved) throw new Error('Expected a rollback')
  // Data the candidate wrote is preserved, never discarded.
  expect(documentValue(result.preserved)).toBe('written by candidate')
  expect(
    documentValue(join(f.directory, 'backups', 'runtime-before-failed-migration.sqlite')),
  ).toBe('before update')
  // Snapshots are self-contained files; opening them leaves no WAL sidecars behind.
  expect(
    readdirSync(join(f.directory, 'backups')).filter((name) => /-(wal|shm|journal)$/.test(name)),
  ).toEqual([])
})

it('moves a database first created by a failed candidate aside with its WAL', async () => {
  const f = await fixture({ database: false })
  const result = await activateSourceRelease(f.directory, {
    id: 'created-database',
    entrypoint: f.failing,
    selection: candidateSelection(f.failing),
    databasePath: f.databasePath,
    running: false,
  })
  expect(result).toMatchObject({ status: 'rolled-back' })
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    expect(existsSync(f.databasePath + suffix)).toBe(false)
  if (result.status !== 'rolled-back' || !result.preserved) throw new Error('Expected a rollback')
  expect(documentValue(result.preserved)).toBe('written by candidate')
})

it('finishes a rollback whose previous selection could not be saved after the restore', async () => {
  const f = await fixture()
  writeFileSync(f.selection, previousSelection)
  // The candidate occupies this process's temporary selection path, so only reselection fails.
  const blocking = f.candidate(
    'blocking-candidate',
    `mkdirSync(join(data, 'server-release.json.' + process.ppid + '.tmp')); process.exit(1)`,
  )
  const result = await activateSourceRelease(f.directory, {
    id: 'metadata-failure',
    entrypoint: blocking,
    selection: candidateSelection(blocking),
    databasePath: f.databasePath,
    running: false,
  })
  expect(result).toMatchObject({ status: 'pending' })
  if (result.status !== 'pending') throw new Error('Expected an incomplete rollback')
  expect(String(result.cause)).toContain('EISDIR')
  expect(String(result.error)).toContain('Runtime did not start')
  // The database is restored first; the candidate stays selected until reselection succeeds.
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(blocking))
  expect(readRecord(f.record).phase).toBe('rolling-back')

  await rm(join(f.directory, `server-release.json.${process.pid}.tmp`), { recursive: true })
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(false)
})

it('never restores beneath a recorded candidate that has not exited', async () => {
  const f = await fixture()
  const backup = join(f.directory, 'backups', 'runtime-before-unconfirmed.sqlite')
  files.mkdirSync(join(f.directory, 'backups'))
  const db = new DatabaseSync(f.databasePath)
  db.exec(`VACUUM INTO '${backup}'`)
  db.exec("UPDATE documents SET value = 'written by candidate'")
  db.close()
  const candidate = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  })
  children.push(candidate)
  await new Promise((resolve) => candidate.once('spawn', resolve))
  writeFileSync(f.selection, candidateSelection(f.failing))
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'unconfirmed',
      phase: 'rolling-back',
      mode: 'managed',
      entrypoint: f.failing,
      selection: { previous: null, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup },
      candidates: [candidate.pid],
    }),
  )
  await expect(recoverServerUpdate(f.directory)).rejects.toThrow(
    `Candidate process ${candidate.pid} or its process group has not exited`,
  )
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))

  candidate.kill('SIGKILL')
  await new Promise((resolve) => candidate.once('exit', resolve))
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.selection)).toBe(false)
})

it('holds database admission through snapshot publication and selection, then releases it for the candidate', async () => {
  const f = await fixture()
  const backup = join(f.directory, 'backups', 'runtime-before-admission.sqlite')
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  const denied: string[] = []
  vi.mocked(files.renameSync).mockImplementation((from, to) => {
    if (String(to) === backup || String(to) === f.selection) {
      try {
        acquireProcessLock(join(f.directory, 'runtime-process.lock'))()
      } catch (error) {
        if (error instanceof Error) denied.push(error.message)
        else throw error
      }
    }
    actual.renameSync(from, to)
  })
  let admitted = false
  const result = await activateSourceRelease(f.directory, {
    id: 'admission',
    entrypoint: f.failing,
    selection: candidateSelection(f.failing),
    databasePath: f.databasePath,
    running: false,
    service: {
      stop: async () => {},
      start: async () => {
        acquireProcessLock(join(f.directory, 'runtime-process.lock'))()
        admitted = true
      },
    },
  })
  expect(result.status).toBe('active')
  expect(admitted).toBe(true)
  expect(denied).toHaveLength(2)
  expect(denied.every((message) => message.includes('Another runtime operation'))).toBe(true)
})

it('does not take a stale activation snapshot while a foreign runtime owns the database', async () => {
  const f = await fixture()
  writeFileSync(f.selection, previousSelection)
  const release = acquireProcessLock(join(f.directory, 'runtime-process.lock'))
  try {
    const result = await activateSourceRelease(f.directory, {
      id: 'foreign',
      entrypoint: f.failing,
      selection: candidateSelection(f.failing),
      databasePath: f.databasePath,
      running: false,
    })
    expect(result).toMatchObject({
      status: 'not-started',
      error: expect.objectContaining({
        message: expect.stringContaining('Another runtime operation'),
      }),
    })
    expect(documentValue(f.databasePath)).toBe('before update')
    expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
    expect(existsSync(join(f.directory, 'backups', 'runtime-before-foreign.sqlite'))).toBe(false)
    expect(existsSync(f.record)).toBe(false)
  } finally {
    release()
  }
})

it('leaves everything unchanged while another runtime holds the database lock', async () => {
  const f = await fixture()
  const backup = join(f.directory, 'backups', 'runtime-before-locked.sqlite')
  files.mkdirSync(join(f.directory, 'backups'))
  const db = new DatabaseSync(f.databasePath)
  db.exec(`VACUUM INTO '${backup}'`)
  db.exec("UPDATE documents SET value = 'written by candidate'")
  db.close()
  writeFileSync(f.selection, candidateSelection(f.failing))
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'locked',
      phase: 'rolling-back',
      mode: 'managed',
      entrypoint: f.failing,
      selection: { previous: null, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup },
      candidates: [],
    }),
  )
  const release = acquireProcessLock(join(f.directory, 'runtime-process.lock'))
  try {
    await expect(recoverServerUpdate(f.directory)).rejects.toThrow('Another runtime operation')
  } finally {
    release()
  }
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(readRecord(f.record).phase).toBe('rolling-back')
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('never lets a candidate open the database when its updater dies before recording it', async () => {
  const f = await fixture()
  const marker = join(f.directory, 'candidate-ran')
  const candidate = join(f.directory, 'marking-candidate.mjs')
  writeFileSync(
    candidate,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran')`,
  )
  const updater = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { startServer } from ${JSON.stringify(pathToFileURL(dist('server-manager.js')).href)}
await startServer(${JSON.stringify(f.directory)}, ${JSON.stringify(candidate)}, () => process.kill(process.pid, 'SIGKILL'))`,
    ],
    { stdio: 'ignore' },
  )
  children.push(updater)
  await new Promise((resolve) => updater.once('exit', resolve))
  const { pid } = JSON.parse(readFileSync(join(f.directory, 'server-process.json'), 'utf8'))
  await waitFor(() => !processExists(pid), `unadmitted candidate ${pid} to exit`)
  expect(existsSync(marker)).toBe(false)
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('keeps a healthy candidate whose updater died before confirming it', async () => {
  const f = await fixture()
  const signal = await interruptedUpdater(
    f.directory,
    { entrypoint: dist('index.js'), databasePath: f.databasePath },
    // The candidate published its connection; readiness is not yet confirmed.
    `existsSync(join(directory, 'runtime-connection.json')) && record()?.candidates.length`,
  )
  expect(signal).toBe('SIGKILL')
  const [pid] = readRecord(f.record).candidates
  expect(readRecord(f.record).phase).toBe('activating')
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'completed' })
  expect(await serverStatus(f.directory)).toMatchObject({ running: true, managed: true, pid })
  expect(existsSync(f.record)).toBe(false)
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(dist('index.js')))
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('waits for an orphaned candidate, then rolls back when the resumed candidate fails', async () => {
  const f = await fixture()
  // The first launch migrates and stalls; the resumed launch migrates and fails.
  const candidate = f.candidate(
    'stalling-candidate',
    `if (existsSync(join(data, 'stalled'))) process.exit(1)
writeFileSync(join(data, 'stalled'), String(process.pid))
setInterval(() => {}, 1000)`,
  )
  const signal = await interruptedUpdater(
    f.directory,
    { entrypoint: candidate, databasePath: f.databasePath },
    `existsSync(join(directory, 'stalled'))`,
  )
  expect(signal).toBe('SIGKILL')
  const [pid] = readRecord(f.record).candidates
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  await expect(recoverServerUpdate(f.directory)).rejects.toThrow(
    `Candidate process ${pid} from interrupted update interrupted, or its process group, is running but unreachable`,
  )
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(candidate))
  expect(documentValue(f.databasePath)).toBe('written by candidate')

  process.kill(pid, 'SIGKILL')
  await waitFor(() => !processExists(pid), `orphaned candidate ${pid} to exit`)
  const recovered = await recoverServerUpdate(f.directory)
  expect(recovered).toMatchObject({
    outcome: 'rolled-back',
    error: expect.stringContaining('Runtime did not start'),
  })
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.selection)).toBe(false)
  expect(existsSync(f.record)).toBe(false)
  expect(preservedDatabases(f.directory).map(documentValue)).toEqual(['written by candidate'])
})

it('reports a record that cannot be cleared after activation and never rolls that release back', async () => {
  const f = await fixture()
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  let starts = 0
  const service = {
    stop: async () => {},
    start: async () => {
      starts++
      const db = new DatabaseSync(f.databasePath)
      db.exec("UPDATE documents SET value = 'accepted by the new release'")
      db.close()
      if (starts > 1) return
      // The release is now active; clearing or completing its record fails afterwards.
      vi.mocked(files.rmSync).mockImplementation((path, options) => {
        if (path === f.record)
          throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
        actual.rmSync(path, options)
      })
      vi.mocked(files.renameSync).mockImplementation((from, to) => {
        if (to === f.record)
          throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' })
        actual.renameSync(from, to)
      })
    },
  }
  let result
  try {
    result = await activateSourceRelease(f.directory, {
      id: 'stale-record',
      entrypoint: f.failing,
      selection: candidateSelection(f.failing),
      databasePath: f.databasePath,
      running: false,
      service,
    })
  } finally {
    vi.mocked(files.rmSync).mockImplementation(actual.rmSync)
    vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
  }
  expect(result).toMatchObject({
    status: 'active',
    warnings: [expect.stringContaining('its completion could not be recorded durably')],
  })
  expect(readRecord(f.record).phase).toBe('activating')
  // The stale record resumes forward: the release is started and kept, with its data.
  await expect(recoverServerUpdate(f.directory, service)).resolves.toMatchObject({
    outcome: 'completed',
  })
  expect(starts).toBe(2)
  expect(documentValue(f.databasePath)).toBe('accepted by the new release')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(existsSync(f.record)).toBe(false)
})

it('keeps the previous release when the pre-update snapshot cannot be verified', async () => {
  const f = await fixture({ database: false })
  const db = new DatabaseSync(f.databasePath)
  db.exec('CREATE TABLE unrelated (value TEXT)')
  db.close()
  writeFileSync(f.selection, previousSelection)
  const result = await activateSourceRelease(f.directory, {
    id: 'unverified',
    entrypoint: f.failing,
    selection: candidateSelection(f.failing),
    databasePath: f.databasePath,
    running: false,
  })
  expect(result).toMatchObject({ status: 'not-started' })
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(existsSync(f.record)).toBe(false)
  expect(readdirSync(join(f.directory, 'backups'))).toEqual([])
})

it('refuses invalid records and launchers that did not start the interrupted update', async () => {
  const f = await fixture()
  writeFileSync(f.record, '{"version":1')
  await expect(recoverServerUpdate(f.directory)).rejects.toThrow('Invalid server update record')
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'managed',
      phase: 'activating',
      mode: 'managed',
      entrypoint: f.failing,
      selection: { previous: null, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup: null },
      candidates: [],
    }),
  )
  const service = { stop: async () => {}, start: async () => {} }
  await expect(recoverServerUpdate(f.directory, service)).rejects.toThrow(
    'An interrupted update must finish first: run pnpm server start',
  )
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(true)
})

it('changes nothing and starts no candidate when the update intent cannot be recorded', async () => {
  const f = await fixture()
  writeFileSync(f.selection, previousSelection)
  const marker = join(f.directory, 'candidate-ran')
  const candidate = f.candidate(
    'unrecorded-candidate',
    `writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(1)`,
  )
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(files.renameSync).mockImplementation((from, to) => {
    if (to === f.record)
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    actual.renameSync(from, to)
  })
  try {
    await expect(
      activateSourceRelease(f.directory, {
        id: 'no-intent',
        entrypoint: candidate,
        selection: candidateSelection(candidate),
        databasePath: f.databasePath,
        running: false,
      }),
    ).rejects.toThrow('ENOSPC')
  } finally {
    vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
  }
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(readdirSync(f.directory).filter((name) => name.startsWith('server-update-'))).toEqual([])
  expect(existsSync(marker)).toBe(false)
  expect(existsSync(join(f.directory, 'backups'))).toBe(false)
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('discards an interrupted snapshot without touching the selection or database', async () => {
  const f = await fixture()
  writeFileSync(f.selection, previousSelection)
  files.mkdirSync(join(f.directory, 'backups'))
  const partial = join(f.directory, 'backups', 'runtime-before-snapshot.sqlite.partial')
  writeFileSync(partial, 'incomplete')
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'snapshot',
      phase: 'prepared',
      mode: 'managed',
      entrypoint: f.failing,
      selection: { previous: previousSelection, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup: null },
      candidates: [],
    }),
  )
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'abandoned' })
  expect(existsSync(partial)).toBe(false)
  expect(existsSync(f.record)).toBe(false)
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('refuses to restore an absent database while a stray WAL remains', async () => {
  const f = await fixture({ database: false })
  writeFileSync(f.databasePath + '-wal', 'stray frames')
  writeFileSync(f.selection, candidateSelection(f.failing))
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'stray-wal',
      phase: 'rolling-back',
      mode: 'managed',
      entrypoint: f.failing,
      selection: { previous: null, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup: null },
      candidates: [],
    }),
  )
  await expect(recoverServerUpdate(f.directory)).rejects.toThrow('exists without its database')
  expect(readFileSync(f.databasePath + '-wal', 'utf8')).toBe('stray frames')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(readRecord(f.record).phase).toBe('rolling-back')
})

it('keeps the selection and database when the verified snapshot cannot be published', async () => {
  const f = await fixture()
  writeFileSync(f.selection, previousSelection)
  const backup = join(f.directory, 'backups', 'runtime-before-unpublished.sqlite')
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(files.renameSync).mockImplementation((from, to) => {
    if (to === backup) throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' })
    actual.renameSync(from, to)
  })
  let result
  try {
    result = await activateSourceRelease(f.directory, {
      id: 'unpublished',
      entrypoint: f.failing,
      selection: candidateSelection(f.failing),
      databasePath: f.databasePath,
      running: false,
    })
  } finally {
    vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
  }
  expect(result).toMatchObject({
    status: 'not-started',
    error: expect.objectContaining({ code: 'EIO' }),
  })
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(readdirSync(join(f.directory, 'backups'))).toEqual([])
  expect(existsSync(f.record)).toBe(false)
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('keeps a candidate-created database whole when moving it aside fails, then finishes', async () => {
  const f = await fixture({ database: false })
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(files.renameSync).mockImplementation((from, to) => {
    if (from === f.databasePath)
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    actual.renameSync(from, to)
  })
  let result
  try {
    result = await activateSourceRelease(f.directory, {
      id: 'move-aside',
      entrypoint: f.failing,
      selection: candidateSelection(f.failing),
      databasePath: f.databasePath,
      running: false,
    })
  } finally {
    vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
  }
  expect(result).toMatchObject({ status: 'pending' })
  if (result.status !== 'pending') throw new Error('Expected an incomplete rollback')
  expect(String(result.cause)).toContain('EXDEV')
  expect(String(result.cause)).toContain('No database existed before the update')
  // It was detached from its WAL before the rename, so it remains one complete file.
  for (const suffix of ['-wal', '-shm']) expect(existsSync(f.databasePath + suffix)).toBe(false)
  expect(integrity(f.databasePath)).toBe('ok')
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(existsSync(f.databasePath)).toBe(false)
  expect(existsSync(f.selection)).toBe(false)
  expect(preservedDatabases(f.directory).map(documentValue)).toEqual(['written by candidate'])
})

it('never partially overwrites the database when the restore fails midway', async () => {
  const f = await fixture()
  grow(f.databasePath)
  interruptRestore(f.databasePath, () => {
    throw Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' })
  })
  const result = await activateSourceRelease(f.directory, {
    id: 'disk-full',
    entrypoint: f.failing,
    selection: candidateSelection(f.failing),
    databasePath: f.databasePath,
    running: false,
  })
  vi.restoreAllMocks()
  expect(result).toMatchObject({ status: 'pending' })
  if (result.status !== 'pending') throw new Error('Expected an incomplete rollback')
  expect(String(result.cause)).toContain('SQLITE_FULL')
  expect(String(result.cause)).toContain(
    `The pre-update database is retained at ${join(f.directory, 'backups', 'runtime-before-disk-full.sqlite')}`,
  )
  // The restore is one SQLite transaction: the candidate database is whole and still selected.
  expect(integrity(f.databasePath)).toBe('ok')
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(readRecord(f.record).phase).toBe('rolling-back')
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.selection)).toBe(false)
})

it('resumes a rollback whose updater crashed halfway through the database restore', async () => {
  const f = await fixture()
  grow(f.databasePath)
  const recovery = pathToFileURL(dist('server-update-recovery.js')).href
  const updater = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { createRequire } from 'node:module'
const Database = createRequire(createRequire(${JSON.stringify(recovery)}).resolve('@dovo/runtime'))('better-sqlite3')
const backup = Database.prototype.backup
Database.prototype.backup = function (path, options) {
  if (path !== ${JSON.stringify(f.databasePath)}) return backup.call(this, path, options)
  return backup.call(this, path, { progress: ({ totalPages, remainingPages }) => {
    if (remainingPages < totalPages / 2) process.kill(process.pid, 'SIGKILL')
    return 50
  } })
}
const { activateSourceRelease } = await import(${JSON.stringify(recovery)})
await activateSourceRelease(${JSON.stringify(f.directory)}, ${JSON.stringify({
        id: 'crashed-restore',
        entrypoint: f.failing,
        selection: candidateSelection(f.failing),
        databasePath: f.databasePath,
        running: false,
      })})
process.exit(0)`,
    ],
    { stdio: 'ignore' },
  )
  children.push(updater)
  const signal = await new Promise((resolve) =>
    updater.once('exit', (_code, signal) => resolve(signal)),
  )
  expect(signal).toBe('SIGKILL')
  expect(readRecord(f.record).phase).toBe('rolling-back')
  expect(integrity(f.databasePath)).toBe('ok')
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({ outcome: 'rolled-back' })
  expect(integrity(f.databasePath)).toBe('ok')
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(existsSync(f.selection)).toBe(false)
  expect(existsSync(f.record)).toBe(false)
})

/** A migrated database, its verified pre-update backup and a record in `phase`. */
function interruptedState(
  f: Awaited<ReturnType<typeof fixture>>,
  phase: 'activating' | 'rolling-back',
  mode: 'managed' | 'service',
) {
  const backup = join(f.directory, 'backups', 'runtime-before-boot.sqlite')
  files.mkdirSync(join(f.directory, 'backups'), { recursive: true })
  const db = new DatabaseSync(f.databasePath)
  db.exec(`VACUUM INTO '${backup}'`)
  db.exec("UPDATE documents SET value = 'written by candidate'")
  db.close()
  writeFileSync(f.selection, candidateSelection(f.failing))
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'boot',
      phase,
      mode,
      entrypoint: f.failing,
      selection: { previous: previousSelection, candidate: candidateSelection(f.failing) },
      database: { path: f.databasePath, backup },
      candidates: [],
    }),
  )
}

it('finishes a decided rollback before the service manager launches anything', async () => {
  const f = await fixture()
  interruptedState(f, 'rolling-back', 'service')
  await expect(prepareLaunch(f.directory)).resolves.toBe(false)
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(readFileSync(f.selection, 'utf8')).toBe(previousSelection)
  expect(existsSync(f.record)).toBe(false)
  expect(preservedDatabases(f.directory).map(documentValue)).toEqual(['written by candidate'])
})

it('commits a boot-launched candidate once healthy, or rolls it back on the next launch', async () => {
  const f = await fixture()
  interruptedState(f, 'activating', 'service')
  await expect(prepareLaunch(f.directory)).resolves.toBe(true)
  expect(settleLaunch(f.directory, true)).toEqual([])
  expect(existsSync(f.record)).toBe(false)
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(documentValue(f.databasePath)).toBe('written by candidate')

  const failed = await fixture()
  interruptedState(failed, 'activating', 'service')
  await expect(prepareLaunch(failed.directory)).resolves.toBe(true)
  settleLaunch(failed.directory, false)
  expect(readRecord(failed.record).phase).toBe('rolling-back')
  // The restarted service restores the previous release instead of retrying the candidate.
  await expect(prepareLaunch(failed.directory)).resolves.toBe(false)
  expect(documentValue(failed.databasePath)).toBe('before update')
  expect(readFileSync(failed.selection, 'utf8')).toBe(previousSelection)
})

it('leaves the record to the server command that is driving a service launch', async () => {
  const f = await fixture()
  interruptedState(f, 'rolling-back', 'service')
  const release = acquireProcessLock(join(f.directory, 'server-operation.lock'))
  try {
    await expect(prepareLaunch(f.directory)).resolves.toBe(false)
    expect(settleLaunch(f.directory, false)).toEqual([])
  } finally {
    release()
  }
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(f.failing))
  expect(readRecord(f.record).phase).toBe('rolling-back')
})

/** The built service launcher, as systemd or launchd runs it. */
function serviceRun(directory: string) {
  const child = spawn(
    process.execPath,
    [dist('server-cli.js'), 'service', 'run', '--data-dir', directory],
    { stdio: 'ignore' },
  )
  children.push(child)
  return {
    child,
    exit: new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code))),
  }
}
function bootState(
  f: Awaited<ReturnType<typeof fixture>>,
  candidate: string,
  previous: string | null,
) {
  const backup = join(f.directory, 'backups', 'runtime-before-boot.sqlite')
  files.mkdirSync(join(f.directory, 'backups'), { recursive: true })
  const db = new DatabaseSync(f.databasePath)
  db.exec(`VACUUM INTO '${backup}'`)
  db.close()
  writeFileSync(f.selection, candidateSelection(candidate))
  writeFileSync(
    f.record,
    JSON.stringify({
      version: 1,
      id: 'boot',
      phase: 'activating',
      mode: 'service',
      entrypoint: candidate,
      selection: { previous, candidate: candidateSelection(candidate) },
      database: { path: f.databasePath, backup },
      candidates: [],
    }),
  )
}

it('commits an interrupted update once its boot-launched release is healthy', async () => {
  const f = await fixture()
  bootState(f, dist('index.js'), null)
  const service = serviceRun(f.directory)
  await waitFor(() => !existsSync(f.record), 'the boot launch to commit the update')
  expect(await serverStatus(f.directory)).toMatchObject({ running: true })
  service.child.kill('SIGTERM')
  expect(await service.exit).toBe(0)
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(dist('index.js')))
})

it('restores the previous release on the next boot launch after the candidate fails', async () => {
  const f = await fixture()
  const marker = join(f.directory, 'previous-ran')
  const previous = join(f.directory, 'previous-release.mjs')
  writeFileSync(
    previous,
    `import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.env.DOVO_DATABASE_PATH, { readOnly: true })
writeFileSync(${JSON.stringify(marker)}, db.prepare("SELECT value FROM documents WHERE id = 'fixture'").get().value)
db.close()`,
  )
  bootState(f, f.failing, candidateSelection(previous))
  const first = serviceRun(f.directory)
  expect(await first.exit).toBe(1)
  expect(readRecord(f.record).phase).toBe('rolling-back')
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  // The service manager restarts the launcher, which restores before launching anything.
  const second = serviceRun(f.directory)
  expect(await second.exit).toBe(0)
  expect(readFileSync(marker, 'utf8')).toBe('before update')
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(previous))
  expect(existsSync(f.record)).toBe(false)
  expect(preservedDatabases(f.directory).map(documentValue)).toEqual(['written by candidate'])
})

it('admits only the recorded candidate until an interrupted update is resolved', async () => {
  const f = await fixture()
  interruptedState(f, 'activating', 'managed')
  expect(() => assertLaunchAllowed(f.directory, f.failing)).not.toThrow()
  expect(() => assertLaunchAllowed(f.directory, dist('index.js'))).toThrow(
    'Only the release being verified may open the database',
  )
  // Even before the selection switch, the database belongs to the activation.
  writeFileSync(f.selection, previousSelection)
  expect(() => assertLaunchAllowed(f.directory, dist('index.js'))).toThrow('Only the release')
  const record = readRecord(f.record)
  writeFileSync(f.record, JSON.stringify({ ...record, phase: 'prepared' }))
  expect(() => assertLaunchAllowed(f.directory, f.failing)).toThrow(
    'An update stopped this runtime',
  )
  writeFileSync(f.record, JSON.stringify({ ...record, phase: 'rolling-back' }))
  writeFileSync(f.selection, candidateSelection(f.failing))
  expect(() => assertLaunchAllowed(f.directory, f.failing)).toThrow('being restored')
  // Reselection follows the restore, so only the record's removal remains.
  writeFileSync(f.selection, previousSelection)
  expect(() => assertLaunchAllowed(f.directory, dist('index.js'))).not.toThrow()
  writeFileSync(f.record, JSON.stringify({ ...record, phase: 'committed' }))
  expect(() => assertLaunchAllowed(f.directory, dist('index.js'))).not.toThrow()
  writeFileSync(f.record, '{')
  expect(() => assertLaunchAllowed(f.directory, f.failing)).toThrow('Invalid server update record')
})

it('stops a directly launched runtime before it opens the database during a rollback', async () => {
  const f = await fixture()
  interruptedState(f, 'rolling-back', 'managed')
  const runtime = spawn(process.execPath, [dist('index.js')], {
    env: {
      ...process.env,

      DOVO_DATABASE_PATH: f.databasePath,
      DOVO_HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  children.push(runtime)
  let stderr = ''
  runtime.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
  const code = await new Promise((resolve) => runtime.once('exit', resolve))
  expect(code).toBe(1)
  expect(stderr).toContain('The database is being restored to its pre-update state')
  expect(existsSync(join(f.directory, 'runtime-connection.json'))).toBe(false)
  expect(documentValue(f.databasePath)).toBe('written by candidate')
  // Recovery still finishes normally afterwards.
  await expect(recoverServerUpdate(f.directory)).resolves.toMatchObject({
    outcome: 'rolled-back',
  })
  expect(documentValue(f.databasePath)).toBe('before update')
})

/** A source update whose service start fails or succeeds as `fault` decides, in service mode. */
async function serviceActivation(
  f: Awaited<ReturnType<typeof fixture>>,
  fault: (path: string) => boolean,
  call: 'rmSync' | 'renameSync',
) {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  let starts = 0
  const service = {
    stop: async () => {},
    start: async () => {
      starts++
      if (starts > 1) return
      // Only completion writes fail: the release itself started and is healthy.
      if (call === 'rmSync')
        vi.mocked(files.rmSync).mockImplementation((path, options) => {
          if (fault(String(path)))
            throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
          actual.rmSync(path, options)
        })
      else
        vi.mocked(files.renameSync).mockImplementation((from, to) => {
          if (fault(String(to)))
            throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
          actual.renameSync(from, to)
        })
    },
  }
  try {
    const result = await activateSourceRelease(f.directory, {
      id: 'commit-order',
      entrypoint: f.failing,
      selection: candidateSelection(f.failing),
      databasePath: f.databasePath,
      running: false,
      service,
    })
    return { result, service, starts: () => starts }
  } finally {
    vi.mocked(files.rmSync).mockImplementation(actual.rmSync)
    vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
  }
}

it('records completion durably before removing the record', async () => {
  const f = await fixture()
  const removal = await serviceActivation(f, (path) => path === f.record, 'rmSync')
  expect(removal.result).toEqual({
    status: 'active',
    backupPath: join(f.directory, 'backups', 'runtime-before-commit-order.sqlite'),
    warnings: [],
  })
  // A lost removal leaves only the completion marker, which recovery clears without restarting.
  expect(readRecord(f.record).phase).toBe('committed')
  expect(() => assertLaunchAllowed(f.directory, dist('index.js'))).not.toThrow()
  await expect(recoverServerUpdate(f.directory, removal.service)).resolves.toMatchObject({
    outcome: 'completed',
  })
  expect(removal.starts()).toBe(1)
  expect(existsSync(f.record)).toBe(false)

  const marker = await fixture()
  const missing = await serviceActivation(marker, (path) => path === marker.record, 'renameSync')
  // Without a marker, the durable removal is the commit.
  expect(missing.result).toMatchObject({ status: 'active', warnings: [] })
  expect(existsSync(marker.record)).toBe(false)
})

it('never lets snapshot cleanup hide the snapshot result', async () => {
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const f = await fixture()
  const staged = join(f.directory, 'backups', 'runtime-before-commit-order.sqlite.partial')
  // A published snapshot stays a success when only its staging leftovers cannot be removed.
  const published = await (async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(files.rmSync).mockImplementation((path, options) => {
      if (String(path) === staged)
        throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      actual.rmSync(path, options)
    })
    try {
      return await activateSourceRelease(f.directory, {
        id: 'commit-order',
        entrypoint: f.failing,
        selection: candidateSelection(f.failing),
        databasePath: f.databasePath,
        running: false,
        service: { stop: async () => {}, start: async () => {} },
      })
    } finally {
      vi.mocked(files.rmSync).mockImplementation(actual.rmSync)
    }
  })()
  expect(published).toMatchObject({ status: 'active' })
  expect(warnings).toHaveBeenCalledWith(
    expect.stringContaining('inert staging files remain'),
    expect.any(Error),
  )

  // A failed snapshot keeps its own error even when the staged copy cannot be removed.
  const unverified = await fixture({ database: false })
  const db = new DatabaseSync(unverified.databasePath)
  db.exec('CREATE TABLE unrelated (value TEXT)')
  db.close()
  const unverifiedStaged = join(
    unverified.directory,
    'backups',
    'runtime-before-masked.sqlite.partial',
  )
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  vi.mocked(files.rmSync).mockImplementation((path, options) => {
    if (String(path) === unverifiedStaged)
      throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
    actual.rmSync(path, options)
  })
  const failed = await activateSourceRelease(unverified.directory, {
    id: 'masked',
    entrypoint: unverified.failing,
    selection: candidateSelection(unverified.failing),
    databasePath: unverified.databasePath,
    running: false,
  }).finally(() => vi.mocked(files.rmSync).mockImplementation(actual.rmSync))
  expect(failed).toMatchObject({ status: 'not-started' })
  if (failed.status !== 'not-started') throw new Error('Expected activation not to start')
  expect(String(failed.error)).toContain('not a Dovo runtime database')
  expect(String(failed.error)).toContain('could not be removed')
  expect(existsSync(unverified.selection)).toBe(false)
})

it('refuses runtime launches while a running server command prepares or rolls back', async () => {
  for (const phase of ['prepared', 'rolling-back'] as const) {
    const f = await fixture()
    // The launched selection is a real runtime, so its own startup check decides.
    const runtime = candidateSelection(dist('index.js'))
    writeFileSync(f.selection, runtime)
    writeFileSync(
      f.record,
      JSON.stringify({
        version: 1,
        id: phase,
        phase,
        mode: 'service',
        entrypoint: f.failing,
        selection:
          phase === 'prepared'
            ? { previous: runtime, candidate: candidateSelection(f.failing) }
            : { previous: previousSelection, candidate: runtime },
        database: { path: f.databasePath, backup: null },
        candidates: [],
      }),
    )
    const release = acquireProcessLock(join(f.directory, 'server-operation.lock'))
    try {
      // An automatic restart while the command holds the lock never opens the database.
      const service = serviceRun(f.directory)
      expect(await service.exit).toBe(1)
    } finally {
      release()
    }
    expect(existsSync(join(f.directory, 'runtime-connection.json'))).toBe(false)
    expect(readRecord(f.record).phase).toBe(phase)
    expect(documentValue(f.databasePath)).toBe('before update')
  }
})

/**
 * Runs a service-mode activation in an updater process holding the operation lock, as the CLI
 * does, with a detached launcher standing in for systemd or launchd. The updater is killed as
 * soon as the service has been started.
 */
async function interruptedServiceUpdate(
  f: Awaited<ReturnType<typeof fixture>>,
  entrypoint: string,
) {
  const url = (name: string) => JSON.stringify(pathToFileURL(dist(name)).href)
  const updater = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { activateSourceRelease } from ${url('server-update-recovery.js')}
import { serverStatus } from ${url('server-manager.js')}
import { acquireProcessLock } from ${url('process-lock.js')}
const directory = ${JSON.stringify(f.directory)}
acquireProcessLock(join(directory, 'server-operation.lock'))
let launcher
const service = {
  stop: async () => {
    if (!launcher || launcher.exitCode !== null || launcher.signalCode !== null) return
    launcher.kill('SIGTERM')
    await new Promise((resolve) => launcher.once('exit', resolve))
  },
  start: async () => {
    launcher = spawn(process.execPath, [${JSON.stringify(dist('server-cli.js'))}, 'service', 'run', '--data-dir', directory], { detached: true, stdio: 'ignore' })
    writeFileSync(join(directory, 'service.pid'), String(launcher.pid))
    for (;;) {
      if (launcher.exitCode !== null) throw new Error('The service exited during startup')
      if ((await serverStatus(directory).catch(() => undefined))?.running) return
      await delay(100)
    }
  },
}
setInterval(() => { if (existsSync(join(directory, 'service.pid'))) process.kill(process.pid, 'SIGKILL') }, 5)
await activateSourceRelease(directory, { ...${JSON.stringify({
        id: 'service-update',
        entrypoint,
        selection: candidateSelection(entrypoint),
        databasePath: f.databasePath,
        running: false,
      })}, service })
process.exit(0)`,
    ],
    { stdio: 'ignore' },
  )
  children.push(updater)
  expect(
    await new Promise((resolve) => updater.once('exit', (_code, signal) => resolve(signal))),
  ).toBe('SIGKILL')
  const launcher = Number(readFileSync(join(f.directory, 'service.pid'), 'utf8'))
  return {
    launcher,
    /** The service manager's stop at shutdown: the launcher forwards it and waits. */
    stop: async () => {
      if (processExists(launcher)) process.kill(launcher, 'SIGTERM')
      await waitFor(() => !processExists(launcher), `service launcher ${launcher} to stop`)
    },
  }
}

it('commits a service update whose updater died once the service manager relaunches it', async () => {
  const f = await fixture()
  const service = await interruptedServiceUpdate(f, dist('index.js'))
  await service.stop()
  // Boot: the launcher resolves the interrupted update without a server command.
  const boot = serviceRun(f.directory)
  await waitFor(() => !existsSync(f.record), 'the relaunched service to commit the update')
  expect(await serverStatus(f.directory)).toMatchObject({ running: true })
  boot.child.kill('SIGTERM')
  expect(await boot.exit).toBe(0)
  expect(readFileSync(f.selection, 'utf8')).toBe(candidateSelection(dist('index.js')))
  expect(documentValue(f.databasePath)).toBe('before update')
})

it('restores the previous release when a service update fails after its updater died', async () => {
  const f = await fixture()
  const marker = join(f.directory, 'previous-ran')
  writeFileSync(
    join(f.directory, 'previous-release.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran')`,
  )
  writeFileSync(f.selection, candidateSelection(join(f.directory, 'previous-release.mjs')))
  const service = await interruptedServiceUpdate(f, f.failing)
  await service.stop()
  // The service manager keeps relaunching after failures until a launch exits cleanly.
  for (let launch = 0; launch < 4 && !existsSync(marker); launch++)
    await serviceRun(f.directory).exit
  expect(existsSync(marker)).toBe(true)
  expect(documentValue(f.databasePath)).toBe('before update')
  expect(readFileSync(f.selection, 'utf8')).toBe(
    candidateSelection(join(f.directory, 'previous-release.mjs')),
  )
  expect(existsSync(f.record)).toBe(false)
})

it.each(['committed', 'rolling-back'] as const)(
  'boots a completed packaged %s selection even when optional cleanup cannot write',
  async (phase) => {
    const f = await fixture()
    const previous = join(f.directory, 'old-launcher')
    writeFileSync(previous, '')
    const selected = phase === 'committed' ? f.failing : previous
    const publicLauncher = join(f.directory, 'public-launcher')
    const link = join(f.directory, 'service-launcher')
    files.symlinkSync(selected, publicLauncher)
    files.symlinkSync(selected, link)
    const record = JSON.stringify({ launcher: publicLauncher })
    writeFileSync(join(f.directory, 'server-service.json'), record)
    writeFileSync(
      f.record,
      JSON.stringify({
        version: 2,
        id: 'completed-cleanup',
        phase,
        mode: 'service',
        entrypoint: f.failing,
        selection: { previous: record, candidate: record },
        database: { path: f.databasePath, backup: null },
        candidates: [],
        packaged: { previous, candidate: f.failing, initial: publicLauncher },
      }),
    )
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(files.renameSync).mockImplementation((from, to) => {
      if (String(to) === link)
        throw Object.assign(new Error('read-only launcher directory'), { code: 'EROFS' })
      actual.renameSync(from, to)
    })
    vi.mocked(files.rmSync).mockImplementation((path, options) => {
      if (String(path) === f.record)
        throw Object.assign(new Error('read-only update record'), { code: 'EROFS' })
      actual.rmSync(path, options)
    })
    try {
      await expect(prepareLaunch(f.directory)).resolves.toBe(false)
      expect(() => assertLaunchAllowed(f.directory, '/selected/runtime.js')).not.toThrow()
      expect(readRecord(f.record).phase).toBe(phase)
      expect(files.readlinkSync(link)).toBe(selected)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('launcher cleanup failed'))
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('update-record cleanup failed'))
    } finally {
      vi.mocked(files.renameSync).mockImplementation(actual.renameSync)
      vi.mocked(files.rmSync).mockImplementation(actual.rmSync)
    }
  },
)
