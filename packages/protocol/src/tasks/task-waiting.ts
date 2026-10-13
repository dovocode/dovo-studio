import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'

const identifier = maxValue(minValue(Schema.String, 1), 300)
export const taskWaitingRequestSchema = mutableStruct({
  taskId: identifier,
  unlink: Schema.optional(
    mutableStruct({
      kind: Schema.Literals(['pull', 'pipeline']),
      repositoryId: identifier,
      target: maxValue(minValue(Schema.String, 1), 2048),
    }),
  ),
})
export const taskWaitingSchema = mutableStruct({
  dependencies: mutableArray(
    mutableStruct({
      kind: Schema.Literals(['pull', 'pipeline']),
      repositoryId: Schema.String,
      target: Schema.String,
      label: Schema.String,
      project: Schema.String,
      url: Schema.String,
      status: Schema.String,
      checkedAt: Schema.String,
      pausedReason: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
    }),
  ),
})
export type TaskWaiting = typeof taskWaitingSchema.Type
