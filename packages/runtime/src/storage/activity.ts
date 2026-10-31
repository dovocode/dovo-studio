import { mutableStruct, mutableArray, redactCredentialText } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import type { ChatMessage, TaskSummary } from '@dovo/protocol'
import type { WorkspaceChange } from './workspace.js'
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
        /token|secret|password|authorization|ticket|apikey|managementkey|contentkey|signingseed|^(?:code|pairingcode|env|headerenv|envvalues|headervalues)$/i.test(
          k.replace(/[^a-z0-9]/gi, ''),
        )
          ? '[redacted]'
          : k === 'error' && typeof v === 'string' && /Expected[\s\S]*, actual /.test(v)
            ? '[redacted validation error]'
            : redact(v),
      ]),
    )
  if (typeof value === 'string') return redactCredentialText(value)
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
  private scopes = new Map<
    string,
    { revision: number; users: number; listeners: Set<() => void> }
  >()
  watchScope(scope: string, onChange?: () => void) {
    let entry = this.scopes.get(scope)
    if (!entry) {
      entry = { revision: this.revision, users: 0, listeners: new Set() }
      this.scopes.set(scope, entry)
    }
    entry.users++
    const current = entry
    const notify = () => onChange?.()
    if (onChange) current.listeners.add(notify)
    let stopped = false
    return {
      revision: () => current.revision,
      stop: () => {
        if (stopped) return
        stopped = true
        current.listeners.delete(notify)
        if (!--current.users) this.scopes.delete(scope)
      },
    }
  }
  private changed(scope?: string) {
    this.revision++
    if (scope !== undefined) {
      const watched = this.scopes.get(scope)
      if (watched) {
        watched.revision = this.revision
        for (const notify of watched.listeners) notify()
      }
    } else
      for (const watched of this.scopes.values()) {
        watched.revision = this.revision
        for (const notify of watched.listeners) notify()
      }
  }
  private pendingMessages = new Map<string, Map<string, ChatMessage>>()
  revision = 0
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,time TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_time ON activity(time DESC); CREATE INDEX IF NOT EXISTS activity_scope_time ON activity(scope,time DESC,id DESC)',
    )
    // Remove previously recorded literal MCP values and API-key fields once per database.
    if (!db.prepare('SELECT value FROM documents WHERE id=?').get('activity-redaction-v4')) {
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
        db.prepare('INSERT INTO documents VALUES (?, ?)').run('activity-redaction-v4', 'done')
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
    if (['tool', 'reasoning', 'task-activity'].includes(kind)) this.changed(scope)
    else this.revision++
  }
  imagePayload(scope: string, id: string) {
    return decode(
      Schema.UndefinedOr(record),
      this.db.prepare('SELECT * FROM activity WHERE scope=? AND id=?').get(scope, id),
    )?.payload
  }
  /** Audits status changes, and messages wherever the update wrote history. */
  workspace({ before, after, histories }: WorkspaceChange) {
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
      const history = histories.get(task.id)
      if (!history || history.before?.messages === history.after.messages) {
        if (finished) {
          // A fresh Activity instance has no pending stream after a crash. The store's
          // startup transition still has the saved running turn; audit only its reply,
          // never historical messages or a completed turn interrupted in finalization.
          if (
            history?.before &&
            !this.pendingMessages.has(task.id) &&
            previous?.status === 'running' &&
            task.status === 'failed' &&
            task.restartRecovery?.kind === 'turn' &&
            previous.runPhase !== 'preparing' &&
            previous.runPhase !== 'finalizing'
          ) {
            const turn = history.before.turns?.at(-1)
            const message =
              turn?.status === 'running'
                ? history.after.messages.find((item) => item.id === turn.assistantId)
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
          this.flushMessages(task, history?.after.messages)
        }
        continue
      }
      const previousMessages = new Map(
        history.before?.messages.map((message) => [message.id, message]),
      )
      for (const message of history.after.messages) {
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
      if (finished) this.flushMessages(task, history.after.messages)
    }
  }
  /** Pending messages hold their latest streamed versions, unless a newer history is given. */
  private flushMessages(task: Pick<TaskSummary, 'id' | 'title'>, messages?: ChatMessage[]) {
    const pending = this.pendingMessages.get(task.id)
    if (!pending) return
    const current = new Map(messages?.map((message) => [message.id, message]))
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
  /** Deletes up to `limit` log entries older than `before`, oldest first; returns how many.
   * Artifact tiles follow artifact retention. Small batches keep the database responsive. */
  pruneBefore(before: string, limit = 2000) {
    const changes = this.db
      .prepare(
        "DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE time < ? AND NOT (kind='tool' AND id GLOB 'artifact:*') ORDER BY time LIMIT ?)",
      )
      .run(before, limit).changes
    if (changes) this.changed()
    return changes
  }
  /** Diagnostics have a short lifetime even when useful activity history is kept forever.
   * Reuse the time index so existing large databases need no blocking index migration. */
  pruneDiagnosticsBefore(before: string, limit = 2000) {
    const changes = this.db
      .prepare(
        "DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE time < ? AND kind IN ('command','agent-event') ORDER BY time LIMIT ?)",
      )
      .run(before, limit).changes
    if (changes) this.changed()
    return changes
  }
  /** Artifact outputs follow the artifact's lifetime, rather than log retention. */
  removeArtifacts(scope: string, artifactId?: string) {
    const changes = this.db
      .prepare("DELETE FROM activity WHERE scope=? AND kind='tool' AND id GLOB ?")
      .run(scope, artifactId ? `artifact:${artifactId}:*` : 'artifact:*').changes
    if (changes) this.changed(scope)
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
    const page = `SELECT * FROM activity${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY time DESC,id DESC LIMIT 100 OFFSET ?`
    // Thread outputs must survive newer tool calls in both polling and live sync.
    const includeArtifacts = kind === 'task-activity' && !!scope && !query && offset === 0
    return {
      events: decode(
        mutableArray(record),
        this.db
          .prepare(
            includeArtifacts
              ? `SELECT * FROM (${page}) UNION SELECT * FROM activity WHERE scope=? AND kind='tool' AND id GLOB 'artifact:*' ORDER BY time DESC,id DESC`
              : page,
          )
          .all(...values, offset, ...(includeArtifacts ? [scope] : [])),
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
