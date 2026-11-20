import { decode, mutableStruct, projectTransferResultSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import type { WorkspaceStore } from '../../storage/workspace.js'

/** The source side of a completed thread move. The destination owns the thread; the source
 * keeps a read-only copy for recovery.
 *
 * Fence rows are the authority for moves once a database holds the authority marker. Task
 * metadata is only a projection: a backup restore can bring back a stale `moved` state, or
 * lose one. Startup makes task metadata match the fence rows. A database without the marker
 * predates fence rows; its task metadata is the only record, so startup migrates it once. */
const fenceSchema = mutableStruct({
  id: Schema.String,
  targetRuntimeId: Schema.String,
  state: Schema.Literal('moved'),
  sourceArchived: Schema.optional(Schema.Boolean),
  targetTaskId: Schema.optional(Schema.String),
  checkpoint: Schema.optional(Schema.String),
})
type Fence = typeof fenceSchema.Type
const authorityId = 'project-transfer-fences:authority'
const rowsSchema = Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String }))
/** The final decisions in a destination receipt. Other receipt fields stay as stored. */
const receiptSchema = Schema.Struct({
  activated: Schema.optional(Schema.Literal(true)),
  discarded: Schema.optional(Schema.Literal(true)),
  result: Schema.optional(projectTransferResultSchema),
})
const hasTable = (db: Database.Database, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
const rows = (db: Database.Database, sql: string) => decode(rowsSchema, db.prepare(sql).all())

export function createFenceTable(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS project_transfer_fences (task_id TEXT PRIMARY KEY, value TEXT NOT NULL)',
  )
}
/** Call inside the transaction that marks the source thread as moved. */
export function recordFence(db: Database.Database, taskId: string, fence: Fence) {
  db.prepare('INSERT OR REPLACE INTO project_transfer_fences VALUES (?,?)').run(
    taskId,
    JSON.stringify(decode(fenceSchema, fence)),
  )
}
/** Call inside the transaction that gives a moved source back its ownership. */
export function clearFence(db: Database.Database, taskId: string, transferId: string) {
  if (readFences(db).get(taskId)?.id === transferId)
    db.prepare('DELETE FROM project_transfer_fences WHERE task_id=?').run(taskId)
}
const authoritative = (db: Database.Database) =>
  !!db.prepare('SELECT 1 FROM documents WHERE id=?').get(authorityId)
const markAuthoritative = (db: Database.Database) =>
  db
    .prepare('INSERT OR IGNORE INTO documents (id,value) VALUES (?,?)')
    .run(authorityId, JSON.stringify('fence-rows'))
function readFences(db: Database.Database) {
  if (!hasTable(db, 'project_transfer_fences')) return new Map<string, Fence>()
  return new Map(
    rows(db, 'SELECT task_id AS id,value FROM project_transfer_fences').map((row) => [
      row.id,
      decode(fenceSchema, JSON.parse(row.value)),
    ]),
  )
}
/** Moved sources recorded only in task metadata, from runtimes before fence rows existed. */
function legacyFences(db: Database.Database) {
  const fences = new Map<string, Fence>()
  if (!hasTable(db, 'workspace_tasks')) return fences
  const candidate = Schema.Struct({ machineHandoff: Schema.optional(Schema.Unknown) })
  for (const row of rows(db, 'SELECT task_id AS id,value FROM workspace_tasks')) {
    let handoff: unknown
    try {
      handoff = decode(candidate, JSON.parse(row.value)).machineHandoff
    } catch {
      // An unreadable task keeps its row; it has no fence to carry.
      continue
    }
    if (Schema.is(fenceSchema)(handoff)) fences.set(row.id, handoff)
  }
  return fences
}
/** The latest move decisions held by a database. */
const currentFences = (db: Database.Database) =>
  authoritative(db) ? readFences(db) : new Map([...legacyFences(db), ...readFences(db)])
const readReceipt = (value: string) => decode(receiptSchema, JSON.parse(value))

/** Startup, before any thread can run. Makes task metadata follow the recorded decisions:
 * - a fence row moves its source thread out of this computer, replacing an older move;
 * - a `moved` thread without a fence row had its ownership returned;
 * - an activated receipt releases its staged destination thread. */
export function reconcileTransferOwnership(db: Database.Database, store: WorkspaceStore) {
  createFenceTable(db)
  store.transaction(() => {
    if (!authoritative(db)) {
      for (const task of store.get().tasks)
        if (task.machineHandoff?.state === 'moved')
          recordFence(db, task.id, { ...task.machineHandoff, state: 'moved' })
      markAuthoritative(db)
    }
    const fences = readFences(db)
    for (const task of store.get().tasks) {
      const fence = fences.get(task.id)
      const handoff = task.machineHandoff
      if (fence && !(handoff?.state === 'moved' && handoff.id === fence.id))
        store.updateTask(task.id, (current) => ({
          ...current,
          machineHandoff: fence,
          archived: true,
          quotaContinuation: undefined,
          restartRecovery: undefined,
        }))
      else if (!fence && handoff?.state === 'moved')
        store.updateTask(task.id, (current) => ({
          ...current,
          archived: current.machineHandoff?.sourceArchived,
          machineHandoff: undefined,
        }))
    }
    if (!hasTable(db, 'project_transfer_receipts')) return
    for (const row of rows(db, 'SELECT id,value FROM project_transfer_receipts')) {
      const receipt = readReceipt(row.value)
      const taskId = receipt.result?.taskId
      const handoff = taskId
        ? store.get().tasks.find((entry) => entry.id === taskId)?.machineHandoff
        : undefined
      if (taskId && receipt.activated && handoff?.state === 'staged' && handoff.id === row.id)
        store.updateTask(taskId, (current) => ({
          ...current,
          machineHandoff: undefined,
          archivedAt: undefined,
        }))
    }
  })
}

/** Offline restore of a backup with this runtime's identity. The current database holds the
 * latest decisions, in both directions:
 * - source: its fence rows replace the backup's, and its transfer jobs replace older copies;
 * - destination: an activation or discard replaces the backup's receipt for that transfer.
 * A receipt that the backup lacks is only added for a discard, so the source can recover.
 * An activation without the staged thread in the backup cannot release anything. */
export function carryTransferOwnership(staged: Database.Database, current: Database.Database) {
  const fences = currentFences(current)
  createFenceTable(staged)
  staged.exec('DELETE FROM project_transfer_fences')
  for (const [taskId, fence] of fences) recordFence(staged, taskId, fence)
  markAuthoritative(staged)
  if (hasTable(current, 'project_transfers')) {
    staged.exec(
      'CREATE TABLE IF NOT EXISTS project_transfers (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    const write = staged.prepare('INSERT OR REPLACE INTO project_transfers VALUES (?,?)')
    for (const row of rows(current, 'SELECT id,value FROM project_transfers'))
      write.run(row.id, row.value)
  }
  if (hasTable(current, 'project_transfer_receipts')) {
    staged.exec(
      'CREATE TABLE IF NOT EXISTS project_transfer_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    const existing = staged.prepare('SELECT 1 FROM project_transfer_receipts WHERE id=?')
    const write = staged.prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
    for (const row of rows(current, 'SELECT id,value FROM project_transfer_receipts')) {
      const receipt = readReceipt(row.value)
      if (receipt.discarded || (receipt.activated && existing.get(row.id)))
        write.run(row.id, row.value)
    }
  }
}
