import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
import { peerDiagnosticsSchema } from './peer-diagnostics.js'
const backupEntry = mutableStruct({
  path: Schema.String,
  size: Schema.Number,
  createdAt: Schema.String,
})
const scheduler = mutableStruct({
  lastSuccess: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})
const memoryOperation = mutableStruct({
  name: Schema.String,
  endedAt: Schema.String,
  durationMs: Schema.Number,
  heapGrowthBytes: Schema.Number,
})
/** Approximate: heap growth includes concurrent work and garbage-collection timing. */
export const runtimeMemoryDiagnosticsSchema = mutableStruct({
  sampledAt: Schema.String,
  heapUsedBytes: Schema.Number,
  heapLimitBytes: Schema.Number,
  rssBytes: Schema.Number,
  /** External memory includes ArrayBuffers; these values must not be summed. */
  externalBytes: Schema.optional(Schema.Number),
  arrayBufferBytes: Schema.optional(Schema.Number),
  gc: Schema.optional(mutableStruct({ collections: Schema.Number, durationMs: Schema.Number })),
  eventLoopUtilization: Schema.optional(Schema.Number),
  /** Null when this platform cannot list the runtime's own descendant processes. */
  children: Schema.NullOr(
    mutableStruct({ processes: Schema.Number, rssBytes: Schema.Number, truncated: Schema.Boolean }),
  ),
  recent: mutableArray(memoryOperation),
  spikes: mutableArray(
    mutableStruct({
      at: Schema.String,
      heapUsedBytes: Schema.Number,
      growthBytes: Schema.Number,
      externalBytes: Schema.optional(Schema.Number),
      externalGrowthBytes: Schema.optional(Schema.Number),
      rssBytes: Schema.Number,
      concurrentOperations: Schema.Number,
      suspects: mutableArray(
        mutableStruct({
          name: Schema.String,
          heapGrowthBytes: Schema.Number,
          running: Schema.Boolean,
        }),
      ),
    }),
  ),
})
export type RuntimeMemoryDiagnostics = Schema.Schema.Type<typeof runtimeMemoryDiagnosticsSchema>
export const runtimeDiagnosticsSchema = mutableStruct({
  ready: Schema.Boolean,
  checkedAt: Schema.String,
  warnings: mutableArray(Schema.String),
  internet: Schema.optional(peerDiagnosticsSchema),
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
  // Optional so clients keep reading runtimes released before memory attribution.
  memory: Schema.optional(runtimeMemoryDiagnosticsSchema),
})
export type RuntimeDiagnostics = Schema.Schema.Type<typeof runtimeDiagnosticsSchema>
export const runtimeBackupResponseSchema = backupEntry
