import {
  mutableStruct,
  mutableArray,
  redactCredentialText,
  recentTools,
  toolPresentation,
  terminalWrapperKey,
} from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import type { ChatMessage, TaskSummary } from '@dovo/protocol'
import type { WorkspaceChange } from './workspace.js'
import { RemoteMcpEvents } from './remote-mcp-events.js'
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
export type RetainedToolOutput = {
  turnId: string
  sessionId?: string
  read: () => string
}

export class Activity {
  readonly remoteMcpEvents: RemoteMcpEvents
  private readonly recordListeners = new Set<(kind: string, scope: string) => void>()
  onRecorded(listener: (kind: string, scope: string) => void) {
    this.recordListeners.add(listener)
    return () => this.recordListeners.delete(listener)
  }
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
    this.remoteMcpEvents = new RemoteMcpEvents(db)
    db.exec(
      'CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY,time TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,summary TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_time ON activity(time DESC); CREATE INDEX IF NOT EXISTS activity_scope_time ON activity(scope,time DESC,id DESC)',
    )
    db.exec(`
      CREATE INDEX IF NOT EXISTS activity_tool_time
        ON activity(time DESC,id DESC) WHERE kind='tool';
      CREATE INDEX IF NOT EXISTS activity_tool_scope_time
        ON activity(scope,time DESC,id DESC) WHERE kind='tool';
      CREATE INDEX IF NOT EXISTS activity_tool_call
        ON activity(scope,json_extract(payload,'$.turnId'),json_extract(payload,'$.toolId'))
        WHERE kind='tool' AND json_valid(payload);
      CREATE INDEX IF NOT EXISTS activity_tool_blocks
        ON activity(scope,json_extract(payload,'$.turnId'))
        WHERE kind='tool' AND CASE WHEN json_valid(payload)
          THEN json_type(payload,'$.event.message.content')='array' ELSE 0 END;
      CREATE INDEX IF NOT EXISTS activity_terminal_receipt
        ON activity(scope,json_extract(payload,'$.turnId'),json_extract(payload,'$.presentation.input'))
        WHERE kind='tool' AND CASE WHEN json_valid(payload)
          THEN json_extract(payload,'$.terminalCommand')=1 ELSE 0 END;
    `)
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
    for (const listener of this.recordListeners) listener(kind, scope)
  }
  imagePayload(scope: string, id: string) {
    return decode(
      Schema.UndefinedOr(record),
      this.db.prepare('SELECT * FROM activity WHERE scope=? AND id=?').get(scope, id),
    )?.payload
  }
  /** Read current records, including tools outside the first activity page. App-owned work is excluded. */
  finishProviderTools(
    scope: string,
    owner: { sessionId?: string; turnId?: string },
    status: 'interrupted' | 'cancelled' | 'failed',
    retainedOutputs?: ReadonlyMap<string, RetainedToolOutput>,
  ) {
    if (!owner.sessionId && !owner.turnId) return
    const rows = decode(
      mutableArray(record),
      this.db
        .prepare(
          "SELECT * FROM activity WHERE scope=? AND kind='tool' AND json_valid(payload) AND json_extract(payload,'$.providerTool')=1 AND ((? IS NOT NULL AND json_extract(payload,'$.providerSessionId')=?) OR (? IS NOT NULL AND json_extract(payload,'$.turnId')=?)) ORDER BY time,id",
        )
        .all(
          scope,
          owner.sessionId ?? null,
          owner.sessionId ?? null,
          owner.turnId ?? null,
          owner.turnId ?? null,
        ),
    )
    for (const tool of recentTools(rows)) {
      if (!['started', 'running', 'in_progress', 'pending', 'inProgress'].includes(tool.status))
        continue
      const payload = decode(Schema.Record(Schema.String, Schema.Unknown), JSON.parse(tool.payload))
      const view = toolPresentation(tool.payload, tool.summary, tool.inputPayload)
      const retained = tool.toolId && retainedOutputs?.get(tool.toolId)
      const output =
        retained &&
        retained.turnId === tool.turnId &&
        retained.sessionId === payload.providerSessionId
          ? retained.read()
          : undefined
      this.add(
        'tool',
        scope,
        tool.summary,
        {
          turnId: tool.turnId,
          toolId: payload.toolId,
          messageId: tool.messageId,
          textOffset: tool.textOffset,
          providerTool: true,
          providerSessionId: payload.providerSessionId,
          presentation: output === undefined ? view : { ...view, output: output || view.output },
          status,
          error: 'Provider stopped before this tool completed.',
        },
        `provider-ended:${scope}:${tool.turnId}:${String(payload.toolId)}`,
      )
    }
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
      this.remoteMcpEvents.turnFinished(previous, task)
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
        "DELETE FROM activity WHERE id IN (SELECT id FROM activity WHERE time < ? AND kind IN ('command','agent-event','job-skipped') ORDER BY time LIMIT ?)",
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
  list(query: string, kind: string, offset: number, scope = '', toolPayloadsOnly = false) {
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
    const columns = toolPayloadsOnly
      ? "id,time,kind,scope,summary,CASE WHEN kind='tool' THEN payload ELSE '' END AS payload"
      : '*'
    const page = `SELECT ${columns} FROM activity${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY time DESC,id DESC LIMIT 100 OFFSET ?`
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
  event(id: string, scope?: string) {
    return decode(
      Schema.UndefinedOr(record),
      this.db
        .prepare('SELECT * FROM activity WHERE id=? AND (? IS NULL OR scope=?)')
        .get(id, scope ?? null, scope ?? null),
    )
  }
  /** Page by saved events so collapsed tool calls do not make the next page skip a record. */
  overview(offset: number, scope = '', toolsOnly = false) {
    const page = this.list('', toolsOnly ? 'tool' : '', offset, scope, true).events
    const rawTools = page.filter((event) => event.kind === 'tool')
    const pageIds = new Set(rawTools.map((event) => event.id))
    const calls = recentTools(rawTools)
    // Even a completed call with input on this page may have an earlier start.
    const paginated = offset > 0 || page.length === 100
    const callKeys = paginated
      ? calls.flatMap((tool) =>
          tool.turnId !== undefined && tool.toolId ? [[tool.scope, tool.turnId, tool.toolId]] : [],
        )
      : []
    const siblings = callKeys.length
      ? decode(
          mutableArray(record),
          this.db
            .prepare(`
            WITH wanted AS MATERIALIZED (
              SELECT json_extract(value,'$[0]') AS scope, json_extract(value,'$[1]') AS turn_id,
                     json_extract(value,'$[2]') AS tool_id FROM json_each(?)
            )
            SELECT activity.* FROM wanted
            JOIN activity ON activity.scope=wanted.scope
              AND json_extract(activity.payload,'$.turnId')=wanted.turn_id
              AND json_extract(activity.payload,'$.toolId')=wanted.tool_id
            WHERE activity.kind='tool' AND json_valid(activity.payload)
            UNION
            SELECT activity.* FROM (SELECT DISTINCT scope, turn_id FROM wanted) calls
            CROSS JOIN activity INDEXED BY activity_tool_blocks
              ON activity.scope=calls.scope AND json_extract(activity.payload,'$.turnId')=calls.turn_id
            WHERE activity.kind='tool' AND CASE WHEN json_valid(activity.payload)
              THEN json_type(activity.payload,'$.event.message.content')='array' ELSE 0 END
              AND EXISTS (
                SELECT 1 FROM json_each(activity.payload,'$.event.message.content') AS block
                WHERE CASE WHEN block.type='object' THEN
                  (calls.scope, calls.turn_id,
                    coalesce(json_extract(block.value,'$.tool_use_id'), json_extract(block.value,'$.id'))
                  ) IN (SELECT scope, turn_id, tool_id FROM wanted)
                END
              )`)
            .all(JSON.stringify(callKeys)),
        ).filter((event) => !pageIds.has(event.id))
      : []
    const pageTools = (
      siblings.length
        ? recentTools(
            [...rawTools, ...siblings].sort(
              (a, b) => b.time.localeCompare(a.time) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
            ),
          )
        : calls
    ).filter((tool) => pageIds.has(tool.sourceEventId ?? tool.id))
    // A terminal receipt can be pages away from its wrapper, under a different provider ID.
    // Query only the identity of matching commands. Their output stays on its own page.
    const wrapperKeys = new Map<string, string>()
    if (paginated)
      for (const tool of pageTools) {
        const key = terminalWrapperKey(tool)
        if (key) wrapperKeys.set(tool.id, key)
      }
    const recorded = new Set(
      wrapperKeys.size
        ? decode(
            mutableArray(
              mutableStruct({
                scope: Schema.String,
                turnId: Schema.String,
                command: Schema.String,
              }),
            ),
            this.db
              .prepare(`
                WITH wanted AS MATERIALIZED (
                  SELECT json_extract(value,'$[0]') AS scope, json_extract(value,'$[1]') AS turn_id,
                         json_extract(value,'$[2]') AS command FROM json_each(?)
                )
                SELECT DISTINCT activity.scope, json_extract(payload,'$.turnId') AS turnId,
                       json_extract(payload,'$.presentation.input') AS command
                FROM wanted JOIN activity ON activity.scope=wanted.scope
                  AND json_extract(payload,'$.turnId')=wanted.turn_id
                  AND json_extract(payload,'$.presentation.input')=wanted.command
                WHERE kind='tool' AND CASE WHEN json_valid(payload)
                  THEN json_extract(payload,'$.terminalCommand')=1 ELSE 0 END
              `)
              .all(JSON.stringify([...wrapperKeys.values()])),
          ).map((row) => JSON.stringify([row.scope, row.turnId, row.command]))
        : [],
    )
    const tools = pageTools
      .filter((tool) => !recorded.has(wrapperKeys.get(tool.id) ?? ''))
      .map((tool) => {
        const view = toolPresentation(tool.payload, tool.summary, tool.inputPayload)
        return {
          id: tool.sourceEventId ?? tool.id,
          ...(tool.sourceEventId ? { callId: tool.toolId } : {}),
          ...(tool.inputEventId ? { inputEventId: tool.inputEventId } : {}),
          time: tool.time,
          kind: tool.kind,
          scope: tool.scope,
          summary: view.title.slice(0, 200),
          status: tool.status,
          durationMs:
            tool.startedAt && tool.startedAt !== tool.time
              ? Math.max(0, Date.parse(tool.time) - Date.parse(tool.startedAt))
              : undefined,
          command: view.kind === 'command' && view.input ? view.input.slice(0, 400) : undefined,
          preview: view.output ? view.output.slice(-300) : undefined,
        }
      })
    return {
      events: [
        ...page.flatMap(({ id, time, kind, scope, summary }) =>
          kind === 'tool' ? [] : [{ id, time, kind, scope, summary: summary.slice(0, 200) }],
        ),
        ...tools,
      ].sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id)),
      before: page.length === 100 ? String(offset + page.length) : undefined,
    }
  }
  *toolPayloads(scope: string) {
    for (const row of this.db
      .prepare("SELECT payload FROM activity WHERE scope=? AND kind='tool' ORDER BY time,id")
      .iterate(scope))
      yield decode(mutableStruct({ payload: Schema.String }), row).payload
  }
}
