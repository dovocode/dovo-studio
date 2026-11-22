import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type Database from 'better-sqlite3'
import {
  decode,
  taskFamilyIds,
  taskFamilyRunToken,
  taskMetadataSchema,
  type TaskSummary,
} from '@dovo/protocol'
import { Schema, Struct } from 'effect'

const lifecycleSchema = taskMetadataSchema.mapFields(
  Struct.pick([
    'id',
    'archived',
    'archivedAt',
    'autoSettled',
    'settledAt',
    'snoozedUntil',
    'quotaContinuation',
    'status',
    'activeRunId',
  ]),
)
type Lifecycle = typeof lifecycleSchema.Type

function lifecycle(task: Lifecycle): Lifecycle {
  return {
    id: task.id,
    archived: task.archived,
    archivedAt: task.archivedAt,
    autoSettled: task.autoSettled,
    settledAt: task.settledAt,
    snoozedUntil: task.snoozedUntil,
    quotaContinuation: task.quotaContinuation,
    status: task.status,
    activeRunId: task.activeRunId,
  }
}

export function taskListFamily(tasks: readonly TaskSummary[], root: string) {
  const ids = taskFamilyIds(tasks, root)
  return tasks
    .filter((task) => ids.has(task.id))
    .map(lifecycle)
    .sort((a, b) => a.id.localeCompare(b.id))
}

const ticketSchema = Schema.Struct({
  owner: Schema.String,
  root: Schema.String,
  before: Schema.Array(lifecycleSchema),
  after: Schema.Array(lifecycleSchema),
  runToken: Schema.String,
})
type Ticket = typeof ticketSchema.Type
const rowSchema = Schema.Struct({
  token: Schema.String,
  value: Schema.String,
  invalidated: Schema.Number,
})
const lifetime = 30_000

export function taskListUndoMatches(tasks: readonly TaskSummary[], ticket: Ticket) {
  return (
    isDeepStrictEqual(taskListFamily(tasks, ticket.root), ticket.after.map(lifecycle)) &&
    taskFamilyRunToken(tasks, ticket.root) === ticket.runToken
  )
}

/** Write tickets and invalidations inside the workspace transaction that changes the task family. */
export class TaskListUndo {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS task_list_undo (
      token TEXT PRIMARY KEY, expires INTEGER NOT NULL, value TEXT NOT NULL, invalidated INTEGER NOT NULL DEFAULT 0
    )`)
    this.prune()
  }

  private prune(now = Date.now()) {
    this.db.prepare('DELETE FROM task_list_undo WHERE expires <= ?').run(now)
  }

  create(ticket: Ticket) {
    const now = Date.now()
    this.prune(now)
    const token = randomUUID()
    this.db
      .prepare('INSERT INTO task_list_undo (token, expires, value) VALUES (?, ?, ?)')
      .run(token, now + lifetime, JSON.stringify(ticket))
    return token
  }

  read(token: string) {
    const raw = this.db
      .prepare(
        'SELECT token, value, invalidated FROM task_list_undo WHERE token = ? AND expires > ?',
      )
      .get(token, Date.now())
    if (!raw) return
    const row = decode(rowSchema, raw)
    return { ...decode(ticketSchema, JSON.parse(row.value)), invalidated: row.invalidated !== 0 }
  }

  remove(token: string) {
    this.db.prepare('DELETE FROM task_list_undo WHERE token = ?').run(token)
  }

  invalidateChangedFamilies(tasks: readonly TaskSummary[]) {
    const rows = this.db
      .prepare(
        'SELECT token, value, invalidated FROM task_list_undo WHERE invalidated = 0 AND expires > ?',
      )
      .all(Date.now())
    for (const raw of rows) {
      const { token, value } = decode(rowSchema, raw)
      if (!taskListUndoMatches(tasks, decode(ticketSchema, JSON.parse(value))))
        this.db.prepare('UPDATE task_list_undo SET invalidated = 1 WHERE token = ?').run(token)
    }
  }
}
