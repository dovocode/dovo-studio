import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  messageSourceFor,
  mutableArray,
  mutableStruct,
  routineChangeSchema,
  routineChangeSummary,
  routineCitedQuoteValid,
  routineOwnerWords,
  routineSourceQuote,
  ROUTINE_CHANGE_RETENTION,
  ROUTINE_CITED_QUOTE_MINIMUM,
  type Automation,
  type ChatMessage,
  type RoutineChange,
  type RoutineChangeSource,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError } from '../errors.js'

/** Who asked the runtime to change a routine. Only the runtime builds this value. */
export type RoutineActor =
  | {
      kind: 'agent'
      taskId: string
      /** Present only for a local agent run whose token names this thread and attempt. */
      runId?: string
      claimed?: { messageId: string; quote: string }
    }
  | { kind: 'person'; deviceName?: string }
  /** A paired device token that marked itself as agent access. */
  | { kind: 'agent-device' }

const rowsSchema = mutableArray(mutableStruct({ value: Schema.String }))

/** Create the change table at startup, outside any transaction. A table created inside a save
 * transaction would disappear again if that save rolled back. Existing routines have no rows;
 * clients show "Source not recorded" for them. */
export function createRoutineChangeTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS routine_changes (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, at TEXT NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS routine_changes_automation ON routine_changes(automation_id, at)`)
}

/** Runtime-written messages that older runtimes saved without a source. */
const RUNTIME_MESSAGE_PREFIXES = ['pr-watch:', 'pipeline-watch:']

/** Only a message that the runtime marked as the person's own counts. Agent replies, child
 * results, automation, webhook, watcher, thread-to-thread, imported and button messages carry
 * another source or role. Undo, redo, handoff and diff comment notes and older watcher messages
 * have no source, so they never count. */
export function isOwnerMessage(message: ChatMessage | undefined): message is ChatMessage {
  return (
    !!message &&
    message.role === 'user' &&
    messageSourceFor(message)?.kind === 'user' &&
    !RUNTIME_MESSAGE_PREFIXES.some((prefix) => message.id.startsWith(prefix)) &&
    !message.subagentResultId &&
    !!routineOwnerWords(message.text)
  )
}

/** Resolve and validate the source before any change is written. */
export function routineChangeSource(
  store: WorkspaceStore,
  actor: RoutineActor,
): RoutineChangeSource {
  if (actor.kind === 'person')
    return { kind: 'person', ...(actor.deviceName ? { deviceName: actor.deviceName } : {}) }
  if (actor.kind === 'agent-device') return { kind: 'agent' }
  const local = actor.runId !== undefined && store.get().tasks.some((t) => t.id === actor.taskId)
  // A forwarded or integration call has no thread here to check a claim against.
  if (!local) return { kind: 'agent' }
  if (actor.claimed) {
    const message = store.taskMessage(actor.taskId, actor.claimed.messageId)
    if (
      !isOwnerMessage(message) ||
      !routineCitedQuoteValid(routineOwnerWords(message.text), actor.claimed.quote)
    )
      throw new HttpError(
        400,
        `No change was made. source.quote must be exact words from your owner’s own message in this thread: at least ${ROUTINE_CITED_QUOTE_MINIMUM} characters, or a whole line or sentence. Agent, tool, webhook, automation, watcher and quoted content cannot be a source. Omit source to let Dovo record the current owner message.`,
      )
    return {
      kind: 'owner',
      taskId: actor.taskId,
      messageId: message.id,
      quote: actor.claimed.quote.trim(),
      cited: true,
    }
  }
  // The owner message that this exact attempt received. Steering keeps the same attempt.
  const message = [...store.task(actor.taskId).messages]
    .reverse()
    .find((item) => item.turnId === actor.runId && isOwnerMessage(item))
  if (!message) return { kind: 'agent', taskId: actor.taskId }
  return {
    kind: 'owner',
    taskId: actor.taskId,
    messageId: message.id,
    ...routineSourceQuote(message.text),
  }
}

/** Call inside the transaction that saves the routine, so both commit or neither does. */
export function recordRoutineChange(
  db: Database.Database,
  before: Automation | undefined,
  after: Automation,
  source: RoutineChangeSource,
  at = new Date().toISOString(),
) {
  const changes = routineChangeSummary(before, after)
  if (before && !changes.length) return undefined
  const change: RoutineChange = decode(routineChangeSchema, {
    id: randomUUID(),
    automationId: after.id,
    at,
    action: before ? 'updated' : 'created',
    source,
    changes,
  })
  db.prepare('INSERT INTO routine_changes VALUES (?,?,?,?)').run(
    change.id,
    change.automationId,
    change.at,
    JSON.stringify(change),
  )
  db.prepare(
    `DELETE FROM routine_changes WHERE automation_id=? AND id NOT IN (
      SELECT id FROM routine_changes WHERE automation_id=? ORDER BY at DESC, rowid DESC LIMIT ?)`,
  ).run(change.automationId, change.automationId, ROUTINE_CHANGE_RETENTION)
  return change
}

/** Newest first. Links are checked when read: a deleted message or thread keeps its quote. */
export function routineChanges(
  db: Database.Database,
  store: WorkspaceStore,
  automationId: string,
): RoutineChange[] {
  const rows = decode(
    rowsSchema,
    db
      .prepare(
        'SELECT value FROM routine_changes WHERE automation_id=? ORDER BY at DESC, rowid DESC LIMIT ?',
      )
      .all(automationId, ROUTINE_CHANGE_RETENTION),
  )
  const tasks = new Set(store.get().tasks.map((task) => task.id))
  return rows.map(({ value }) => {
    const change = decode(routineChangeSchema, JSON.parse(value))
    const source = change.source
    if (source.kind !== 'owner') return change
    const linkAvailable =
      tasks.has(source.taskId) && !!store.taskMessage(source.taskId, source.messageId)
    return { ...change, source: { ...source, linkAvailable } }
  })
}

export function forgetRoutineChanges(db: Database.Database, automationId: string) {
  db.prepare('DELETE FROM routine_changes WHERE automation_id=?').run(automationId)
}
