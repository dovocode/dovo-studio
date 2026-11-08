import { backupRuntimeDatabase, verifyRuntimeBackup } from '@dovo/runtime'
import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { dirname, join, resolve } from 'node:path'
import { readConnection } from './connection.js'
import { acquireProcessLock } from './process-lock.js'
import { serverStatus, startServer, stopServer } from './server-manager.js'

// The runtime's own SQLite binding: one SQLite library per process keeps POSIX locks coherent.
// node:sqlite is not used because its backup completion does not wake a busy event loop.
export interface ServiceControls {
  stop: () => Promise<void>
  start: () => Promise<void>
}
/**
 * Durable intent for one release activation. The selection switches only after the
 * database snapshot is durable, and reverts only after the database is restored, so the
 * selection file shows which side of each boundary an interrupted attempt reached.
 */
const updateTransactionSchema = mutableStruct({
  version: Schema.Literals([1, 2]),
  id: Schema.String,
  phase: Schema.Literals(['prepared', 'activating', 'rolling-back', 'committed']),
  mode: Schema.Literals(['managed', 'service']),
  entrypoint: Schema.String,
  selection: mutableStruct({ previous: Schema.NullOr(Schema.String), candidate: Schema.String }),
  /** `backup` is null when no database existed before the update. */
  database: mutableStruct({ path: Schema.String, backup: Schema.NullOr(Schema.String) }),
  /** Managed candidates are recorded before they are admitted to open the database. */
  candidates: mutableArray(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  /** Packages select an immutable launcher; the service record retains the package-manager path. */
  expectedVersion: Schema.optional(Schema.String),
  packaged: Schema.optional(
    mutableStruct({
      previous: Schema.String,
      candidate: Schema.NullOr(Schema.String),
      initial: Schema.String,
    }),
  ),
})
type UpdateTransaction = Schema.Schema.Type<typeof updateTransactionSchema>
export type ActivationResult =
  | { status: 'active'; backupPath?: string; warnings: string[] }
  | { status: 'not-started'; error: unknown; warnings: string[] }
  | { status: 'rolled-back'; error: unknown; preserved?: string; warnings: string[] }
  | { status: 'pending'; error: unknown; cause: unknown }
const recordPath = (directory: string) => join(directory, 'server-update-transaction.json')
const selectionPath = (directory: string) => join(directory, 'server-release.json')
const backupPath = (directory: string, id: string) =>
  join(directory, 'backups', `runtime-before-${id}.sqlite`)
// Rollback keeps the database it replaces, including data a candidate accepted.
const preservedPath = (directory: string, id: string) =>
  join(directory, 'backups', `runtime-before-rollback-${id}-${randomUUID().slice(0, 8)}.sqlite`)
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const code = (error: unknown) =>
  error instanceof Error && 'code' in error ? error.code : undefined

function syncDirectory(directory: string) {
  // Windows cannot open a directory for fsync; NTFS journals the rename itself.
  if (process.platform === 'win32') return
  const descriptor = openSync(directory, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
function syncFile(path: string) {
  const descriptor = openSync(path, 'r+')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
/** Replace or remove a small private file; the change survives power loss once this returns. */
function writeDurably(path: string, content: string | null) {
  if (content === null) rmSync(path, { force: true })
  else {
    const temporary = `${path}.${process.pid}.tmp`
    try {
      const descriptor = openSync(temporary, 'w', 0o600)
      try {
        fchmodSync(descriptor, 0o600)
        writeFileSync(descriptor, content)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporary, path)
    } catch (error) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        // The write error explains the failure; a leftover temporary file is inert.
      }
      throw error
    }
  }
  syncDirectory(dirname(path))
}
function readText(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (code(error) === 'ENOENT') return null
    throw error
  }
}
function readTransaction(directory: string) {
  const path = recordPath(directory)
  const text = readText(path)
  if (text === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = undefined
  }
  const parsed = decodeResult(updateTransactionSchema, value)
  if (!parsed.success || (parsed.data.version === 2) !== !!parsed.data.packaged)
    throw new Error(
      `Invalid server update record: ${path}. Compare it with server-release.json and the backups directory before removing it.`,
    )
  return parsed.data
}
const save = (directory: string, transaction: UpdateTransaction) =>
  writeDurably(recordPath(directory), JSON.stringify(transaction, null, 2) + '\n')

function launcherSelection(directory: string) {
  const path = join(directory, 'service-launcher')
  return resolve(dirname(path), readlinkSync(path))
}
function writeLauncher(directory: string, launcher: string, record: string) {
  // The symlink is the commit marker. Persist metadata first; recovery repairs a torn pair.
  writeDurably(join(directory, 'server-service.json'), record)
  const path = join(directory, 'service-launcher')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    symlinkSync(launcher, temporary)
    renameSync(temporary, path)
    syncDirectory(directory)
  } finally {
    rmSync(temporary, { force: true })
  }
}
function checkServiceRecord(directory: string, transaction: UpdateTransaction) {
  const current = readText(join(directory, 'server-service.json'))
  if (current !== transaction.selection.previous && current !== transaction.selection.candidate)
    throw new Error(
      `server-service.json changed outside interrupted update ${transaction.id}. Inspect the update record before recovery.`,
    )
}
function readSelection(directory: string, transaction: UpdateTransaction) {
  if (!transaction.packaged) return readText(selectionPath(directory))
  checkServiceRecord(directory, transaction)
  const launcher = realpathSync(join(directory, 'service-launcher'))
  if (launcher === transaction.packaged.candidate) return launcher
  if (launcher === transaction.packaged.previous) return launcher
  throw new Error(
    `service-launcher changed outside interrupted update ${transaction.id}. Inspect the update record before recovery.`,
  )
}
function releaseSelected(directory: string, transaction: UpdateTransaction, previous: boolean) {
  const selection = transaction.packaged
    ? previous
      ? transaction.packaged.previous
      : transaction.packaged.candidate
    : previous
      ? transaction.selection.previous
      : transaction.selection.candidate
  return readSelection(directory, transaction) === selection
}
function selectRelease(directory: string, transaction: UpdateTransaction, previous: boolean) {
  const selection = previous ? transaction.selection.previous : transaction.selection.candidate
  if (!transaction.packaged) return writeDurably(selectionPath(directory), selection)
  const launcher = previous ? transaction.packaged.previous : transaction.packaged.candidate
  if (!launcher || selection === null) throw new Error('Incomplete packaged release selection')
  writeLauncher(directory, launcher, selection)
}

