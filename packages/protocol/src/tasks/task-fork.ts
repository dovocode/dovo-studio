import { Schema } from 'effect'
import { attachmentIdsSchema } from '../shared/attachments.js'
import { maxValue, minValue, mutableStruct, uuidSchema } from '../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const startForkSchema = mutableStruct({
  id,
  forkId: uuidSchema,
  text: maxValue(Schema.String, 120000),
  attachmentIds: attachmentIdsSchema,
})
export const taskForkResultSchema = mutableStruct({ id })
