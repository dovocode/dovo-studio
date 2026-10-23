import { Schema } from 'effect'
import { accountUserSchema } from '../auth/account.js'
import { maxValue, minValue, mutableArray, mutableStruct, refine } from '../shared/schema.js'
import { artifactSchema, type Artifact } from './artifacts.js'

export const HOSTED_ARTIFACT_MAX_BYTES = 20 * 1024 * 1024
export { artifactServiceOrigin } from '../auth/service-urls.js'
export const artifactServiceSchema = mutableStruct({ origin: Schema.String })
export const artifactSessionSchema = mutableStruct({
  audience: Schema.String,
  user: accountUserSchema,
  expiresAt: Schema.Number,
})
export const artifactGrantSchema = mutableStruct({
  origin: Schema.String,
  token: Schema.String,
  expiresAt: Schema.Number,
})
// Deliberately excludes thread IDs, runtime addresses, credentials and conversation metadata.
export const artifactPublicationInputSchema = mutableStruct({
  sourceId: artifactSchema.fields.id,
  revision: artifactSchema.fields.revision,
  title: artifactSchema.fields.title,
  format: artifactSchema.fields.format,
  language: artifactSchema.fields.language,
  content: maxValue(Schema.String, HOSTED_ARTIFACT_MAX_BYTES),
  files: artifactSchema.fields.files,
  entrypoint: artifactSchema.fields.entrypoint,
})
export type ArtifactPublicationInput = typeof artifactPublicationInputSchema.Type
export function artifactPublicationInput(artifact: Artifact): ArtifactPublicationInput {
  return {
    sourceId: artifact.id,
    revision: artifact.revision,
    title: artifact.title,
    format: artifact.format,
    language: artifact.language,
    content: artifact.content,
    files: artifact.files,
    entrypoint: artifact.entrypoint,
  }
}
export const artifactPublicationSchema = mutableStruct({
  id: artifactSchema.fields.id,
  title: artifactSchema.fields.title,
  format: artifactSchema.fields.format,
  revision: artifactSchema.fields.revision,
  createdAt: Schema.String,
})
export type ArtifactPublication = typeof artifactPublicationSchema.Type
/** Owner-only index. Source IDs are never included in the public viewer metadata. */
export const artifactSourcePublicationSchema = mutableStruct({
  ...artifactPublicationSchema.fields,
  sourceId: artifactSchema.fields.id,
})
export type ArtifactSourcePublication = typeof artifactSourcePublicationSchema.Type
export const artifactSourcePublicationsSchema = mutableStruct({
  publications: mutableArray(artifactSourcePublicationSchema),
})
export const artifactPublicationResponseSchema = mutableStruct({
  publication: artifactPublicationSchema,
})
export const artifactPublicationsSchema = mutableStruct({
  publications: mutableArray(artifactPublicationSchema),
})
export const artifactInviteSchema = mutableStruct({
  userId: maxValue(minValue(Schema.String, 1), 500),
})
export const artifactLinkLifetimeSchema = refine(
  Schema.Number,
  (n) => [3600, 86400, 604800, 2592000].includes(n),
  'Choose a link lifetime of 1 hour, 1 day, 7 days or 30 days',
)
export const artifactLinkInputSchema = mutableStruct({ seconds: artifactLinkLifetimeSchema })
export const artifactAccessSchema = mutableStruct({
  invites: mutableArray(artifactInviteSchema),
  links: mutableArray(mutableStruct({ id: Schema.String, expiresAt: Schema.Number })),
  feed: Schema.optional(
    mutableStruct({
      generation: artifactSchema.fields.id,
      seconds: Schema.Number,
      expiresAt: Schema.Number,
    }),
  ),
})
export const artifactViewSchema = mutableStruct({
  publication: artifactPublicationSchema,
  content: Schema.String,
  owner: Schema.Boolean,
})
