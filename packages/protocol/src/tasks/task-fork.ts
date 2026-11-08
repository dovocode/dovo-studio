import { Schema } from 'effect'
import { attachmentIdsSchema } from '../shared/attachments.js'
import { maxValue, minValue, mutableStruct, uuidSchema } from '../shared/schema.js'
import { mutableArray } from '../shared/schema.js'
import { fileSchema } from '../workspace.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const startForkSchema = mutableStruct({
  id,
  forkId: uuidSchema,
  text: maxValue(Schema.String, 120000),
  attachmentIds: attachmentIdsSchema,
})
export const taskForkResultSchema = mutableStruct({ id })
export const createSideThreadSchema = mutableStruct({
  id,
  childId: uuidSchema,
  objective: Schema.optional(maxValue(Schema.String, 120000)),
})
export const bringBackSideThreadSchema = mutableStruct({
  id,
  expectedDraft: Schema.optional(Schema.String),
})
export const bringBackSideThreadResultSchema = mutableStruct({
  id,
  receiptId: Schema.String,
  text: Schema.String,
})
export const sideThreadChangesSchema = mutableStruct({ id })
export const sideThreadChangesInputSchema = sideThreadChangesSchema
export const discardSideThreadSchema = mutableStruct({ id })
export const sideThreadChangesResultSchema = mutableStruct({
  before: Schema.String,
  after: Schema.String,
  files: mutableArray(fileSchema),
  omitted: mutableArray(Schema.String),
})
export type SideThreadChanges = Schema.Schema.Type<typeof sideThreadChangesResultSchema>
export const sideThreadFileSchema = mutableStruct({
  id,
  before: Schema.String,
  after: Schema.String,
  path: maxValue(minValue(Schema.String, 1), 4000),
  full: Schema.optional(Schema.Boolean),
})
export const sideThreadFilePreviewSchema = sideThreadFileSchema
