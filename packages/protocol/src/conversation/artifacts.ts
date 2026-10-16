import { Schema } from 'effect'
import {
  decodeResult,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  uuidSchema,
} from '../shared/schema.js'

export const ARTIFACT_MAX_BYTES = 100 * 1024 * 1024
export const artifactRetentionSchema = Schema.Literals([
  'forever',
  'immediately',
  '7-days',
  '30-days',
  '90-days',
])
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
const revisionSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0)),
)
export const artifactFormatSchema = Schema.Literals(['markdown', 'html', 'svg', 'code'])
const titleSchema = maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 200)
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
export const artifactDeleteSchema = mutableStruct({
  ...artifactScopeSchema.fields,
  id: uuidSchema,
  expectedRevision: revisionSchema,
})
export const artifactAttachSchema = mutableStruct({
  ...artifactReadSchema.fields,
  targetTaskId: artifactScopeSchema.fields.taskId,
})
export const artifactSnapshotSchema = mutableStruct({
  image: Schema.optional(Schema.String),
  excerpt: Schema.String,
})
export const artifactPdfResponseSchema = mutableStruct({
  name: Schema.String,
  mime: Schema.Literal('application/pdf'),
  data: Schema.String,
})
export const artifactDeleteResponseSchema = mutableStruct({ ok: Schema.Boolean })
export const artifactLinkSchema = mutableStruct({
  url: Schema.String,
  title: titleSchema,
  provider: Schema.Literals(['claude', 'chatgpt']),
})
export type ArtifactLink = Schema.Schema.Type<typeof artifactLinkSchema>
export const artifactListSchema = mutableStruct({
  artifacts: mutableArray(artifactMetadataSchema),
  links: Schema.optional(mutableArray(artifactLinkSchema)),
})
export const artifactLibraryEntrySchema = mutableStruct({
  ...artifactMetadataSchema.fields,
  threadTitle: Schema.String,
  threadState: Schema.Literals(['active', 'settled', 'archived']),
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
export const artifactFormatLabels: Record<ArtifactReference['format'], string> = {
  markdown: 'Document',
  html: 'Interactive',
  svg: 'Graphic',
  code: 'Code',
}
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
export type ArtifactPreviewTheme = {
  mode: 'light' | 'dark'
  background: string
  foreground: string
  surface: string
  border: string
  accent: string
}
/** Guest gets no host APIs, runtime credentials, network or navigation privileges. */
function artifactDocument(content: string, theme?: ArtifactPreviewTheme) {
  const dark = theme?.mode === 'dark'
  const defaults = dark
    ? {
        background: '#080808',
        foreground: '#ededed',
        surface: '#101010',
        border: '#282828',
        accent: '#7cc9ff',
      }
    : {
        background: '#f7f8fa',
        foreground: '#151515',
        surface: '#ffffff',
        border: '#dddddd',
        accent: '#0965b5',
      }
  // Restrict interpolated colors so theme values can never inject guest or wrapper markup.
  const color = (name: keyof typeof defaults) => {
    const value = theme?.[name]
    return value && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      ? value
      : defaults[name]
  }
  const variables = (['background', 'foreground', 'surface', 'border', 'accent'] as const)
    .map((name) => `--preview-${name}:${color(name)}`)
    .join(';')
  const themeStyle = `:where(:root){${variables};color-scheme:${dark ? 'dark' : 'light'}}
:where(html){min-height:100%;background:var(--preview-background);color:var(--preview-foreground)}
:where(body){font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.6}
:where(button,input,select,textarea){font:inherit;color:inherit}
:where(button,input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea){background:var(--preview-surface);border:1px solid var(--preview-border);border-radius:8px;padding:6px 10px}
:where(button){cursor:pointer}
:where(a){color:var(--preview-accent);text-underline-offset:3px}
:where(:focus-visible){outline:2px solid var(--preview-accent);outline-offset:2px}
:where(code,pre){font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
:where(table){border-collapse:collapse}
:where(th,td){padding:8px 12px;border-bottom:1px solid var(--preview-border);text-align:left}`
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'"
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${themeStyle}</style>${content}`
  return { html, policy, background: color('background'), foreground: color('foreground'), dark }
}

/** A standalone guest for paginated printing; deliver the policy as an HTTP header. */
export function artifactPrintDocument(content: string) {
  const document = artifactDocument(content, {
    mode: 'light',
    background: '#ffffff',
    foreground: '#151515',
    surface: '#ffffff',
    border: '#dddddd',
    accent: '#0965b5',
  })
  return { html: document.html, policy: `sandbox allow-scripts; ${document.policy}` }
}

/** Guest gets no host APIs, runtime credentials, network or navigation privileges. */
export function artifactPreviewHtml(content: string, theme?: ArtifactPreviewTheme) {
  const { html, policy, background, foreground, dark } = artifactDocument(content, theme)
  const escaped = html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // The outer document is trusted and has no bridge to the guest. This also isolates iOS's native WebView channel.
  const outerPolicy = policy.replace("frame-src 'none'", 'frame-src about:')
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${outerPolicy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:${background};color:${foreground};color-scheme:${dark ? 'dark' : 'light'}}iframe{border:0;width:100%;height:100%;display:block}</style><iframe title="Artifact preview" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'" srcdoc="${escaped}"></iframe>`
}

/** Fence arbitrary source without allowing embedded fences to become Markdown markup. */
export function artifactSourceMarkdown(
  artifact: Pick<Artifact, 'content' | 'format' | 'language'>,
) {
  const runs = artifact.content.match(/`+/g) ?? []
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3))
  const language =
    artifact.language ??
    (artifact.format === 'code' ? 'text' : artifact.format === 'svg' ? 'xml' : artifact.format)
  return `${fence}${/^[\w+-]+$/.test(language) ? language : 'text'}\n${artifact.content}\n${fence}`
}
