import { Schema } from 'effect'
import {
  decodeResult,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  uuidSchema,
} from '../shared/schema.js'

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024
export const artifactRetentionSchema = Schema.Literal(
  'forever',
  'immediately',
  '7-days',
  '30-days',
  '90-days',
)
export type ArtifactRetention = Schema.Schema.Type<typeof artifactRetentionSchema>
export const artifactRetentionChoices: ReadonlyArray<{ value: ArtifactRetention; label: string }> =
  [
    { value: 'forever', label: 'Keep forever' },
    { value: 'immediately', label: 'Delete immediately' },
    { value: '7-days', label: 'Delete after 7 days' },
    { value: '30-days', label: 'Delete after 30 days' },
    { value: '90-days', label: 'Delete after 90 days' },
  ]
export function artifactDeletionAt(since: string, policy: ArtifactRetention) {
  if (policy === 'forever') return undefined
  const days = { immediately: 0, '7-days': 7, '30-days': 30, '90-days': 90 }[policy]
  return new Date(Date.parse(since) + days * 86_400_000).toISOString()
}
const revisionSchema = Schema.Number.pipe(Schema.int(), Schema.positive())
export const artifactFormatSchema = Schema.Literal('markdown', 'html', 'svg', 'code')
const titleSchema = maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 200)
export const artifactScopeSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
})
export const artifactReferenceSchema = mutableStruct({
  id: uuidSchema,
  taskId: artifactScopeSchema.fields.taskId,
  title: titleSchema,
  format: artifactFormatSchema,
  revision: revisionSchema,
})
export const artifactMetadataSchema = mutableStruct({
  ...artifactReferenceSchema.fields,
  language: Schema.optional(maxValue(Schema.String, 80)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export const artifactSchema = mutableStruct({
  ...artifactMetadataSchema.fields,
  content: maxValue(Schema.String, ARTIFACT_MAX_BYTES),
})
export const artifactCreateSchema = mutableStruct({
  ...artifactScopeSchema.fields,
  title: titleSchema,
  format: artifactFormatSchema,
  content: artifactSchema.fields.content,
  language: artifactMetadataSchema.fields.language,
})
export const artifactUpdateSchema = mutableStruct({
  ...artifactCreateSchema.fields,
  id: uuidSchema,
  expectedRevision: revisionSchema,
})
export const artifactReadSchema = mutableStruct({
  ...artifactScopeSchema.fields,
  id: uuidSchema,
  revision: Schema.optional(revisionSchema),
})
export const artifactListSchema = mutableStruct({ artifacts: mutableArray(artifactMetadataSchema) })
export const artifactLibraryEntrySchema = mutableStruct({
  ...artifactMetadataSchema.fields,
  threadTitle: Schema.String,
  threadState: Schema.Literal('active', 'settled', 'archived'),
  deleteAt: Schema.optional(Schema.String),
})
export const artifactLibrarySchema = mutableStruct({
  artifacts: mutableArray(artifactLibraryEntrySchema),
})
export type ArtifactLibraryEntry = Schema.Schema.Type<typeof artifactLibraryEntrySchema>
export const artifactResponseSchema = mutableStruct({ artifact: artifactSchema })
export const artifactWriteResponseSchema = mutableStruct({ artifact: artifactMetadataSchema })
export const artifactVersionsSchema = mutableStruct({
  versions: mutableArray(artifactMetadataSchema),
})
export type Artifact = Schema.Schema.Type<typeof artifactSchema>
export type ArtifactMetadata = Schema.Schema.Type<typeof artifactMetadataSchema>
export type ArtifactReference = Schema.Schema.Type<typeof artifactReferenceSchema>
export type ArtifactCreate = Schema.Schema.Type<typeof artifactCreateSchema>
export type ArtifactUpdate = Schema.Schema.Type<typeof artifactUpdateSchema>
const artifactEnvelopeSchema = mutableStruct({ artifacts: mutableArray(artifactReferenceSchema) })
export function artifactReferences(payload: unknown): ArtifactReference[] {
  try {
    return (
      decodeResult(
        artifactEnvelopeSchema,
        typeof payload === 'string' ? JSON.parse(payload) : payload,
      ).data?.artifacts ?? []
    )
  } catch {
    return []
  }
}
export function artifactFile(artifact: Artifact) {
  const extension = { markdown: 'md', html: 'html', svg: 'svg', code: 'txt' }[artifact.format]
  return {
    name: `${
      artifact.title
        .replace(/[^\p{L}\p{N}._ -]/gu, '_')
        .replace(/^\.+/, '')
        .slice(0, 100) || 'artifact'
    }.${extension}`,
    mime: {
      markdown: 'text/markdown',
      html: 'text/html',
      svg: 'image/svg+xml',
      code: 'text/plain',
    }[artifact.format],
  }
}
/** Guest gets no host APIs, runtime credentials, network or navigation privileges. */
export function artifactPreviewHtml(content: string) {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'"
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${content}`
  const escaped = html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // The outer document is trusted and has no bridge to the guest. This also isolates iOS's native WebView channel.
  const outerPolicy = policy.replace("frame-src 'none'", 'frame-src about:')
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${outerPolicy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style><iframe title="Artifact preview" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'" srcdoc="${escaped}"></iframe>`
}
