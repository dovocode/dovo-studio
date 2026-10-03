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
  private pendingMessages = new Map<
    string,
    Map<string, Workspace['tasks'][number]['messages'][number]>
  >()
  revision = 0
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,time TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_time ON activity(time DESC); CREATE INDEX IF NOT EXISTS activity_scope_time ON activity(scope,time DESC,id DESC)',
    )
    // Remove previously recorded literal MCP values and API-key fields once per database.
    if (!db.prepare('SELECT value FROM documents WHERE id=?').get('activity-redaction-v3')) {
      db.transaction(() => {
        const rows = decode(mutableArray(record), db.prepare('SELECT * FROM activity').all())
        const update = db.prepare('UPDATE activity SET payload=?,summary=? WHERE id=?')
        const remove = db.prepare('DELETE FROM activity WHERE id=?')
        for (const row of rows) {
          let payload: unknown
          try {
            payload = JSON.parse(row.payload)
          } catch {
            // Unreadable historical payloads cannot be safely redacted.
            remove.run(row.id)
            continue
          }
          update.run(JSON.stringify(redact(payload)), String(redact(row.summary)), row.id)
        }
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
    this.revision++
  }
  workspace(before: Workspace, after: Workspace) {
    if (before.tasks === after.tasks) return
    const previousTasks = new Map(before.tasks.map((task) => [task.id, task]))
    const currentIds = new Set(after.tasks.map((task) => task.id))
    for (const task of before.tasks) {
      if (!currentIds.has(task.id)) this.flushMessages(task)
    }
    for (const task of after.tasks) {
      const previous = previousTasks.get(task.id)
      if (previous === task) continue
      if (
        previous?.status !== task.status ||
        previous?.activity !== task.activity ||
        previous?.sessionId !== task.sessionId
      )
        this.add('task', task.id, `${task.title} · ${task.status}`, {
          activity: task.activity,
          error: task.error,
        })
      const finished =
        task.status !== 'running' ||
        task.runPhase === 'finalizing' ||
        previous?.activeRunId !== task.activeRunId
      if (previous?.messages === task.messages) {
        if (finished) {
          // A fresh Activity instance has no pending stream after a crash. The store's
          // startup transition still has the saved running turn; audit only its reply,
          // never historical messages or a completed turn interrupted in finalization.
          if (
            !this.pendingMessages.has(task.id) &&
            previous.status === 'running' &&
            task.status === 'failed' &&
            task.restartRecovery?.kind === 'turn' &&
            previous.runPhase !== 'preparing' &&
            previous.runPhase !== 'finalizing'
          ) {
            const turn = previous.turns?.at(-1)
            const message =
              turn?.status === 'running'
                ? task.messages.find((item) => item.id === turn.assistantId)
                : undefined
            if (message?.role === 'assistant')
              this.add(
                'message',
                task.id,
                `assistant · ${task.title}`,
                message,
                `message:${task.id}:${message.id}`,
              )
          }
          this.flushMessages(task)
        }
        continue
      }
      const previousMessages = new Map(previous?.messages.map((message) => [message.id, message]))
      for (const message of task.messages) {
        const old = previousMessages.get(message.id)
        if (old === message) continue
        if (
          message.role === 'assistant' &&
          task.status === 'running' &&
          task.runPhase !== 'finalizing'
        ) {
          let pending = this.pendingMessages.get(task.id)
          if (!pending) this.pendingMessages.set(task.id, (pending = new Map()))
          pending.set(message.id, message)
          if (message.textBreaks?.length === old?.textBreaks?.length) continue
          pending.delete(message.id)
        } else this.pendingMessages.get(task.id)?.delete(message.id)
        if (JSON.stringify(old) !== JSON.stringify(message))
          this.add(
            'message',
            task.id,
            `${message.role} · ${task.title}`,
            message,
            `message:${task.id}:${message.id}`,
          )
      }
      if (finished) this.flushMessages(task)
    }
  }
  private flushMessages(task: Workspace['tasks'][number]) {
    const pending = this.pendingMessages.get(task.id)
    if (!pending) return
    const current = new Map(task.messages.map((message) => [message.id, message]))
    for (const message of pending.values())
      this.add(
        'message',
        task.id,
        `assistant · ${task.title}`,
        current.get(message.id) ?? message,
        `message:${task.id}:${message.id}`,
      )
    this.pendingMessages.delete(task.id)
  }
  /** Deletes up to `limit` entries older than `before`, oldest first; returns how many. Small
   * batches keep the database responsive while a large history is trimmed. */
  pruneBefore(before: string, limit = 2000) {
    const changes = this.db
      .prepare(
        'DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE time < ? ORDER BY time LIMIT ?)',
      )
      .run(before, limit).changes
    if (changes) this.revision++
    return changes
  }
  list(query: string, kind: string, offset: number, scope = '') {
    const filters: string[] = []
    const values: (string | number)[] = []
    if (scope) {
      filters.push('scope=?')
      values.push(scope)
    }
    if (kind === 'task-activity') {
      filters.push("kind IN ('task-activity','tool','reasoning')")
    } else if (kind) {
      filters.push('kind=?')
      values.push(kind)
    }
    if (query) {
      filters.push('(summary LIKE ? OR payload LIKE ? OR scope LIKE ?)')
      values.push(`%${query}%`, `%${query}%`, `%${query}%`)
    }
    return {
      events: decode(
        mutableArray(record),
        this.db
          .prepare(
            `SELECT * FROM activity${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY time DESC,id DESC LIMIT 100 OFFSET ?`,
          )
          .all(...values, offset),
      ),
    }
  }
  *toolPayloads(scope: string) {
    for (const row of this.db
      .prepare("SELECT payload FROM activity WHERE scope=? AND kind='tool' ORDER BY time,id")
      .iterate(scope))
      yield decode(mutableStruct({ payload: Schema.String }), row).payload
  }
}
