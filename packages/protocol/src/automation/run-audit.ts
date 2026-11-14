import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'

export const runAuditSchema = mutableStruct({
  runId: Schema.String,
  automationId: Schema.String,
  generatedAt: Schema.String,
  threads: mutableArray(
    mutableStruct({
      id: Schema.String,
      title: Schema.String,
      turns: mutableArray(
        mutableStruct({
          id: Schema.String,
          provider: Schema.String,
          model: Schema.String,
          startedAt: Schema.String,
          finishedAt: Schema.optional(Schema.String),
          status: Schema.String,
          tokens: Schema.optional(Schema.Number),
          estimatedCostUsd: Schema.optional(Schema.Number),
          mixedModels: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
  events: mutableArray(
    mutableStruct({
      id: Schema.String,
      time: Schema.String,
      kind: Schema.String,
      taskId: Schema.String,
      summary: Schema.String,
      payload: Schema.optional(Schema.String),
      outputTruncated: Schema.optional(Schema.Boolean),
    }),
  ),
  nextOffset: Schema.optional(Schema.Number),
  estimatedCostUsd: Schema.Number,
  tokens: Schema.Number,
  usageIncomplete: Schema.Boolean,
})
