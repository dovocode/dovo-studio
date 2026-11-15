import { Schema } from 'effect'
import { mutableStruct, maxValue } from '../../shared/schema.js'

export const nativeGoalSchema = mutableStruct({
  sessionId: Schema.String,
  objective: maxValue(Schema.String, 4000),
  status: Schema.Literals(['active', 'paused', 'complete']),
  rounds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  reason: Schema.optional(maxValue(Schema.String, 4000)),
})
