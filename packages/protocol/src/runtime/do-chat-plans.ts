import { Schema } from 'effect'
import { doRunSchema } from './do.js'
import { maxValue, minValue, mutableArray, mutableStruct, strictStruct } from '../shared/schema.js'

/** Paired-client POST /api/do/chat/plans: review the proposals owned by a conversation. */
export const doChatPlansRequestSchema = strictStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
})
export const doChatPlansReplySchema = mutableStruct({ runs: mutableArray(doRunSchema) })
