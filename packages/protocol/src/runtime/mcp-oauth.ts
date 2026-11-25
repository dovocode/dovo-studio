import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'

/** Identifies one OAuth connection on a computer: the server name and its exact URL. */
export const mcpOAuthServerSchema = mutableStruct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
  scope: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
})
export type McpOAuthServer = typeof mcpOAuthServerSchema.Type

export const mcpOAuthConnectionStateSchema = Schema.Literals([
  'connected',
  'expired',
  'disconnected',
])
export const mcpOAuthStatusSchema = mutableStruct({
  name: Schema.String,
  url: Schema.String,
  state: mcpOAuthConnectionStateSchema,
  /** Access token expiry. Dovo refreshes it automatically when a refresh token exists. */
  expiresAt: Schema.optional(Schema.String),
  refreshable: Schema.Boolean,
  scope: Schema.optional(Schema.String),
  connectedAt: Schema.optional(Schema.String),
})
export type McpOAuthStatus = typeof mcpOAuthStatusSchema.Type

export const mcpOAuthStatusListSchema = mutableStruct({
  statuses: mutableArray(mcpOAuthStatusSchema),
})

export const mcpOAuthFlowSchema = mutableStruct({
  flowId: Schema.String,
  authorizationUrl: Schema.String,
  /** Loopback address on the computer. Paste the browser address from another device. */
  redirectUri: Schema.String,
  expiresAt: Schema.String,
})
export type McpOAuthFlow = typeof mcpOAuthFlowSchema.Type

export const mcpOAuthFlowStateSchema = mutableStruct({
  flowId: Schema.String,
  state: Schema.Literals(['pending', 'connected', 'failed', 'expired', 'cancelled']),
  error: Schema.optional(Schema.String),
})
export type McpOAuthFlowState = typeof mcpOAuthFlowStateSchema.Type

export const mcpOAuthCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('status'), servers: mutableArray(mcpOAuthServerSchema) }),
  mutableStruct({ action: Schema.Literal('connect'), server: mcpOAuthServerSchema }),
  mutableStruct({ action: Schema.Literal('flow'), flowId: Schema.String }),
  mutableStruct({
    action: Schema.Literal('complete'),
    flowId: Schema.String,
    callbackUrl: Schema.String.check(Schema.isMaxLength(8000)),
  }),
  mutableStruct({ action: Schema.Literal('cancel'), flowId: Schema.String }),
  mutableStruct({ action: Schema.Literal('disconnect'), server: mcpOAuthServerSchema }),
])
export type McpOAuthCommand = typeof mcpOAuthCommandSchema.Type
export const mcpOAuthDisconnectSchema = mutableStruct({
  /** False when the provider has no revocation endpoint or rejected revocation. */
  revoked: Schema.Boolean,
})
