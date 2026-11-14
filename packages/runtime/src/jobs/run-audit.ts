import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, runAuditSchema, taskFamilyIds } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { StoredRun } from './run-state.js'
import { redact } from '../storage/activity.js'

/** Only isolated step workers and their descendants belong to this audit. Never claim a
 * coordinator Bot's shared history, even for older runs that executed there directly. */
export function runAudit(
  db: Database.Database,
  store: WorkspaceStore,
  run: StoredRun,
  roots: readonly string[],
  offset: number,
  output: boolean,
) {
  const workspace = store.get()
  const generatedAt = new Date().toISOString()
  const through = run.finishedAt ?? generatedAt
  const ids = new Set(roots.flatMap((id) => [...taskFamilyIds(workspace.tasks, id)]))
  for (const task of workspace.tasks) if (task.bot) ids.delete(task.id)
  const threads = workspace.tasks
    .filter((task) => ids.has(task.id))
    .map((task) => ({
      id: task.id,
      title: String(redact(task.title)),
      turns: (store.task(task.id).turns ?? [])
        .filter((turn) => turn.startedAt >= run.createdAt && turn.startedAt <= through)
        .map((turn) => ({
          id: turn.id,
          provider: turn.provider,
          model: turn.model,
          startedAt: turn.startedAt,
          finishedAt: turn.finishedAt,
          status: turn.status,
          tokens: turn.tokens,
          estimatedCostUsd: turn.estimatedCostUsd,
          mixedModels: turn.mixedModels,
        })),
    }))
  const turns = threads.flatMap((task) => task.turns)
  const event = mutableStruct({
    id: Schema.String,
    time: Schema.String,
    kind: Schema.String,
    taskId: Schema.String,
    summary: Schema.String,
    payload: Schema.optional(Schema.String),
    outputTruncated: Schema.optional(Schema.Number),
  })
  const scopes = [...ids]
  const events = !scopes.length
    ? []
    : decode(
        mutableArray(event),
        db
          .prepare(
            `SELECT id,time,kind,scope AS taskId,substr(summary,1,2000) AS summary${output ? ',substr(payload,1,32768) AS payload,length(payload)>32768 AS outputTruncated' : ''} FROM activity
     WHERE scope IN (${scopes.map(() => '?').join(',')}) AND time>=? AND time<=?
     AND kind IN ('command','tool','agent-event') ORDER BY time,id LIMIT 101 OFFSET ?`,
          )
          .all(...scopes, run.createdAt, through, offset),
      )
  return decode(runAuditSchema, {
    runId: run.id,
    automationId: run.automationId,
    generatedAt,
    threads,
    events: events.slice(0, 100).map((event) => ({
      ...event,
      summary: String(redact(event.summary)),
      payload: event.payload === undefined ? undefined : String(redact(event.payload)),
      outputTruncated: event.outputTruncated === undefined ? undefined : !!event.outputTruncated,
    })),
    nextOffset: events.length > 100 ? offset + 100 : undefined,
    estimatedCostUsd: turns.reduce((sum, turn) => sum + (turn.estimatedCostUsd ?? 0), 0),
    tokens: turns.reduce((sum, turn) => sum + (turn.tokens ?? 0), 0),
    usageIncomplete: turns.some(
      (turn) => turn.tokens === undefined || turn.estimatedCostUsd === undefined,
    ),
  })
}
