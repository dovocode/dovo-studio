import {
  decode,
  decodeResult,
  mutableStruct,
  mutableArray,
  messageSchema,
  turnSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'
import Database from 'better-sqlite3'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { backupRuntimeDatabase } from './backup.js'

const countsSchema = mutableStruct({ messages: Schema.Number, turns: Schema.Number })
/** Version 2 embeds history counts in the workspace document; version 3 keeps them on task rows. */
function historyManifest(db: Database.Database, document: unknown, issues: string[]) {
  const tasks = decodeResult(
    mutableStruct({ storageVersion: Schema.Literal(3), taskIds: mutableArray(Schema.String) }),
    document,
  )
  if (tasks.success) {
    const counts: Record<string, Schema.Schema.Type<typeof countsSchema>> = {}
    const read = db.prepare('SELECT messages, turns FROM workspace_tasks WHERE task_id=?')
    for (const taskId of tasks.data.taskIds) {
      const row = decodeResult(countsSchema, read.get(taskId))
      if (row.success) counts[taskId] = row.data
      else issues.push(`${taskId}: task metadata record is missing or invalid`)
    }
    return counts
  }
  const manifest = decodeResult(
    mutableStruct({
      storageVersion: Schema.Literal(2),
      historyCounts: Schema.Record(Schema.String, countsSchema),
    }),
    document,
  )
  return manifest.success ? manifest.data.historyCounts : undefined
}

/** No WorkspaceStore or providers: damaged conversation records are exported verbatim, never rewritten. */
export async function exportRuntimeRecovery(databasePath: string, output: string) {
  await mkdir(output, { mode: 0o700 }) // Refuse an existing destination, preserving earlier exports.
  const snapshot = join(output, 'runtime.sqlite')
  await backupRuntimeDatabase(databasePath, snapshot)
  const db = new Database(snapshot, { readonly: true, fileMustExist: true })
  const report: { table: string; records: number; invalidJson: number }[] = []
  try {
    for (const table of ['documents', 'workspace_tasks', 'conversation_items', 'job_runs']) {
      if (
        !db
          .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', table)
      )
        continue
      const file = await open(join(output, `${table}.jsonl`), 'wx', 0o600)
      let records = 0,
        invalidJson = 0
      try {
        for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
          const record = decode(Schema.Record(Schema.String, Schema.Unknown), row)
          if (typeof record.value === 'string') {
            try {
              JSON.parse(record.value)
            } catch {
              invalidJson++
            }
          }
          await file.write(JSON.stringify(record) + '\n')
          records++
        }
      } finally {
        await file.close()
      }
      report.push({ table, records, invalidJson })
    }
    const issues: string[] = []
    const workspace = db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')
    if (workspace) {
      try {
        const value = decode(mutableStruct({ value: Schema.String }), workspace).value
        const manifest = historyManifest(db, JSON.parse(value), issues)
        if (manifest) {
          for (const [taskId, expected] of Object.entries(manifest)) {
            const rows = decode(
              mutableArray(mutableStruct({ kind: Schema.String, value: Schema.String })),
              db.prepare('SELECT kind, value FROM conversation_items WHERE task_id=?').all(taskId),
            )
            for (const kind of ['message', 'turn'] as const) {
              const items = rows.filter((row) => row.kind === kind)
              const count = kind === 'message' ? expected.messages : expected.turns
              if (items.length !== count)
                issues.push(`${taskId}: expected ${count} ${kind} records, found ${items.length}`)
              for (const [index, row] of items.entries()) {
                try {
                  const schema = kind === 'message' ? messageSchema : turnSchema
                  if (!decodeResult(schema, JSON.parse(row.value)).success)
                    issues.push(`${taskId}: invalid ${kind} record ${index}`)
                } catch {
                  issues.push(`${taskId}: invalid JSON in ${kind} record ${index}`)
                }
              }
            }
          }
        } else
          issues.push('Workspace history manifest could not be decoded; inspect documents.jsonl.')
      } catch (error) {
        issues.push(
          `History inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const file = await open(join(output, 'report.json'), 'wx', 0o600)
    try {
      await file.write(
        JSON.stringify(
          { integrity: db.pragma('quick_check'), tables: report, conversationIssues: issues },
          null,
          2,
        ),
      )
    } finally {
      await file.close()
    }
    return { output, snapshot, tables: report, conversationIssues: issues }
  } finally {
    db.close()
  }
}
