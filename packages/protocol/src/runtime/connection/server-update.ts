import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'

export const serverUpdateStatusSchema = mutableStruct({
  status: Schema.Literal(
    'idle',
    'queued',
    'downloading',
    'downloaded',
    'installing',
    'complete',
    'error',
  ),
  version: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.Number),
  transferred: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
})
export type ServerUpdateStatus = Schema.Schema.Type<typeof serverUpdateStatusSchema>

// Written by the desktop process in its private data directory; never returned to clients.
export const desktopUpdateHostSchema = mutableStruct({
  version: Schema.optional(Schema.String),
  pid: Schema.Number.pipe(Schema.int(), Schema.positive()),
  port: Schema.Number.pipe(Schema.int(), Schema.between(1, 65535)),
  token: Schema.String.pipe(Schema.minLength(32)),
})
