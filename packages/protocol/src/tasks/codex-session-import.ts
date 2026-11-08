import { Schema } from 'effect'
import { mutableArray, mutableStruct, minValue, maxValue } from '../shared/schema.js'
import { messageSchema } from '../workspace.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const codexSessionDiscoverySchema = mutableStruct({
  repositoryId: id,
  agentId: Schema.optional(maxValue(Schema.String, 200)),
})
export const codexSessionSelectionSchema = mutableStruct({
  ...codexSessionDiscoverySchema.fields,
  key: id,
})
export const codexSessionImportSchema = mutableStruct({
  ...codexSessionSelectionSchema.fields,
  revision: id,
})
export const codexSessionCandidateSchema = mutableStruct({
  key: id,
  sessionId: id,
  title: Schema.String,
  cwd: Schema.String,
  updatedAt: Schema.String,
  model: Schema.String,
  taskId: Schema.optional(Schema.String),
})
export const codexSessionListSchema = mutableStruct({
  sessions: mutableArray(codexSessionCandidateSchema),
  notice: Schema.optional(Schema.String),
})
export const codexSessionPreviewSchema = mutableStruct({
  session: codexSessionCandidateSchema,
  revision: Schema.String,
  status: Schema.Literals(['available', 'active', 'missing-checkout', 'unknown', 'owned']),
  notice: Schema.String,
  messages: mutableArray(messageSchema),
  olderMessages: Schema.Number,
})
export const codexSessionImportResultSchema = mutableStruct({ id, existing: Schema.Boolean })
export type CodexSessionDiscovery = Schema.Schema.Type<typeof codexSessionDiscoverySchema>
export type CodexSessionSelection = Schema.Schema.Type<typeof codexSessionSelectionSchema>
export type CodexSessionImport = Schema.Schema.Type<typeof codexSessionImportSchema>
export type CodexSessionCandidate = Schema.Schema.Type<typeof codexSessionCandidateSchema>
export type CodexSessionPreview = Schema.Schema.Type<typeof codexSessionPreviewSchema>
