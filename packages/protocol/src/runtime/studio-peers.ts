import { Schema } from 'effect'
import { mutableStruct, mutableArray, minValue, maxValue } from '../shared/schema.js'
import { agentSchema } from '../workspace.js'
import { connectionSchema } from './connection/runtime.js'
import { studioToolsSchema } from './studio-tools.js'

/** Private client-to-local-runtime registration. Never include connections in tool output. */
export const studioPeerRegistrationSchema = mutableStruct({
  sessionId: minValue(Schema.String, 1),
  peers: maxValue(
    mutableArray(
      mutableStruct({
        id: minValue(Schema.String, 1),
        name: minValue(Schema.String, 1),
        connection: connectionSchema,
      }),
    ),
    100,
  ),
})
/** A paired credential grants runtime access; this envelope can only narrow it. */
export const studioForwardPolicySchema = mutableStruct({
  permissions: mutableStruct({
    provider: agentSchema.fields.provider,
    permission: agentSchema.fields.permission,
    approvalPolicy: agentSchema.fields.approvalPolicy,
    sandboxMode: agentSchema.fields.sandboxMode,
  }),
  readOnly: Schema.Boolean,
  studioTools: studioToolsSchema,
})
export type StudioForwardPolicy = typeof studioForwardPolicySchema.Type
