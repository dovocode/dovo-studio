import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { terminalSchema } from '../runtime/connection/runtime.js'

const authenticationProgressSchema = mutableStruct({
  status: Schema.Literals(['waiting', 'completed', 'failed']),
  output: Schema.String,
  urls: mutableArray(Schema.String),
  error: Schema.optional(Schema.String),
})

export const acpInspectionSchema = mutableStruct({
  authMethods: mutableArray(
    mutableStruct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optional(Schema.String),
      type: Schema.Literals(['agent', 'terminal']),
    }),
  ),
  canLogout: Schema.Boolean,
  authentication: Schema.optional(authenticationProgressSchema),
  terminal: Schema.optional(terminalSchema),
})
export const acpAuthenticationSchema = mutableStruct({
  ok: Schema.Boolean,
  terminal: Schema.optional(terminalSchema),
})
export const acpSessionsSchema = mutableStruct({
  sessions: mutableArray(
    mutableStruct({
      sessionId: Schema.String,
      cwd: Schema.String,
      title: Schema.optional(Schema.String),
      updatedAt: Schema.optional(Schema.String),
    }),
  ),
  nextCursor: Schema.optional(Schema.String),
  canDelete: Schema.Boolean,
})
