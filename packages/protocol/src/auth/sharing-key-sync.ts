import { Schema } from 'effect'
import { maxValue, mutableArray, mutableStruct } from '../shared/schema.js'
import { internetBoxSchema, internetKeySchema } from './account-internet.js'
import { sharingKeySchema } from '../conversation/encrypted-sharing.js'

export const sharingKeyPresenceSchema = mutableStruct({
  publicKey: internetKeySchema,
  hasKey: Schema.Boolean,
  keyHash: Schema.NullOr(internetKeySchema),
  /** Receiver may discard a specific failed answer without clearing a newer response. */
  rejectAnswer: Schema.optional(internetBoxSchema.fields.nonce),
})
export const sharingKeyAnswerSchema = mutableStruct({
  sender: internetKeySchema,
  recipient: internetKeySchema,
  box: internetBoxSchema,
})
export const sharingKeyInboxSchema = mutableStruct({
  keyHash: Schema.NullOr(internetKeySchema),
  requests: maxValue(mutableArray(internetKeySchema), 100),
  answer: Schema.NullOr(sharingKeyAnswerSchema),
})
export const sharingKeyTransferSchema = mutableStruct({
  origin: Schema.String,
  userId: Schema.String,
  recipient: internetKeySchema,
  key: sharingKeySchema,
})

/** Account-managed recovery is separate from the device-only transfer protocol. */
export const sharingRecoverySchema = mutableStruct({
  keyHash: Schema.NullOr(internetKeySchema),
  key: Schema.NullOr(sharingKeySchema),
})
export const sharingRecoverySaveSchema = mutableStruct({
  key: sharingKeySchema,
  /** Reset is only available for legacy identities with no recovery copy. */
  reset: Schema.optional(mutableStruct({ keyHash: Schema.NullOr(internetKeySchema) })),
})
