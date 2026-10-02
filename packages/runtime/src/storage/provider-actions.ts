import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'

export type ProviderAction = {
  id: string
  taskId: string
  attemptId: string
  kind: 'start' | 'steer' | 'interrupt' | 'checkpoint' | 'answer'
  state: 'pending' | 'dispatched' | 'acknowledged' | 'completed' | 'uncertain'
}
const rowSchema = mutableStruct({
  id: Schema.String,
  taskId: Schema.String,
  attemptId: Schema.String,
  kind: Schema.Literal('start', 'steer', 'interrupt', 'checkpoint', 'answer'),
  state: Schema.Literal('pending', 'dispatched', 'acknowledged', 'completed', 'uncertain'),
})

/** Dispatch uncertainty is durable. Never automatically repeat a process-bound action. */
export class ProviderActions {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS provider_actions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      kind TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS provider_actions_task_attempt ON provider_actions(task_id, attempt_id);`)
  }
  record(action: ProviderAction) {
    this.db
      .prepare(`INSERT INTO provider_actions VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
      .run(
        action.id,
        action.taskId,
        action.attemptId,
        action.kind,
        action.state,
        new Date().toISOString(),
      )
  }
  transition(id: string, state: ProviderAction['state']) {
    const result = this.db
      .prepare('UPDATE provider_actions SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, new Date().toISOString(), id)
    if (!result.changes) throw new Error(`Provider action ${id} was not recorded`)
  }
  recover() {
    // Checkpoints are locally repeatable using stable refs; provider calls are not.
    this.db
      .prepare(
        "UPDATE provider_actions SET state = 'uncertain' WHERE state = 'dispatched' AND kind != 'checkpoint'",
      )
      .run()
  }
  uncertain(taskId: string, attemptId?: string) {
    return this.list(taskId, attemptId).some((action) => action.state === 'uncertain')
  }
  state(id: string): ProviderAction['state'] | undefined {
    const row = this.db.prepare('SELECT state FROM provider_actions WHERE id = ?').get(id)
    return row ? decode(mutableStruct({ state: rowSchema.fields.state }), row).state : undefined
  }
  list(taskId: string, attemptId?: string): ProviderAction[] {
    return this.db
      .prepare(
        `SELECT id, task_id AS taskId, attempt_id AS attemptId, kind, state FROM provider_actions WHERE task_id = ? ${attemptId ? 'AND attempt_id = ?' : ''} ORDER BY updated_at, id`,
      )
      .all(...(attemptId ? [taskId, attemptId] : [taskId]))
      .map((row) => decode(rowSchema, row))
  }
  remove(taskId: string) {
    this.db.prepare('DELETE FROM provider_actions WHERE task_id = ?').run(taskId)
  }
}
