import { Schema } from 'effect'
import { strictStruct } from '../shared/schema.js'

const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
export const studioSourcePolicySchema = strictStruct({
  access: Schema.Literals(['off', 'session', 'persistent']),
  autoLoad: Schema.Boolean,
})
export type StudioSourcePolicy = typeof studioSourcePolicySchema.Type
export const studioSourcePolicyRequestSchema = strictStruct({
  owner: Schema.Literals(['dashboard', 'extension']),
  id,
  sourceId: id,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  policy: Schema.optionalKey(studioSourcePolicySchema),
})
export type StudioSourcePolicyRequest = typeof studioSourcePolicyRequestSchema.Type
