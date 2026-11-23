import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { routineChangeSchema } from './routine-provenance.js'

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
  /** Redacted input from a recorded MCP event, loaded with first-page output. */
  mcpEventInput: Schema.optional(Schema.Json),
  results: Schema.optional(
    mutableArray(
      mutableStruct({
        nodeId: Schema.String,
        taskId: Schema.String,
        attempt: Schema.Number,
        turnId: Schema.String,
        value: Schema.Json,
      }),
    ),
  ),
  estimatedCostUsd: Schema.Number,
  tokens: Schema.Number,
  usageIncomplete: Schema.Boolean,
  /** The newest recorded routine change before this run started, with its source. */
  routineChange: Schema.optional(routineChangeSchema),
})
