import { Effect, Schema, Struct } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, uuidSchema } from '../shared/schema.js'

export const memoryPageSize = 50

export const memoryScopeSchema = Schema.Literals(['system', 'project', 'projectless'])
export const memorySettingsSchema = mutableStruct({
  systemEnabled: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  projectlessEnabled: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  projectRepositoryIds: mutableArray(maxValue(minValue(Schema.String, 1), 200)).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => [])),
  ),
})
export const memoryScopeRequestSchema = mutableStruct({
  scope: memoryScopeSchema,
  repositoryId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
})
const key = maxValue(minValue(Schema.String, 1), 120).pipe(
  Schema.check(Schema.isPattern(/^[^\0\r\n]+$/)),
  Schema.check(Schema.isPattern(/\S/)),
)
const revision = uuidSchema
export const memoryEntrySchema = mutableStruct({
  ...memoryScopeRequestSchema.fields,
  key,
  content: maxValue(minValue(Schema.String, 1), 16000).pipe(Schema.check(Schema.isPattern(/\S/))),
  revision,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export const memoryMetadataSchema = mutableStruct(
  Struct.omit(memoryEntrySchema.fields, ['content']),
)
export const memoryReadSchema = mutableStruct({ ...memoryScopeRequestSchema.fields, key })
export const memoryWriteSchema = mutableStruct({
  ...memoryReadSchema.fields,
  content: memoryEntrySchema.fields.content,
  expectedRevision: Schema.optional(revision),
})
export const memoryDeleteSchema = mutableStruct({
  ...memoryReadSchema.fields,
  expectedRevision: revision,
})
export const memoryListSchema = mutableStruct({
  entries: mutableArray(memoryEntrySchema),
  total: Schema.Number,
})
export const memoryListRequestSchema = mutableStruct({
  ...memoryScopeRequestSchema.fields,
  query: Schema.optional(maxValue(Schema.String, 200)),
  offset: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  ),
})
export const memoryConfigureSchema = mutableStruct({
  ...memoryScopeRequestSchema.fields,
  enabled: Schema.Boolean,
})
export type MemoryScope = typeof memoryScopeSchema.Type
export type MemoryScopeRequest = typeof memoryScopeRequestSchema.Type
export type MemoryEntry = typeof memoryEntrySchema.Type
export type MemorySettings = typeof memorySettingsSchema.Type
export type MemoryWrite = typeof memoryWriteSchema.Type
export type MemoryDelete = typeof memoryDeleteSchema.Type
export type MemoryListRequest = typeof memoryListRequestSchema.Type

export const memoryProjectsSchema = mutableStruct({
  projects: mutableArray(
    mutableStruct({ id: Schema.String, name: Schema.String, registered: Schema.Boolean }),
  ),
})
