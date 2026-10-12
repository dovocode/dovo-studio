import { Schema } from 'effect'
import { minValue, mutableStruct } from './shared/schema.js'

export const threadWindowTargetSchema = mutableStruct({
  runtimeId: minValue(Schema.String, 1),
  taskId: minValue(Schema.String, 1),
  title: Schema.String,
})
export type ThreadWindowTarget = Schema.Schema.Type<typeof threadWindowTargetSchema>
export type ThreadWindowBridge = (target: ThreadWindowTarget) => Promise<void>
