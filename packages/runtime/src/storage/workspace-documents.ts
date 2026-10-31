import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  mutableArray,
  mutableStruct,
  taskHistorySummaryVersion,
  taskMetadata,
  taskSchema,
} from '@dovo/protocol'
import type { TaskSummary, WorkspaceSummary } from '@dovo/protocol'
const valueSchema = Schema.UndefinedOr(mutableStruct({ value: Schema.String }))
const countSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
const historyCountsSchema = Schema.Record(
  Schema.String,
  mutableStruct({ messages: countSchema, turns: countSchema }),
)
const taskRowsSchema = mutableArray(
  mutableStruct({
    task_id: Schema.String,
    value: Schema.String,
    messages: countSchema,
    turns: countSchema,
  }),
)
const historyRowsSchema = mutableArray(
  mutableStruct({ task_id: Schema.String, value: Schema.String }),
)
export type HistoryCounts = Record<string, { messages: number; turns: number }>
/** A stored document before entity validation. `tasks` in `workspace` holds parsed task metadata,
 * or the verbatim row text when that metadata is not valid JSON. */
export interface StoredWorkspace {
  version: 1 | 2 | 3
  /** Verbatim workspace document, kept as the backup when entries must be omitted. */
  raw: string
  workspace: unknown
  /** Absent for version 1 documents, whose histories are still embedded. */
  historyCounts?: HistoryCounts
  /** Verbatim version 3 task rows, kept with a backup when a task cannot be loaded. */
  taskRows: ReadonlyMap<string, string>
  /** Serialized history summaries of version 3 tasks, where present. */
  historySummaries: ReadonlyMap<string, string>
}
const corrupt = () =>
  new Error(
    'The workspace history manifest is invalid. Restore the runtime database from a backup.',
  )

/** Version 3 storage keeps one metadata row per task and a small workspace shell that lists task
 * order. A task update rewrites only that task's row; histories remain in `conversation_items`.
 * Rows hold history counts, and `workspace_task_histories` holds each task's bounded history
 * summary in the same transactions, so loading the workspace reads no conversation. A missing or
 * stale summary is derived again from that task's history. */