/** Only ESRCH proves exit. Unix also checks the detached launch group. */
function exited(pid: number) {
  for (const target of process.platform === 'win32' ? [pid] : [pid, -pid]) {
    try {
      process.kill(target, 0)
      return false
    } catch (error) {
      if (code(error) !== 'ESRCH') return false
    }
  }
  return true
}
function removeStaged(path: string) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(path + suffix, { force: true })
}
/** Publish a copy, including committed WAL contents, only once it is complete and durable. */
async function publishSnapshot(source: string, destination: string, verify: boolean) {
  // Snapshot paths are operation-owned; never replace a backup that already exists.
  if (existsSync(destination)) throw new Error(`Refusing to replace existing backup ${destination}`)
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const staged = `${destination}.partial`
  try {
    await backupRuntimeDatabase(source, staged)
    // The copied header keeps the WAL marker; publish one self-contained file instead.
    const copy = new Database(staged, { fileMustExist: true })
    try {
      if (copy.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
        throw new Error(`Could not detach ${staged} from its WAL.`)
    } finally {
      copy.close()
    }
    if (verify) verifyRuntimeBackup(staged)
    syncFile(staged)
    renameSync(staged, destination)
  } catch (error) {
    // The staged copy is operation-owned. Its cleanup must not replace the original failure.
    try {
      removeStaged(staged)
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        `${message(error)}. The staged copy ${staged} could not be removed.`,
      )
    }
    throw error
  }
  syncDirectory(dirname(destination))
  try {
    // Leftovers beside the published name are inert; they never make the snapshot a failure.
    removeStaged(staged)
  } catch (error) {
    console.warn(
      `Snapshot published at ${destination}; inert staging files remain at ${staged}.`,
      error,
    )
  }
}
/**
 * Return the database to its pre-update state. The caller holds the runtime lock and has
 * confirmed the candidate stopped. Each change is atomic, so an interrupted restore leaves
 * either the candidate database or the restored one, and repeating it is safe.
 */
