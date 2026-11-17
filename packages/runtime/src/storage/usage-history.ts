import { setImmediate } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  usageRecordSchema,
  usageRetentionSchema,
  usageStorageSchema,
  type usageExportCursorSchema,
  type Task,
  type UsageRecord,
} from '@dovo/protocol'
const rowSchema = mutableStruct({ value: Schema.String })
/** Independent of thread retention, and never carried in streaming workspace snapshots. */
export class UsageHistory {
  readonly sourceId: string
  private days: number | null = null
  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS usage_records_started_id ON usage_records(started_at,id);',
    )
    const row = db.prepare('SELECT value FROM documents WHERE id = ?').get('usage-source-id')
    this.sourceId = row ? decode(rowSchema, row).value : randomUUID()
    if (!row)
      db.prepare('INSERT INTO documents VALUES (?, ?)').run('usage-source-id', this.sourceId)
    const setting = db.prepare('SELECT value FROM documents WHERE id=?').get('usage-retention')
    if (setting)
      this.days = decode(usageRetentionSchema, JSON.parse(decode(rowSchema, setting).value)).days
    this.cleanup()
  }
  private cutoff() {
    return this.days === null ? '' : new Date(Date.now() - this.days * 86400000).toISOString()
  }
  private cleanup() {
    if (this.days !== null)
      this.db.prepare('DELETE FROM usage_records WHERE started_at < ?').run(this.cutoff())
  }
  storage() {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS count, MIN(started_at) AS oldest, MAX(started_at) AS newest FROM usage_records',
      )
      .get()
    const stats = decode(
      mutableStruct({
        count: Schema.Number,
        oldest: Schema.NullOr(Schema.String),
        newest: Schema.NullOr(Schema.String),
      }),
      row,
    )
    return decode(usageStorageSchema, { ...stats, days: this.days })
  }
  setRetention(days: number | null) {
    const value = decode(usageRetentionSchema, { days })
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO documents VALUES (?,?)')
        .run('usage-retention', JSON.stringify(value))
      this.days = value.days
      this.cleanup()
    })()
    return this.storage()
  }
  exportPage(cursor?: typeof usageExportCursorSchema.Type) {
    const rows = this.db
      .prepare(
        'SELECT id, started_at, value FROM usage_records WHERE (started_at,id) > (?,?) ORDER BY started_at,id LIMIT 257',
      )
      .all(cursor?.at ?? '', cursor?.id ?? '')
      .map((row) =>
        decode(
          mutableStruct({ id: Schema.String, started_at: Schema.String, value: Schema.String }),
          row,
        ),
      )
    const page = rows.slice(0, 256),
      last = page.at(-1)
    return {
      sourceId: this.sourceId,
      records: page.map((row) => decode(usageRecordSchema, JSON.parse(row.value))),
      next: rows.length > 256 && last ? { at: last.started_at, id: last.id } : undefined,
    }
  }
  record(tasks: readonly Task[], previous: ReadonlyMap<string, Task>) {
    const write = this.db.prepare(
      'INSERT INTO usage_records VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value WHERE value != excluded.value',
    )
    for (const task of tasks) {
      if (task.example || task === previous.get(task.id)) continue
      const previousTask = previous.get(task.id)
      if (
        previousTask?.title === task.title &&
        previousTask.turns === task.turns &&
        previousTask.sessionId === task.sessionId
      )
        continue
      const old = new Map((previousTask?.turns ?? []).map((turn) => [turn.id, turn]))
      for (const turn of task.turns ?? []) {
        if (turn.status === 'running') continue
        if (turn.startedAt < this.cutoff()) continue
        const prior = old.get(turn.id)
        // Change capture and file viewing do not change consumption.
        if (
          prior &&
          task.title === previous.get(task.id)?.title &&
          prior.status === turn.status &&
          prior.tokens === turn.tokens &&
          prior.estimatedCostUsd === turn.estimatedCostUsd &&
          prior.finishedAt === turn.finishedAt &&
          prior.model === turn.model &&
          prior.usageAccount?.id === turn.usageAccount?.id &&
          JSON.stringify(prior.tokenUsage) === JSON.stringify(turn.tokenUsage)
        )
          continue
        const record: UsageRecord = {
          taskId: task.id,
          title: task.title,
          sessionId: task.sessionId,
          origin: 'dovo',
          turn: { ...turn, checkpoint: undefined, error: undefined },
        }
        write.run(JSON.stringify([task.id, turn.id]), turn.startedAt, JSON.stringify(record))
      }
    }
    this.cleanup()
  }
  /** Tasks with a recorded turn on this provider account, without reading their histories. */
  taskIds(accountId: string) {
    return new Set(
      decode(
        mutableArray(rowSchema),
        this.db
          .prepare(
            "SELECT DISTINCT json_extract(value, '$.taskId') AS value FROM usage_records WHERE id NOT LIKE 'external:%' AND json_extract(value, '$.turn.usageAccount.id') = ?",
          )
          .all(accountId),
      ).map((row) => row.value),
    )
  }
  /** Finished Dovo turns of these tasks that started at or after `since`. Running turns are
   * recorded when they end. */
  turns(taskIds: readonly string[], since: string): UsageRecord[] {
    if (!taskIds.length) return []
    return decode(
      mutableArray(rowSchema),
      this.db
        .prepare(
          "SELECT value FROM usage_records WHERE started_at >= ? AND id NOT LIKE 'external:%' AND json_extract(value, '$.taskId') IN (SELECT value FROM json_each(?)) ORDER BY started_at, id",
        )
        .all(since, JSON.stringify(taskIds)),
    ).map((row) => decode(usageRecordSchema, JSON.parse(row.value)))
  }
  recordExternal(records: readonly UsageRecord[]) {
    const write = this.db.prepare(
      'INSERT INTO usage_records VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value WHERE value != excluded.value',
    )
    this.db.transaction(() => {
      for (const record of records) {
        if (record.turn.startedAt < this.cutoff()) continue
        write.run(
          `external:${record.turn.provider}:${record.turn.id}`,
          record.turn.startedAt,
          JSON.stringify(record),
        )
      }
      this.cleanup()
    })()
  }
  /** CLI exclusion needs identities, not decoding every durable turn a second time. */
  async ownedSessions(since: string) {
    const schema = mutableStruct({
      provider: Schema.String,
      session: Schema.NullOr(Schema.String),
      origin: Schema.NullOr(Schema.String),
      started_at: Schema.String,
      id: Schema.String,
    })
    const page = this.db.prepare(
      "SELECT id, started_at, json_extract(value, '$.turn.provider') AS provider, json_extract(value, '$.sessionId') AS session, json_extract(value, '$.origin') AS origin FROM usage_records WHERE (started_at,id) > (?,?) ORDER BY started_at,id LIMIT 256",
    )
    const sessions = new Set<string>()
    let timestamp = since,
      id = ''
    while (true) {
      const rows = page.all(timestamp, id).map((row) => decode(schema, row))
      for (const row of rows)
        if (row.origin !== 'cli' && row.session) sessions.add(`${row.provider}:${row.session}`)
      const last = rows.at(-1)
      if (!last || rows.length < 256) return sessions
      timestamp = last.started_at
      id = last.id
      await setImmediate()
    }
  }
  async read(since: string): Promise<UsageRecord[]> {
    const records: UsageRecord[] = []
    const schema = mutableStruct({
      value: Schema.String,
      started_at: Schema.String,
      id: Schema.String,
    })
    const page = this.db.prepare(
      'SELECT id, started_at, value FROM usage_records WHERE (started_at,id) > (?,?) ORDER BY started_at,id LIMIT 256',
    )
    let timestamp = since,
      id = ''
    while (true) {
      // Finish each SQLite statement before yielding: streaming writes share this connection.
      const rows = page.all(timestamp, id).map((row) => decode(schema, row))
      for (const row of rows) records.push(decode(usageRecordSchema, JSON.parse(row.value)))
      const last = rows.at(-1)
      if (!last || rows.length < 256) break
      timestamp = last.started_at
      id = last.id
      await setImmediate()
    }
    return records
  }
}
