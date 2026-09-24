import { Schema } from 'effect'
import { mutableArray, mutableStruct } from './schema.js'
import { terminalSchema } from './runtime.js'

export const acpInspectionSchema = mutableStruct({
  authMethods: mutableArray(
    mutableStruct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optional(Schema.String),
      type: Schema.Literal('agent', 'terminal'),
    }),
  ),
  canLogout: Schema.Boolean,
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
