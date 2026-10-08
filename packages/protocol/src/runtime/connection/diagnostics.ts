import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
const backupEntry = mutableStruct({
  path: Schema.String,
  size: Schema.Number,
  createdAt: Schema.String,
})
const scheduler = mutableStruct({
  lastSuccess: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})
export const runtimeDiagnosticsSchema = mutableStruct({
  ready: Schema.Boolean,
  checkedAt: Schema.String,
  warnings: mutableArray(Schema.String),
  roots: mutableStruct({
    database: Schema.String,
    worktrees: Schema.String,
    worktreesSource: Schema.String,
  }),
  storage: mutableStruct({
    available: Schema.Boolean,
    freeBytes: Schema.NullOr(Schema.Number),
    error: Schema.NullOr(Schema.String),
  }),
  schedulers: mutableStruct({
    tasks: scheduler,
    jobs: scheduler,
    errors: mutableArray(mutableStruct({ id: Schema.String, error: Schema.String })),
  }),
  queues: mutableStruct({
    queued: Schema.Number,
    paused: Schema.Number,
    waitingQuestions: Schema.Number,
    waitingApprovals: Schema.Number,
  }),
  operations: mutableArray(
    mutableStruct({
      taskId: Schema.String,
      title: Schema.String,
      durationMs: Schema.Number,
      state: Schema.String,
    }),
  ),
  uncertain: mutableStruct({
    count: Schema.Number,
    actions: mutableArray(
      mutableStruct({ taskId: Schema.String, kind: Schema.String, updatedAt: Schema.String }),
    ),
  }),
  backups: mutableStruct({
    entries: mutableArray(backupEntry),
    failure: Schema.NullOr(mutableStruct({ at: Schema.String, message: Schema.String })),
    active: Schema.Boolean,
    maxCount: Schema.Number,
    maxBytes: Schema.Number,
  }),
})
export type RuntimeDiagnostics = Schema.Schema.Type<typeof runtimeDiagnosticsSchema>
export const runtimeBackupResponseSchema = backupEntry
