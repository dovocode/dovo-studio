import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
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
        /token|secret|password|authorization|ticket|^(?:code|pairingCode|apiKey)$/i.test(k)
          ? '[redacted]'
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
const record = z.object({
  id: z.string(),
  time: z.string(),
  kind: z.string(),
  scope: z.string(),
  summary: z.string(),
  payload: z.string(),
})
export class Activity {
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,time TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_time ON activity(time DESC)',
    )
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
  list(query: string, kind: string, offset: number, scope = '') {
    return {
      events: z
        .array(record)
        .parse(
          this.db
            .prepare(
              "SELECT * FROM activity WHERE (?='' OR scope=?) AND (?='' OR kind=? OR (?='task-activity' AND kind IN ('tool','reasoning'))) AND (summary LIKE ? OR payload LIKE ? OR scope LIKE ?) ORDER BY time DESC,id DESC LIMIT 100 OFFSET ?",
            )
            .all(scope, scope, kind, kind, kind, `%${query}%`, `%${query}%`, `%${query}%`, offset),
        ),
    }
  }
}
