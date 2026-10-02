import { setImmediate } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  usageRecordSchema,
  type Task,
  type UsageRecord,
} from '@dovo/protocol'
const rowSchema = mutableStruct({ value: Schema.String })
/** Independent of thread retention, and never carried in streaming workspace snapshots. */
export class UsageHistory {
  readonly sourceId: string
  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS usage_records_started_id ON usage_records(started_at,id);',
    )
    const row = db.prepare('SELECT value FROM documents WHERE id = ?').get('usage-source-id')
    this.sourceId = row ? decode(rowSchema, row).value : randomUUID()
    if (!row)
      db.prepare('INSERT INTO documents VALUES (?, ?)').run('usage-source-id', this.sourceId)
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
  }
  recordExternal(records: readonly UsageRecord[]) {
    const write = this.db.prepare(
      'INSERT INTO usage_records VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value WHERE value != excluded.value',
    )
    this.db.transaction(() => {
      for (const record of records)
        write.run(
          `external:${record.turn.provider}:${record.turn.id}`,
          record.turn.startedAt,
          JSON.stringify(record),
        )
    })()
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
