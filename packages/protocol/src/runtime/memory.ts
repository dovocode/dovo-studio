import { Effect, Schema, Struct } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, uuidSchema } from '../shared/schema.js'

export const memoryPageSize = 50

/** `bot` is private to one Bot coordinator thread. It is always on for that Bot and has no
 * scope switch. Management requests name the Bot with `botId` (the Bot's thread id). */
export const memoryScopeSchema = Schema.Literals(['system', 'project', 'projectless', 'bot'])
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
  botId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
})
const key = maxValue(minValue(Schema.String, 1), 120).pipe(
  Schema.check(Schema.isPattern(/^[^\0\r\n]+$/)),
  Schema.check(Schema.isPattern(/\S/)),
)
const revision = uuidSchema
export const memoryEvidenceSchema = mutableStruct({
  learnedAt: Schema.String,
  sources: maxValue(
    mutableArray(
      mutableStruct({
        messageId: maxValue(minValue(Schema.String, 1), 200),
        quote: maxValue(minValue(Schema.String, 1), 500),
      }),
    ),
    5,
  ),
})
export const botMemoryReviewSchema = mutableStruct({
  enabled: Schema.Boolean,
  revision: uuidSchema,
  cursor: Schema.optional(Schema.String),
  lastReviewedAt: Schema.optional(Schema.String),
  retryAt: Schema.optional(Schema.String),
  error: Schema.optional(maxValue(Schema.String, 500)),
})
export const botMemoryStatusSchema = mutableStruct({
  ...botMemoryReviewSchema.fields,
  running: Schema.Boolean,
})
export const botMemoryRequestSchema = mutableStruct({ botId: uuidSchema })
export const botHistorySearchSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  query: maxValue(minValue(Schema.String, 1), 200),
})
export const botMemoryConfigureSchema = mutableStruct({
  ...botMemoryRequestSchema.fields,
  expectedRevision: uuidSchema,
  enabled: Schema.Boolean,
})
export const botMemoryClearSchema = mutableStruct({
  ...botMemoryRequestSchema.fields,
  expectedRevision: uuidSchema,
})
export type BotMemoryReviewState = typeof botMemoryReviewSchema.Type
export type MemoryEvidence = typeof memoryEvidenceSchema.Type
export const memoryEntrySchema = mutableStruct({
  ...memoryScopeRequestSchema.fields,
  key,
  content: maxValue(minValue(Schema.String, 1), 16000).pipe(Schema.check(Schema.isPattern(/\S/))),
  revision,
  evidence: Schema.optional(memoryEvidenceSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.optional(Schema.String),
})
export const memoryMetadataSchema = mutableStruct(
  Struct.omit(memoryEntrySchema.fields, ['content']),
)
export const memoryReadSchema = mutableStruct({ ...memoryScopeRequestSchema.fields, key })
export const memoryWriteSchema = mutableStruct({
  ...memoryReadSchema.fields,
  content: memoryEntrySchema.fields.content,
  expectedRevision: Schema.optional(revision),
  expiresAt: Schema.optional(
    Schema.NullOr(
      Schema.String.pipe(
        Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)),
      ),
    ),
  ),
})
export const memoryVersionsSchema = mutableStruct({ entries: mutableArray(memoryEntrySchema) })
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
