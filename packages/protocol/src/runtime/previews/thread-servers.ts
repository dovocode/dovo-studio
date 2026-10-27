import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, urlSchema } from '../../shared/schema.js'

export const threadServerRequestSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
})
export const threadServerSchema = mutableStruct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  /** OS process start identity; a reused PID is a different server. */
  started: Schema.String,
  name: Schema.String,
  source: Schema.Literals(['agent', 'terminal']),
  /** A confirmed loopback HTTP endpoint; non-web TCP services have no Open action. */
  url: Schema.optional(urlSchema({ protocol: /^http$/ })),
})
export type ThreadServer = Schema.Schema.Type<typeof threadServerSchema>
export const threadServersSchema = mutableStruct({
  servers: mutableArray(threadServerSchema),
  supported: Schema.Boolean,
})
export const stopThreadServerSchema = mutableStruct({
  ...threadServerRequestSchema.fields,
  pid: threadServerSchema.fields.pid,
  port: threadServerSchema.fields.port,
  started: maxValue(minValue(Schema.String, 1), 200),
})
