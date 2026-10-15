import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  messageSchema,
  mutableArray,
  taskMetadata,
  turnSchema,
  type Task,
  type TaskSummary,
} from '@dovo/protocol'
const rowsSchema = mutableArray(Schema.String)
const countsSchema = mutableArray(
  Schema.Struct({ task_id: Schema.String, kind: Schema.String, count: Schema.Number }),
)
type Message = Task['messages'][number]
type Turn = NonNullable<Task['turns']>[number]
interface Entry {
  /** The summary's history facts at the time this history was read or written. */
  history: TaskSummary['history']
  summary: TaskSummary
  task: Task
  bytes: number
}
export interface HistoryBudget {
  tasks: number
  bytes: number
}
const itemSizes = new WeakMap<object, number>()
/** An approximation of retained size that avoids serializing streaming items on every update. */
function itemBytes(item: Message | Turn) {
  let size = itemSizes.get(item)
  if (size !== undefined) return size
  if ('role' in item) size = 256 + item.text.length * 2 + (item.attachments?.length ?? 0) * 256
  else {
    size = 512
    for (const checkpoint of [item.checkpoint, ...(item.checkpoint?.linked ?? [])])
      for (const file of checkpoint?.files ?? [])
        size += (file.path.length + file.before.length + file.after.length) * 2
  }
  itemSizes.set(item, size)
  return size
}
function historyBytes(task: Pick<Task, 'messages' | 'turns'>) {
  let bytes = 0
  for (const message of task.messages) bytes += itemBytes(message)
  for (const turn of task.turns ?? []) bytes += itemBytes(turn)
  return bytes
}

/** Complete conversations, read from `conversation_items` on demand. At most `budget.tasks`
 * histories and approximately `budget.bytes` stay in memory, least recently used first out; the
 * most recent history stays even when it alone exceeds the byte budget. An entry is valid only
 * while the workspace still holds the summary facts it was read for, so rolled-back writes are
 * read again from SQLite rather than served from memory. */
export class TaskHistories {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  constructor(
    private readonly db: Database.Database,
    private readonly budget: HistoryBudget = { tasks: 32, bytes: 64 * 1024 * 1024 },
  ) {}
  /** The complete task, retained in the bounded cache. */
  get(summary: TaskSummary): Task {
    const entry = this.entries.get(summary.id)
    if (entry?.history === summary.history) {
      this.entries.delete(summary.id)
      this.entries.set(summary.id, entry)
      if (entry.summary !== summary) {
        entry.summary = summary
        entry.task = compose(summary, entry.task)
      }
      return entry.task
    }
    const task = this.peek(summary) ?? this.read(summary)
    this.remember(summary, task)
    return task
  }
  /** The cached complete task, without reading SQLite or changing recency. */
  peek(summary: TaskSummary): Task | undefined {
    const entry = this.entries.get(summary.id)
    if (entry?.history !== summary.history) return undefined
    return entry.summary === summary ? entry.task : compose(summary, entry.task)
  }
  /** The complete task without retaining it: for exports and legacy full snapshots. */
  load(summary: TaskSummary): Task {
    return this.peek(summary) ?? this.read(summary)
  }
  /** Retains a history that was just written for `summary`. */
  remember(summary: TaskSummary, task: Task) {
    this.forget(summary.id)
    const bytes = historyBytes(task)
    this.entries.set(summary.id, { history: summary.history, summary, task, bytes })
    this.bytes += bytes
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.budget.tasks && this.bytes <= this.budget.bytes) break
      if (id === summary.id) break
      this.entries.delete(id)
      this.bytes -= entry.bytes
    }
  }
  forget(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.bytes -= entry.bytes
  }
  /** Retained histories, for tests and diagnostics. */
  retained() {
    return { tasks: [...this.entries.keys()], bytes: this.bytes }
  }
  /** Stored counts for every task, without reading any history. */
  counts() {
    const counts = new Map<string, { messages: number; turns: number }>()
    for (const row of decode(
      countsSchema,
      this.db
        .prepare(
          'SELECT task_id, kind, COUNT(*) AS count FROM conversation_items GROUP BY task_id, kind',
        )
        .all(),
    )) {
      const entry = counts.get(row.task_id) ?? { messages: 0, turns: 0 }
      if (row.kind === 'message') entry.messages = row.count
      else if (row.kind === 'turn') entry.turns = row.count
      counts.set(row.task_id, entry)
    }
    return counts
  }
  /** Attachment IDs referenced by any stored message, read inside SQLite. */
  attachmentIds() {
    return new Set(
      decode(
        rowsSchema,
        this.db
          .prepare(
            `SELECT DISTINCT json_extract(attachment.value, '$.id') AS id
            FROM conversation_items AS item, json_each(item.value, '$.attachments') AS attachment
            WHERE item.kind = 'message' AND instr(item.value, '"attachments"') > 0 AND id IS NOT NULL`,
          )
          .pluck()
          .all(),
      ),
    )
  }
  /** Reads one complete history. Counts that differ from the committed summary fail closed. */
  private read(summary: TaskSummary): Task {
    const rows = this.db.prepare(
      'SELECT value FROM conversation_items WHERE task_id = ? AND kind = ? ORDER BY ordinal',
    )
    const messages = decode(rowsSchema, rows.pluck().all(summary.id, 'message'))
    const turns = decode(rowsSchema, rows.pluck().all(summary.id, 'turn'))
    if (
      messages.length !== summary.history.messages ||
      turns.length !== (summary.history.turns ?? 0)
    )
      throw new Error(
        `History for ${summary.id} is incomplete. Restore the runtime database from a backup before continuing.`,
      )
    return {
      ...taskMetadata(summary),
      messages: messages.map((value) => decode(messageSchema, JSON.parse(value))),
      ...(summary.history.turns !== undefined
        ? { turns: turns.map((value) => decode(turnSchema, JSON.parse(value))) }
        : {}),
    }
  }
}
function compose(summary: TaskSummary, history: Pick<Task, 'messages' | 'turns'>): Task {
  return {
    ...taskMetadata(summary),
    messages: history.messages,
    ...(history.turns !== undefined ? { turns: history.turns } : {}),
  }
}