async function restoreDatabase(path: string, backup: string | null, preserved: string) {
  if (backup) verifyRuntimeBackup(backup)
  const existed = existsSync(path)
  if (!existed)
    for (const suffix of ['-wal', '-journal'])
      if (existsSync(path + suffix))
        throw new Error(
          `${path + suffix} exists without its database. Move it aside before recovery; SQLite would apply it to a new database.`,
        )
  if (!backup) {
    if (!existed) return undefined
    // The candidate created this database. Fold its WAL into one file and move that file in a
    // single rename; deleting the files separately could strand a WAL for SQLite to replay.
    const database = new Database(path, { fileMustExist: true })
    try {
      if (database.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
        throw new Error(`Could not detach ${path} from its WAL.`)
    } finally {
      database.close()
    }
    mkdirSync(dirname(preserved), { recursive: true, mode: 0o700 })
    renameSync(path, preserved)
    // Without a WAL, the shared-memory index is only a cache.
    rmSync(path + '-shm', { force: true })
    syncDirectory(dirname(path))
    syncDirectory(dirname(preserved))
    return preserved
  }
  if (existed) await publishSnapshot(path, preserved, false)
  // SQLite's backup API writes the whole snapshot as one transaction into the live database and
  // its WAL. A crash before commit leaves the current database intact; there is no file swap.
  else closeSync(openSync(path, 'wx', 0o600))
  const source = new Database(backup, { readonly: true, fileMustExist: true })
  try {
    await source.backup(path)
  } finally {
    source.close()
  }
  verifyRuntimeBackup(path)
  return existed ? preserved : undefined
}
/**
 * Every runtime launcher, of any version, takes this lock before opening the database. Holding
 * it from the old runtime's stop until the candidate starts keeps the snapshot current and the
 * selection switch unobserved.
 */
export function holdRuntimeDatabase(databasePath: string) {
  return acquireProcessLock(join(dirname(databasePath), 'runtime-process.lock'))
}
/** Publish a verified pre-update snapshot; returns false when no database exists yet. */
export async function snapshotUpdateDatabase(databasePath: string, destination: string) {
  if (!existsSync(databasePath)) return false
  await publishSnapshot(databasePath, destination, true)
  return true
}
/**
 * Restore the pre-update database, then reselect the previous release, while holding the lock
 * every runtime launcher takes before opening the database. Returns the replaced database.
 */
export async function restorePreviousRelease(
  databasePath: string,
  backup: string | null,
  preserved: string,
  reselect: () => void | Promise<void>,
) {
  const release = holdRuntimeDatabase(databasePath)
  try {
    const kept = await restoreDatabase(databasePath, backup, preserved)
    // Until reselection, launchers still start the candidate, which accepts either database.
    await reselect()
    return kept
  } finally {
    release()
  }
}
async function verifyCandidate(directory: string, transaction: UpdateTransaction) {
  if (!transaction.expectedVersion) return
  const connection = readConnection(join(directory, 'runtime-connection.json'))
  const response = await fetch(`${connection.address}/api/snapshot?scope=overview`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('Updated server did not respond')
  const value: unknown = await response.json()
  if (
    !value ||
    typeof value !== 'object' ||
    !('releaseVersion' in value) ||
    value.releaseVersion !== transaction.expectedVersion
  )
    throw new Error(`Server did not restart with expected release ${transaction.expectedVersion}`)
}
/** Boot launches perform the same durable version check as the interrupted updater. */
export async function verifyPendingLaunch(directory: string) {
  const transaction = readTransaction(directory)
  if (transaction?.phase === 'activating') await verifyCandidate(directory, transaction)
}
async function startCandidate(
  directory: string,
  transaction: UpdateTransaction,
  service?: ServiceControls,
) {
  if (service) {
    await service.start()
    await verifyCandidate(directory, transaction)
    return
  }
  await startServer(directory, transaction.entrypoint, (pid) => {
    transaction.candidates.push(pid)
    save(directory, transaction)
  })
}
/** Return to a manager-owned path only when it still selects the verified release. */
function restorePublicLauncher(
  directory: string,
  transaction: UpdateTransaction,
  previous: boolean,
) {
  if (!transaction.packaged) return []
  const record = previous ? transaction.selection.previous : transaction.selection.candidate
  const pinned = previous ? transaction.packaged.previous : transaction.packaged.candidate
  if (record === null) throw new Error('Missing packaged service record')
  const value: unknown = JSON.parse(record)
  if (
    !value ||
    typeof value !== 'object' ||
    !('launcher' in value) ||
    typeof value.launcher !== 'string'
  )
    throw new Error('Invalid packaged service record in update transaction')
  try {
    if (realpathSync(value.launcher) !== pinned)
      return [
        `The service retains release ${pinned}. Its package-manager path selects another release; keep the retained package installed until a service update succeeds.`,
      ]
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    return [
      `The service retains release ${pinned}; its package-manager launcher is missing. Keep the retained package installed.`,
    ]
  }
  writeLauncher(directory, value.launcher, record)
  return []
}
function commit(directory: string, transaction: UpdateTransaction) {
  const path = recordPath(directory)
  try {
    // The completion marker is durable before removal: a removal lost to a crash or power loss
    // can then only leave this marker, never an 'activating' record that recovery re-verifies.
    save(directory, { ...transaction, phase: 'committed' })
  } catch (error) {
    try {
      writeDurably(path, null)
      try {
        return restorePublicLauncher(directory, transaction, false)
      } catch (cleanup) {
        return [`The release is active, but launcher cleanup failed: ${message(cleanup)}`]
      }
    } catch (removal) {
      return [
        `The new release is active, but its completion could not be recorded durably (${message(error)}; ${message(removal)}). Until ${path} is removed, recovery verifies this release again before any start.`,
      ]
    }
  }
  let warnings: string[]
  try {
    warnings = restorePublicLauncher(directory, transaction, false)
  } catch (error) {
    return [`The release is active, but launcher cleanup is pending: ${message(error)}`]
  }
  try {
    writeDurably(path, null)
  } catch {
    /* The durable completion marker is cleared by the next recovery. */
  }
  return warnings
}
async function rollBack(
  directory: string,
  transaction: UpdateTransaction,
  service?: ServiceControls,
) {
  const warnings: string[] = []
  if (transaction.phase !== 'rolling-back') {
    transaction.phase = 'rolling-back'
    try {
      save(directory, transaction)
    } catch (error) {
      // Each step below is idempotent and the selection still marks progress.
      warnings.push(`The rollback decision could not be recorded: ${message(error)}`)
    }
  }
  if (service) await service.stop()
  else {
    const status = await serverStatus(directory)
    if (status.running && status.pid !== undefined && transaction.candidates.includes(status.pid))
      await stopServer(directory)
  }
  // A free lock does not prove that a recorded candidate cannot still open the database.
  const alive = transaction.candidates.filter((pid) => !exited(pid))
  if (alive.length)
    throw new Error(
      `Candidate process ${alive.join(', ')} or its process group has not exited, so the database was not restored. Stop it, then run pnpm server start to finish the rollback.`,
    )
  const preserved = await restorePreviousRelease(
    transaction.database.path,
    transaction.database.backup,
    preservedPath(directory, transaction.id),
    () => selectRelease(directory, transaction, true),
  )
  try {
    warnings.push(...restorePublicLauncher(directory, transaction, true))
    writeDurably(recordPath(directory), null)
  } catch (error) {
    // The restored selection marks the rollback complete for the next recovery.
    warnings.push(
      `The rollback finished, but ${recordPath(directory)} could not be removed: ${message(error)}`,
    )
  }
  return { preserved, warnings }
}
function pending(transaction: UpdateTransaction, directory: string, cause: unknown) {
  const retained = transaction.database.backup
    ? `The pre-update database is retained at ${transaction.database.backup}`
    : 'No database existed before the update'
  return new Error(
    `Update ${transaction.id} could not be rolled back: ${message(cause)} ${retained}; ${recordPath(directory)} keeps the rollback pending.`,
    { cause },
  )
}

/** Stop the previous runtime, snapshot its database, then select, start and verify the release. */
export async function activateSourceRelease(
  directory: string,
  options: {
    id: string
    entrypoint: string
    selection: string
    databasePath: string
    running: boolean
    service?: ServiceControls
  },
): Promise<ActivationResult> {
  const { id, service } = options
  const transaction: UpdateTransaction = {
    version: 1,
    id,
    phase: 'prepared',
    mode: service ? 'service' : 'managed',
    entrypoint: options.entrypoint,
    selection: { previous: readText(selectionPath(directory)), candidate: options.selection },
    database: { path: options.databasePath, backup: null },
    candidates: [],
  }
  save(directory, transaction)
  let held: (() => void) | undefined
  try {
    if (options.running) await (service ? service.stop() : stopServer(directory))
    held = holdRuntimeDatabase(options.databasePath)
    if (await snapshotUpdateDatabase(options.databasePath, backupPath(directory, id)))
      transaction.database.backup = backupPath(directory, id)
    transaction.phase = 'activating'
    save(directory, transaction)
  } catch (error) {
    held?.()
    // Nothing is selected or restored yet. A complete snapshot stays as an ordinary backup.
    const warnings = existsSync(backupPath(directory, id))
      ? [`The pre-update backup remains at ${backupPath(directory, id)}.`]
      : []
    try {
      writeDurably(recordPath(directory), null)
    } catch (cleanup) {
      // A stale prepared record keeps runtimes stopped until recovery clears it.
      warnings.push(
        `${recordPath(directory)} could not be removed: ${message(cleanup)}. Run pnpm server start to clear it.`,
      )
    }
    return { status: 'not-started', error, warnings }
  }
  try {
    writeDurably(selectionPath(directory), options.selection)
    // The candidate takes the lock itself; an admitted start rejects any other runtime.
    held?.()
    held = undefined
    await startCandidate(directory, transaction, service)
  } catch (error) {
    held?.()
    try {
      const { preserved, warnings } = await rollBack(directory, transaction, service)
      return { status: 'rolled-back', error, preserved, warnings }
    } catch (cause) {
      return { status: 'pending', error, cause: pending(transaction, directory, cause) }
    }
  }
  return {
    status: 'active',
    ...(transaction.database.backup ? { backupPath: transaction.database.backup } : {}),
    warnings: commit(directory, transaction),
  }
}

/** A package-manager operation can mutate its public symlink, so pin the old release first. */
export async function activatePackagedRelease(
  directory: string,
  options: {
    replacement: string
    expectedVersion?: string
    previous: string
    candidateRecord: string
    databasePath: string
    running: boolean
    service: ServiceControls
    prepare?: () => Promise<void>
    verify?: () => Promise<void>
  },
): Promise<ActivationResult> {
  if (readTransaction(directory))
    throw new Error('Finish the interrupted server update before starting another.')
  const previousRecord = readText(join(directory, 'server-service.json'))
  if (previousRecord === null) throw new Error('No registered service record')
  const packaged: NonNullable<UpdateTransaction['packaged']> = {
    previous: realpathSync(options.previous),
    candidate: null,
    initial: launcherSelection(directory),
  }
  const transaction: UpdateTransaction = {
    version: 2,
    id: randomUUID(),
    phase: 'prepared',
    mode: 'service',
    entrypoint: '',
    selection: { previous: previousRecord, candidate: options.candidateRecord },
    database: { path: options.databasePath, backup: null },
    candidates: [],
    packaged,
    ...(options.expectedVersion ? { expectedVersion: options.expectedVersion } : {}),
  }
  save(directory, transaction)
  let held: (() => void) | undefined
  let stopped = false
  const restartPrevious = async (warnings: string[]) => {
    if (!options.running || !stopped) return
    try {
      await options.service.start()
    } catch (error) {
      warnings.push(
        `The previous release is selected, but its service could not restart: ${message(error)}`,
      )
    }
  }
  try {
    await options.service.stop()
    stopped = true
    held = holdRuntimeDatabase(options.databasePath)
    // Pin before brew can replace the public launcher, including if this command is killed.
    selectRelease(directory, transaction, true)
    if (await snapshotUpdateDatabase(options.databasePath, backupPath(directory, transaction.id)))
      transaction.database.backup = backupPath(directory, transaction.id)
    await options.prepare?.()
    packaged.candidate = realpathSync(options.replacement)
    if (packaged.candidate === packaged.previous) {
      held()
      held = undefined
      const warnings = commit(directory, transaction)
      await options.service.start()
      await verifyCandidate(directory, transaction)
      await options.verify?.()
      return { status: 'active', warnings }
    }
    transaction.entrypoint = join(
      dirname(packaged.candidate),
      '..',
      'libexec',
      'server',
      'dist',
      'index.js',
    )
    transaction.phase = 'activating'
    save(directory, transaction)
    selectRelease(directory, transaction, false)
    held()
    held = undefined
    await options.service.start()
    await verifyCandidate(directory, transaction)
    await options.verify?.()
    return {
      status: 'active',
      ...(transaction.database.backup ? { backupPath: transaction.database.backup } : {}),
      warnings: commit(directory, transaction),
    }
  } catch (error) {
    held?.()
    try {
      // A prepared candidate was never admitted and cannot have migrated the database.
      if (transaction.phase === 'prepared') {
        selectRelease(directory, transaction, true)
        const warning = packagedServiceWarning(directory)
        const warnings = warning ? [warning] : []
        writeDurably(recordPath(directory), null)
        await restartPrevious(warnings)
        return { status: 'not-started', error, warnings }
      }
      const { preserved, warnings } = await rollBack(directory, transaction, options.service)
      await restartPrevious(warnings)
      return { status: 'rolled-back', error, preserved, warnings }
    } catch (cause) {
      return { status: 'pending', error, cause: pending(transaction, directory, cause) }
    }
  }
}

/** A completed selection stays bootable even when optional cleanup cannot write to disk. */
function cleanSettled(directory: string, transaction: UpdateTransaction, previous: boolean) {
  const warnings: string[] = []
  try {
    warnings.push(...restorePublicLauncher(directory, transaction, previous))
  } catch (error) {
    warnings.push(`The release is selected, but launcher cleanup failed: ${message(error)}`)
  }
  try {
    writeDurably(recordPath(directory), null)
  } catch (error) {
    warnings.push(`The release is selected, but update-record cleanup failed: ${message(error)}`)
  }
  return warnings
}
/** Finish records that need no process control; returns undefined when work remains. */
function settleRecorded(directory: string, transaction: UpdateTransaction) {
  const path = recordPath(directory)
  const { id } = transaction
  if (transaction.phase === 'committed') {
    return {
      id,
      outcome: 'completed' as const,
      warnings: cleanSettled(directory, transaction, false),
    }
  }
  if (transaction.phase === 'prepared') {
    // The previous runtime may be stopped, but no candidate could open the database.
    if (transaction.packaged) {
      checkServiceRecord(directory, transaction)
      const launcher = launcherSelection(directory)
      if (launcher !== transaction.packaged.previous && launcher !== transaction.packaged.initial)
        throw new Error(
          `service-launcher changed outside interrupted update ${id}. Inspect the update record before recovery.`,
        )
      selectRelease(directory, transaction, true)
    }
    removeStaged(`${backupPath(directory, id)}.partial`)
    // A killed updater can leave brew running. Keep the old immutable pin even if
    // the public path still points there now; brew may replace it after this check.
    const warning = transaction.packaged ? packagedServiceWarning(directory) : undefined
    const warnings = warning ? [warning] : []
    writeDurably(path, null)
    return { id, outcome: 'abandoned' as const, warnings }
  }
  if (releaseSelected(directory, transaction, false)) return undefined
  if (!releaseSelected(directory, transaction, true))
    throw new Error(
      `server-release.json changed outside interrupted update ${id}. Inspect it, ${path} and ${transaction.database.backup ?? 'the data directory'} before removing the record.`,
    )
  // Either the candidate was never selected, or its rollback already restored the database.
  if (
    transaction.packaged &&
    readText(join(directory, 'server-service.json')) !== transaction.selection.previous
  )
    selectRelease(directory, transaction, true)
  const warnings =
    transaction.phase === 'rolling-back'
      ? cleanSettled(directory, transaction, true)
      : restorePublicLauncher(directory, transaction, true)
  if (transaction.phase !== 'rolling-back') writeDurably(path, null)
  return {
    id,
    outcome: transaction.phase === 'activating' ? ('abandoned' as const) : ('rolled-back' as const),
    warnings,
  }
}
/** The lock held by every server command; undefined while one is running. */
function operationLock(directory: string) {
  try {
    return acquireProcessLock(join(directory, 'server-operation.lock'))
  } catch (error) {
    if (message(error).startsWith('Another runtime operation is active')) return undefined
    throw error
  }
}
// A service launcher has started nothing yet; the service manager already stopped earlier runs.
const idleService: ServiceControls = { stop: async () => {}, start: async () => {} }

/**
 * For launches that no server command is driving, such as the service manager at boot. A
 * decided rollback finishes before the selected release starts. Returns true when that release
 * is an unverified candidate; the launcher then reports its outcome with `settleLaunch`.
 */
export async function prepareLaunch(directory: string) {
  if (!existsSync(recordPath(directory))) return false
  const release = operationLock(directory)
  // The command holding the lock started this launch and resolves the record itself.
  if (!release) return false
  try {
    const transaction = readTransaction(directory)
    if (transaction && process.env.DOVO_SERVER_DISTRIBUTION === 'archive' && !transaction.packaged)
      throw new Error(
        'This data directory has an interrupted source update. Finish it from that source checkout before starting the packaged service.',
      )
    if (!transaction) return false
    const settled = settleRecorded(directory, transaction)
    if (settled) {
      for (const warning of settled.warnings) console.error(warning)
      return false
    }
    if (transaction.phase === 'activating') return true
    try {
      const recovered = await rollBack(
        directory,
        transaction,
        transaction.mode === 'service' ? idleService : undefined,
      )
      for (const warning of recovered.warnings) console.error(warning)
      if (recovered.preserved)
        console.error(`The replaced database is retained at ${recovered.preserved}.`)
    } catch (cause) {
      throw pending(transaction, directory, cause)
    }
    return false
  } finally {
    release()
  }
}
/**
 * Checked by every runtime after it takes the runtime lock and before it opens the database:
 * nothing starts while a decided rollback is unfinished, and only the recorded candidate starts
 * while its activation is being verified.
 */
export function assertLaunchAllowed(directory: string, entrypoint: string | undefined) {
  const transaction = readTransaction(directory)
  if (!transaction || transaction.phase === 'committed') return
  if (transaction.phase === 'activating') {
    if (transaction.packaged) {
      const launcher = process.env.DOVO_SERVER_LAUNCHER
      if (
        launcher &&
        entrypoint &&
        resolve(entrypoint) === transaction.entrypoint &&
        realpathSync(launcher) === transaction.packaged.candidate &&
        releaseSelected(directory, transaction, false)
      )
        return
    } else if (entrypoint === transaction.entrypoint) return
  }
  // Reselection follows the restore, so a restored selection marks a finished rollback.
  if (transaction.phase === 'rolling-back' && releaseSelected(directory, transaction, true)) return
  const guidance = `Run pnpm server start (or server service restart) to finish interrupted update ${transaction.id}.`
  throw new Error(
    transaction.phase === 'prepared'
      ? `An update stopped this runtime to save its database. ${guidance}`
      : transaction.phase === 'rolling-back'
        ? `The database is being restored to its pre-update state. ${guidance}`
        : `Only the release being verified may open the database. ${guidance}`,
  )
}
/** Commit a launched candidate once it serves its owner API, or decide its rollback. */
export function settleLaunch(directory: string, healthy: boolean) {
  const release = operationLock(directory)
  if (!release) return []
  try {
    const transaction = readTransaction(directory)
    if (transaction?.phase !== 'activating' || !releaseSelected(directory, transaction, false))
      return []
    if (healthy) return commit(directory, transaction)
    // The next launch restores the previous release rather than retrying this candidate.
    save(directory, { ...transaction, phase: 'rolling-back' })
    return []
  } finally {
    release()
  }
}

/**
 * Finish an interrupted activation before anything else starts or updates the runtime.
 * An unverified candidate is started again and kept if healthy, so data it accepted is not
 * discarded; otherwise the previous release and database are restored.
 */
export async function recoverServerUpdate(directory: string, service?: ServiceControls) {
  const transaction = readTransaction(directory)
  if (!transaction) return undefined
  const path = recordPath(directory)
  if (process.env.DOVO_SERVER_DISTRIBUTION === 'archive' && !transaction.packaged)
    throw new Error(
      `This data directory has an interrupted source update (${path}). Finish it from that source checkout with pnpm server start.`,
    )
  if ((transaction.mode === 'service') !== !!service)
    throw new Error(
      transaction.mode === 'service'
        ? `An interrupted service update must finish first: run pnpm server service restart. Record: ${path}`
        : `An interrupted update must finish first: run pnpm server start. Record: ${path}`,
    )
  const { id } = transaction
  const settled = settleRecorded(directory, transaction)
  if (settled) return settled
  let failure: unknown
  if (transaction.phase === 'activating') {
    const status = await serverStatus(directory)
    if (status.running) {
      if (service || (status.pid !== undefined && transaction.candidates.includes(status.pid))) {
        try {
          await verifyCandidate(directory, transaction)
          return { id, outcome: 'completed' as const, warnings: commit(directory, transaction) }
        } catch (error) {
          failure = error
        }
      } else
        throw new Error(
          `Process ${status.pid ?? 'unknown'}, which interrupted update ${id} did not start, is using this data directory. Stop it, then retry.`,
        )
    }
    const alive = transaction.candidates.filter((pid) => !exited(pid))
    if (alive.length)
      throw new Error(
        `Candidate process ${alive.join(', ')} from interrupted update ${id}, or its process group, is running but unreachable. Stop it, then retry.`,
      )
    try {
      if (failure !== undefined) throw failure
      await startCandidate(directory, transaction, service)
      return { id, outcome: 'completed' as const, warnings: commit(directory, transaction) }
    } catch (error) {
      failure = error
    }
  }
  try {
    const { preserved, warnings } = await rollBack(directory, transaction, service)
    return {
      id,
      outcome: 'rolled-back' as const,
      ...(preserved ? { preserved } : {}),
      ...(failure === undefined ? {} : { error: message(failure) }),
      warnings,
    }
  } catch (cause) {
    throw pending(transaction, directory, cause)
  }
}

/** Recovery pins must remain installed when the manager has advanced to a different package. */
export function packagedServiceWarning(directory: string) {
  let selected: string
  try {
    selected = launcherSelection(directory)
  } catch (error) {
    if (code(error) === 'ENOENT' || code(error) === 'EINVAL') return undefined
    throw error
  }
  const text = readText(join(directory, 'server-service.json'))
  const value: unknown = text === null ? undefined : JSON.parse(text)
  if (
    !value ||
    typeof value !== 'object' ||
    !('launcher' in value) ||
    typeof value.launcher !== 'string'
  )
    return undefined
  try {
    const pinned = realpathSync(selected)
    if (selected === value.launcher && pinned === realpathSync(value.launcher)) return undefined
    return `Service retains ${pinned} after an interrupted or failed update. Keep this package installed until a service update succeeds; the package-manager path may change independently.`
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    return `A service launcher is missing (${selected}). Reinstall the retained package before restarting; no other release was selected automatically.`
  }
}
