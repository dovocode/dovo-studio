import { Schema } from 'effect'
import { connectServiceOriginSchema } from '../auth/service-urls.js'
import {
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  refine,
  uuidSchema,
} from '../shared/schema.js'
import { artifactReadSchema } from './artifacts.js'
import { artifactSessionSchema, artifactGrantSchema } from './artifact-sharing.js'

export const ARTIFACT_FEED_MAX_BYTES = 256 * 1024
export const artifactFeedQuerySchema = mutableStruct({
  server: maxValue(minValue(Schema.String, 1), 200),
  tool: maxValue(minValue(Schema.String, 1), 200),
  arguments: Schema.Record(Schema.String, Schema.Unknown),
  pointer: refine(
    maxValue(Schema.String, 1000),
    (value) => value === '' || /^(?:\/(?:[^~]|~[01])*)+$/.test(value),
    'Use an RFC 6901 JSON pointer, or leave empty for the whole value',
  ),
  seconds: refine(
    Schema.Number,
    (value) => [60, 300, 900].includes(value),
    'Choose 1, 5 or 15 minutes',
  ),
})
export type ArtifactFeedQuery = typeof artifactFeedQuerySchema.Type
export const artifactFeedPreviewSchema = mutableStruct({
  ...artifactReadSchema.fields,
  query: artifactFeedQuerySchema,
  consent: Schema.Literal(true),
})
export const artifactFeedPreviewResultSchema = mutableStruct({
  previewId: uuidSchema,
  data: Schema.Unknown,
  connectOrigin: Schema.optional(connectServiceOriginSchema),
})
export const artifactFeedToolSchema = mutableStruct({
  server: Schema.String,
  tool: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Unknown,
})
export const artifactFeedToolsSchema = mutableStruct({
  tools: mutableArray(artifactFeedToolSchema),
})
export const artifactFeedSessionSchema = mutableStruct({
  ...artifactSessionSchema.fields,
  publicationId: uuidSchema,
})
export const artifactFeedGrantSchema = mutableStruct({
  ...artifactGrantSchema.fields,
  publicationId: uuidSchema,
})
export const artifactFeedCredentialSchema = mutableStruct({
  ...artifactFeedGrantSchema.fields,
  generation: uuidSchema,
  connectOrigin: Schema.optional(connectServiceOriginSchema),
})
export type ArtifactFeedCredential = typeof artifactFeedCredentialSchema.Type
export const artifactFeedStatusSchema = mutableStruct({
  enabled: Schema.Boolean,
  error: Schema.String,
  generation: Schema.optional(uuidSchema),
})
export const artifactFeedEnableSchema = mutableStruct({
  previewId: uuidSchema,
  credential: artifactFeedCredentialSchema,
  consent: Schema.Literal(true),
})
export const artifactFeedDataSchema = mutableStruct({
  enabled: Schema.Boolean,
  data: Schema.Unknown,
  updatedAt: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.Number),
  seconds: Schema.Number,
})
export const artifactFeedLeaseSchema = mutableStruct({
  generation: uuidSchema,
  sourceId: uuidSchema,
  revision: Schema.Number,
  seconds: Schema.Number,
  expiresAt: Schema.Number,
})

/** Select data without evaluating code, following inherited properties or accepting invalid escapes. */
export function artifactFeedSelect(value: unknown, pointer: string): unknown {
  if (!pointer) return value
  if (!/^(?:\/(?:[^~]|~[01])*)+$/.test(pointer)) throw new Error('Invalid JSON pointer')
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error('Selected JSON field is unavailable')
    value = Object.getOwnPropertyDescriptor(value, key)?.value
  }
  return value
}

/** One-way data delivery only: the guest receives no tools, credentials or request channel. */
export const artifactFeedGuestScript = `<script>addEventListener('message',function(event){if(event.source!==parent||event.data?.type!=='dovo:artifact-data')return;window.dovoArtifactData=event.data.payload;dispatchEvent(new CustomEvent('dovo:artifact-data',{detail:event.data.payload}));});</script>`
