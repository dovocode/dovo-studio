import { Schema } from 'effect'
import { mutableArray, mutableStruct, maxValue, minValue } from '../../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const nativeThreadReadSchema = mutableStruct({
  taskId: id,
  id,
  provider: id,
  sessionId: Schema.optional(id),
  before: Schema.optional(id),
})
export const nativeThreadEntrySchema = mutableStruct({
  id: Schema.String,
  role: Schema.Literals(['user', 'assistant', 'tool', 'reasoning']),
  text: Schema.String,
  label: Schema.optional(Schema.String),
})
export type NativeThreadEntry = Schema.Schema.Type<typeof nativeThreadEntrySchema>
export const nativeThreadPageSchema = mutableStruct({
  entries: mutableArray(nativeThreadEntrySchema),
  before: Schema.optional(Schema.String),
  notice: Schema.optional(Schema.String),
})
export type NativeThreadPage = Schema.Schema.Type<typeof nativeThreadPageSchema>
export type NativeThreadRead = Schema.Schema.Type<typeof nativeThreadReadSchema>
