import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import type { Workspace } from '@dovo/protocol'
export function redact(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((v, i) =>
      i > 0 &&
      typeof value[i - 1] === 'string' &&
      /^--?(token|secret|password|api-key|authorization)$/i.test(value[i - 1])
        ? '[redacted]'
        : redact(v),
    )
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|secret|password|authorization|ticket|apikey|^(?:code|pairingcode|env|headerenv|envvalues|headervalues)$/i.test(
          k.replace(/[^a-z0-9]/gi, ''),
        )
          ? '[redacted]'
          : k === 'error' && typeof v === 'string' && /Expected[\s\S]*, actual /.test(v)
            ? '[redacted validation error]'
            : redact(v),
      ]),
    )
  if (typeof value === 'string')
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/([?&](?:token|ticket|secret)=)[^&\s]+/gi, '$1[redacted]')
      .replace(/((?:token|secret|password|authorization)=)[^\s]+/gi, '$1[redacted]')
  return value
}
const record = mutableStruct({
  id: Schema.String,
  time: Schema.String,
  kind: Schema.String,
  scope: Schema.String,
  summary: Schema.String,
  payload: Schema.String,
})
export class Activity {
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,time TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_time ON activity(time DESC)',
    )
    // Remove previously recorded literal MCP values and API-key fields once per database.
    if (!db.prepare('SELECT value FROM documents WHERE id=?').get('activity-redaction-v3')) {
      db.transaction(() => {
        const rows = decode(mutableArray(record), db.prepare('SELECT * FROM activity').all())
        const update = db.prepare('UPDATE activity SET payload=?,summary=? WHERE id=?')
        for (const row of rows)
          update.run(
            JSON.stringify(redact(JSON.parse(row.payload))),
            String(redact(row.summary)),
            row.id,
          )
        db.prepare('INSERT INTO documents VALUES (?, ?)').run('activity-redaction-v3', 'done')
      })()
    }
  }
  add(
    kind: string,
    scope: string,
    summary: string,
    payload: unknown = {},
    id: string = randomUUID(),
  ) {
    this.db
      .prepare(
        'INSERT INTO activity VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,summary=excluded.summary',
      )
      .run(
        id,
        new Date().toISOString(),
        kind,
        scope,
        String(redact(summary)),
        JSON.stringify(redact(payload)),
      )
  }
  workspace(before: Workspace, after: Workspace) {
    for (const task of after.tasks) {
      const previous = before.tasks.find((t) => t.id === task.id)
      if (
        previous?.status !== task.status ||
        previous?.activity !== task.activity ||
        previous?.sessionId !== task.sessionId
      )
        this.add('task', task.id, `${task.title} · ${task.status}`, {
          activity: task.activity,
          error: task.error,
        })
      for (const message of task.messages)
        if (
          JSON.stringify(previous?.messages.find((m) => m.id === message.id)) !==
          JSON.stringify(message)
        )
          this.add(
            'message',
            task.id,
            `${message.role} · ${task.title}`,
            message,
            `message:${task.id}:${message.id}`,
          )
    }
  }
  /** Deletes up to `limit` entries older than `before`, oldest first; returns how many. Small
   * batches keep the database responsive while a large history is trimmed. */
  pruneBefore(before: string, limit = 2000) {
    return this.db
      .prepare(
        'DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE time < ? ORDER BY time LIMIT ?)',
      )
      .run(before, limit).changes
  }
  list(query: string, kind: string, offset: number, scope = '') {
    return {
      events: decode(
        mutableArray(record),
        this.db
          .prepare(
            "SELECT * FROM activity WHERE (?='' OR scope=?) AND (?='' OR kind=? OR (?='task-activity' AND kind IN ('tool','reasoning'))) AND (summary LIKE ? OR payload LIKE ? OR scope LIKE ?) ORDER BY time DESC,id DESC LIMIT 100 OFFSET ?",
          )
          .all(scope, scope, kind, kind, kind, `%${query}%`, `%${query}%`, `%${query}%`, offset),
      ),
    }
  }
}