export class WorkspaceDocuments {
  private readonly serializedTasks = new WeakMap<TaskSummary, string>()
  private readonly serializedHistories = new WeakMap<TaskSummary['history'], string>()
  private unreadableTaskIds: string[] = []
  private readonly recoveredTasks = new Map<
    string,
    { value: string; messages: number; turns: number }
  >()
  private checkedLegacyRecovery = false
  committed() {
    this.recoveredTasks.clear()
    this.checkedLegacyRecovery = false
  }
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_tasks (
      task_id TEXT PRIMARY KEY, value TEXT NOT NULL,
      messages INTEGER NOT NULL, turns INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_task_histories (
      task_id TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  }
  preserveUnreadableTasks(stored: StoredWorkspace | undefined, tasks: readonly { id: string }[]) {
    if (!stored) return
    const loaded = new Set(tasks.map((task) => task.id))
    if (stored.version === 3)
      this.unreadableTaskIds = [...stored.taskRows.keys()].filter((id) => !loaded.has(id))
    const recover = (workspace: unknown, counts: HistoryCounts, legacy: boolean) => {
      const parsed = decodeResult(mutableStruct({ tasks: mutableArray(Schema.Unknown) }), workspace)
      if (!parsed.success) throw corrupt()
      const seen = new Map<string, boolean>()
      for (const task of parsed.data.tasks) {
        const identity = decodeResult(mutableStruct({ id: Schema.String }), task)
        if (!identity.success || !identity.data.id) {
          if (!legacy) throw corrupt()
          throw new Error(
            'A legacy workspace backup has an ambiguous task identity. Restore it from a runtime backup.',
          )
        }
        const id = identity.data.id
        const valid = decodeResult(taskSchema, task).success
        if (seen.has(id) && (!valid || !seen.get(id))) throw corrupt()
        seen.set(id, valid)
        if (valid) continue
        if (legacy && loaded.has(id)) {
          console.error(
            `Legacy backup contains an unreadable task ${id} whose ID is already in use. Check the backup and history for possible overwritten data.`,
          )
          continue
        }
        if (legacy && stored.taskRows.has(id)) continue
        if (!legacy && loaded.has(id)) throw corrupt()
        if (
          legacy &&
          this.db
            .prepare('SELECT 1 FROM documents WHERE id = ?')
            .get(`workspace-deleted:tasks:${id}`) &&
          !this.db.prepare('SELECT 1 FROM conversation_items WHERE task_id = ? LIMIT 1').get(id)
        )
          continue
        if (!Object.hasOwn(counts, id)) throw corrupt()
        const row = { value: JSON.stringify(task), ...counts[id] }
        const existing = decode(
          Schema.UndefinedOr(
            mutableStruct({ value: Schema.String, messages: countSchema, turns: countSchema }),
          ),
          this.db
            .prepare('SELECT value, messages, turns FROM workspace_tasks WHERE task_id = ?')
            .get(id),
        )
        if (
          existing &&
          (existing.value !== row.value ||
            existing.messages !== row.messages ||
            existing.turns !== row.turns)
        )
          throw new Error(
            `Task ${id} has conflicting recovery records. Restore it from a runtime backup.`,
          )
        this.recoveredTasks.set(id, row)
        this.unreadableTaskIds.push(id)
      }
    }
    if (stored.version === 2) recover(stored.workspace, stored.historyCounts!, false)
    if (
      stored.version === 3 &&
      !this.db.prepare("SELECT 1 FROM documents WHERE id = 'workspace-v2-recovery-checked'").get()
    ) {
      const backup = decode(
        valueSchema,
        this.db.prepare("SELECT value FROM documents WHERE id = 'workspace-before-tasks-v3'").get(),
      )
      if (backup) {
        let parsed: unknown
        try {
          parsed = JSON.parse(backup.value)
        } catch {
          throw new Error(
            'The legacy workspace backup is not valid JSON. Restore it from a runtime backup.',
          )
        }
        const envelope = decodeResult(
          mutableStruct({
            storageVersion: Schema.Literal(2),
            workspace: Schema.Unknown,
            historyCounts: historyCountsSchema,
          }),
          parsed,
        )
        if (envelope.success) recover(envelope.data.workspace, envelope.data.historyCounts, true)
      }
      this.checkedLegacyRecovery = true
    }
  }
  read(): StoredWorkspace | undefined {
    const row = decode(
      valueSchema,
      this.db.prepare("SELECT value FROM documents WHERE id = 'workspace'").get(),
    )
    if (!row) return undefined
    const raw = row.value
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('The stored workspace is not valid JSON. Restore it from a runtime backup.')
    }
    const marker = decodeResult(mutableStruct({ storageVersion: Schema.Number }), parsed)
    if (!marker.success)
      return {
        version: 1,
        raw,
        workspace: parsed,
        taskRows: new Map(),
        historySummaries: new Map(),
      }
    if (marker.data.storageVersion === 2) {
      const envelope = decodeResult(
        mutableStruct({
          storageVersion: Schema.Literal(2),
          workspace: Schema.Unknown,
          historyCounts: historyCountsSchema,
        }),
        parsed,
      )
      if (!envelope.success) throw corrupt()
      return {
        version: 2,
        raw,
        workspace: envelope.data.workspace,
        historyCounts: envelope.data.historyCounts,
        taskRows: new Map(),
        historySummaries: new Map(),
      }
    }
    if (marker.data.storageVersion !== 3)
      throw new Error('This workspace uses a newer storage format. Update Dovo before opening it.')
    const envelope = decodeResult(
      mutableStruct({
        storageVersion: Schema.Literal(3),
        taskIds: mutableArray(Schema.String),
        workspace: Schema.Record(Schema.String, Schema.Unknown),
      }),
      parsed,
    )
    if (!envelope.success || new Set(envelope.data.taskIds).size !== envelope.data.taskIds.length)
      throw corrupt()
    const rows = new Map(
      decode(
        taskRowsSchema,
        this.db.prepare('SELECT task_id, value, messages, turns FROM workspace_tasks').all(),
      ).map((row) => [row.task_id, row]),
    )
    const historyCounts: HistoryCounts = {}
    const taskRows = new Map<string, string>()
    const historySummaries = new Map(
      decode(
        historyRowsSchema,
        this.db.prepare('SELECT task_id, value FROM workspace_task_histories').all(),
      ).map((row) => [row.task_id, row.value]),
    )
    const tasks = envelope.data.taskIds.map((id) => {
      const row = rows.get(id)
      if (!row)
        throw new Error(
          `Task ${id} is missing from the workspace. Restore the runtime database from a backup before continuing.`,
        )
      historyCounts[id] = { messages: row.messages, turns: row.turns }
      taskRows.set(id, row.value)
      let task: unknown
      try {
        task = JSON.parse(row.value)
      } catch {
        // Entity validation omits this task and keeps its row for recovery.
        return row.value
      }
      if (task && typeof task === 'object' && 'id' in task && task.id !== id) throw corrupt()
      return task
    })
    return {
      version: 3,
      raw,
      workspace: { ...envelope.data.workspace, tasks },
      historyCounts,
      taskRows,
      historySummaries,
    }
  }
  /** Writes the difference from the committed workspace, or every row when `full` is set. Callers
   * hold the enclosing transaction. Rows of tasks the runtime could not load are left in place. */
  write(next: WorkspaceSummary, previous: WorkspaceSummary, full: boolean) {
    if (this.unreadableTaskIds.length) {
      const ids = new Set(next.tasks.map((task) => task.id))
      for (const id of this.unreadableTaskIds)
        if (ids.has(id))
          throw new Error(
            `Task ${id} is unreadable and cannot be replaced. Restore it from a backup.`,
          )
    }
    const before = new Map(previous.tasks.map((task) => [task.id, task]))
    if (full) {
      const preserved = JSON.stringify(this.unreadableTaskIds)
      this.db
        .prepare(
          'DELETE FROM workspace_tasks WHERE task_id NOT IN (SELECT value FROM json_each(?))',
        )
        .run(preserved)
      this.db
        .prepare(
          'DELETE FROM workspace_task_histories WHERE task_id NOT IN (SELECT value FROM json_each(?))',
        )
        .run(preserved)
    }
    for (const [id, row] of this.recoveredTasks)
      this.db
        .prepare('INSERT INTO workspace_tasks VALUES (?, ?, ?, ?) ON CONFLICT(task_id) DO NOTHING')
        .run(id, row.value, row.messages, row.turns)
    if (this.checkedLegacyRecovery)
      this.db
        .prepare("INSERT OR IGNORE INTO documents VALUES ('workspace-v2-recovery-checked', 'done')")
        .run()
    const upsert = this.db.prepare(`INSERT INTO workspace_tasks VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET value = excluded.value, messages = excluded.messages,
      turns = excluded.turns`)
    const upsertHistory = this.db.prepare(`INSERT INTO workspace_task_histories VALUES (?, ?)
      ON CONFLICT(task_id) DO UPDATE SET value = excluded.value`)
    for (const task of next.tasks) {
      const old = before.get(task.id)
      if (!full && task === old) continue
      const value = this.serializeTask(task)
      const historyChanged = full || old?.history !== task.history
      if (historyChanged) upsertHistory.run(task.id, this.serializeHistory(task.history))
      if (!full && old && !historyChanged && this.serializeTask(old) === value) continue
      upsert.run(task.id, value, task.history.messages, task.history.turns ?? 0)
    }
    const retained = new Set(next.tasks.map((task) => task.id))
    if (!full)
      for (const id of before.keys())
        if (!retained.has(id)) {
          this.db.prepare('DELETE FROM workspace_tasks WHERE task_id = ?').run(id)
          this.db.prepare('DELETE FROM workspace_task_histories WHERE task_id = ?').run(id)
        }
    const shellChanged =
      full ||
      this.recoveredTasks.size > 0 ||
      next.tasks.length !== previous.tasks.length ||
      next.tasks.some((task, index) => task.id !== previous.tasks[index]?.id) ||
      new Set([...Object.keys(next), ...Object.keys(previous)]).size !== Object.keys(next).length ||
      Object.entries(next).some(
        ([key, value]) => key !== 'tasks' && value !== previous[key as keyof WorkspaceSummary],
      )
    if (!shellChanged) return
    // An empty v2 history manifest makes older runtimes report a newer format instead of
    // misreading this document; they never rewrite it.
    const shell = JSON.stringify({ ...next, tasks: undefined })
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      )
      .run(
        'workspace',
        `{"storageVersion":3,"historyCounts":{},"taskIds":${JSON.stringify([...next.tasks.map((task) => task.id), ...this.unreadableTaskIds])},"workspace":${shell}}`,
      )
  }
  /** Task rows keep the shape of a task with empty history, as earlier version 3 rows did. */
  private serializeTask(task: TaskSummary) {
    let value = this.serializedTasks.get(task)
    if (value === undefined) {
      value = JSON.stringify({
        ...taskMetadata(task),
        messages: [],
        ...(task.history.turns !== undefined ? { turns: [] } : {}),
      })
      this.serializedTasks.set(task, value)
    }
    return value
  }
  private serializeHistory(history: TaskSummary['history']) {
    let value = this.serializedHistories.get(history)
    if (value === undefined) {
      value = JSON.stringify({ version: taskHistorySummaryVersion, history })
      this.serializedHistories.set(history, value)
    }
    return value
  }
}
