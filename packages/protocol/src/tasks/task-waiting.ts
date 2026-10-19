import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'

const identifier = maxValue(minValue(Schema.String, 1), 300)
export const taskWaitingRequestSchema = mutableStruct({
  taskId: identifier,
  unlink: Schema.optional(
    mutableStruct({
      kind: Schema.Literals(['pull', 'pipeline', 'thread']),
      repositoryId: identifier,
      runtimeId: Schema.optional(identifier),
      target: maxValue(minValue(Schema.String, 1), 2048),
    }),
  ),
})
export const taskWaitingSchema = mutableStruct({
  related: Schema.optional(
    mutableArray(
      mutableStruct({
        label: Schema.String,
        project: Schema.String,
        url: Schema.String,
      }),
    ),
  ),
  dependencies: mutableArray(
    mutableStruct({
      kind: Schema.Literals(['pull', 'pipeline', 'thread']),
      repositoryId: Schema.String,
      runtimeId: Schema.optional(identifier),
      runtimeIdentity: Schema.optional(identifier),
      target: Schema.String,
      label: Schema.String,
      project: Schema.String,
      url: Schema.String,
      status: Schema.String,
      checkedAt: Schema.String,
      lastSuccessAt: Schema.optional(Schema.String),
      pausedReason: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
    }),
  ),
})
export type TaskWaiting = typeof taskWaitingSchema.Type
