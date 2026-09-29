import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'

export const serverUpdateStatusSchema = mutableStruct({
  status: Schema.Literal('idle', 'queued', 'downloading', 'installing', 'complete', 'error'),
  version: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.Number),
  transferred: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
})
export type ServerUpdateStatus = Schema.Schema.Type<typeof serverUpdateStatusSchema>
