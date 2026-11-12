import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../../shared/schema.js'
import { internetBoxSchema, internetKeySchema } from '../../auth/account-internet.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const text = maxValue(minValue(Schema.String, 1), 4000)
export const secureInputDestinationSchema = Schema.Union([
  mutableStruct({
    kind: Schema.Literal('command'),
    command: text,
    args: maxValue(mutableArray(maxValue(Schema.String, 4000)), 64),
    /** Send exact text by default. The caller must explicitly request a trailing newline. */
    appendNewline: Schema.Boolean,
  }),
  mutableStruct({ kind: Schema.Literal('auth_callback'), installationId: id }),
])
export const secureInputRequestSchema = mutableStruct({
  key: id,
  title: maxValue(minValue(Schema.String, 1), 200),
  prompt: text,
  destination: secureInputDestinationSchema,
})
export const secureInputCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('request'), ...secureInputRequestSchema.fields }),
  mutableStruct({ action: Schema.Literal('status'), id }),
  mutableStruct({ action: Schema.Literal('cancel'), id }),
])
export const secureInputStatusSchema = Schema.Literals([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'expired',
])
/** Public metadata only. Neither snapshots nor tool responses contain the submitted value. */
export const pendingSecureInputSchema = mutableStruct({
  id,
  taskId: id,
  title: secureInputRequestSchema.fields.title,
  prompt: text,
  destination: secureInputDestinationSchema,
  directory: Schema.String,
  publicKey: internetKeySchema,
  expiresAt: Schema.String,
  status: secureInputStatusSchema,
})
export const secureInputReplySchema = mutableStruct({
  id,
  sender: internetKeySchema,
  box: mutableStruct({
    nonce: internetBoxSchema.fields.nonce,
    ciphertext: Schema.String.pipe(Schema.check(Schema.isPattern(/^(?:[a-f0-9]{2}){16,65536}$/))),
  }),
})
export const secureInputResultSchema = mutableStruct({ id, status: secureInputStatusSchema })
export type SecureInputRequest = typeof secureInputRequestSchema.Type
export type SecureInputCommand = typeof secureInputCommandSchema.Type
export type PendingSecureInput = typeof pendingSecureInputSchema.Type
export type SecureInputReply = typeof secureInputReplySchema.Type
export type SecureInputStatus = typeof secureInputStatusSchema.Type
