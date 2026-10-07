import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  messageSchema,
  turnSchema,
  mutableStruct,
  type Task,
  type Workspace,
} from '@dovo/protocol'
const rowSchema = mutableStruct({
  kind: Schema.Literals(['message', 'turn']),
  value: Schema.String,
})

/** History is authoritative in SQLite; workspace metadata never rewrites old messages. */
export class Conversations {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_items (
      task_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(task_id, kind, item_id));
      CREATE INDEX IF NOT EXISTS conversation_items_order ON conversation_items(task_id, kind, ordinal);`)
  }
  hydrate(
    workspace: Workspace,
    counts: Record<string, { messages: number; turns: number }>,
  ): Workspace {
    return {
      ...workspace,
      tasks: workspace.tasks.map((task) => {
        const rows = this.db
          .prepare('SELECT kind, value FROM conversation_items WHERE task_id = ? ORDER BY ordinal')
          .all(task.id)
          .map((row) => decode(rowSchema, row))
        const expected = counts[task.id]
        if (
          !expected ||
          rows.filter((row) => row.kind === 'message').length !== expected.messages ||
          rows.filter((row) => row.kind === 'turn').length !== expected.turns
        )
          throw new Error(
            `History for ${task.id} is incomplete. Restore the runtime database from a backup before continuing.`,
          )
        return {
          ...task,
          messages: rows
            .filter((row) => row.kind === 'message')
            .map((row) => decode(messageSchema, JSON.parse(row.value))),
          ...(task.turns !== undefined
            ? {
                turns: rows
                  .filter((row) => row.kind === 'turn')
                  .map((row) => decode(turnSchema, JSON.parse(row.value))),
              }
            : {}),
        }
      }),
    }
  }
  record(tasks: readonly Task[], previous: ReadonlyMap<string, Task>, seed: boolean) {
    if (seed) this.db.prepare('DELETE FROM conversation_items').run()
    const write = this.db.prepare(`INSERT INTO conversation_items VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, kind, item_id) DO UPDATE SET ordinal = excluded.ordinal, value = excluded.value`)
    const remove = this.db.prepare(
      'DELETE FROM conversation_items WHERE task_id = ? AND kind = ? AND item_id = ?',
    )
    for (const task of tasks) {
      const old = previous.get(task.id)
      if (!seed && task === old) continue
      for (const kind of ['message', 'turn'] as const) {
        const items = kind === 'message' ? task.messages : (task.turns ?? [])
        const before = kind === 'message' ? old?.messages : old?.turns
        if (!seed && items === before) continue
        const previousItems = new Map(before?.map((item, index) => [item.id, { item, index }]))
        const retained = new Set<string>()
        items.forEach((item, index) => {
          if (retained.has(item.id))
            throw new Error(
              `Duplicate ${kind} ID ${item.id} in ${task.id}. History was not changed.`,
            )
          retained.add(item.id)
          const prior = previousItems.get(item.id)
          if (seed || prior?.item !== item || prior.index !== index)
            write.run(task.id, kind, item.id, index, JSON.stringify(item))
        })
        for (const id of previousItems.keys()) if (!retained.has(id)) remove.run(task.id, kind, id)
      }
    }
    const retained = new Set(tasks.map((task) => task.id))
    for (const id of previous.keys())
      if (!retained.has(id))
        this.db.prepare('DELETE FROM conversation_items WHERE task_id = ?').run(id)
  }
}
