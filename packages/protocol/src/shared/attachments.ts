import { uuidSchema } from './schema.js'
import { mutableStruct, mutableArray } from './schema.js'
import { minValue, maxValue, refine } from './schema.js'
import { Schema } from 'effect'
import { notebookMarkdown } from '../scm/repositories/notebook-preview.js'
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS = 5
export const ATTACHMENT_PREVIEW_CHARS = 32000
export const attachmentSchema = mutableStruct({
  id: uuidSchema,
  name: maxValue(minValue(Schema.String, 1), 250),
  mime: Schema.String,
  size: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
})
export const attachmentResultSchema = mutableStruct({
  attachment: attachmentSchema,
})
export const attachmentUploadResultSchema = mutableStruct({
  ...attachmentResultSchema.fields,
  ...{
    revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    nextGuard: Schema.optional(Schema.String),
  },
})
export const attachmentCommitResultSchema = mutableStruct({
  ...attachmentUploadResultSchema.fields,
  nextGuard: Schema.String,
})
export const attachmentMutationSchema = mutableStruct({
  ok: Schema.Literal(true),
  revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})
export const attachmentReadSchema = mutableStruct({
  ...attachmentResultSchema.fields,
  data: Schema.String,
  documentPreview: Schema.optional(maxValue(Schema.String, ATTACHMENT_PREVIEW_CHARS + 20)),
})
export type AttachmentRead = Schema.Schema.Type<typeof attachmentReadSchema>
export const attachmentOcrRequestSchema = mutableStruct({
  taskId: minValue(Schema.String, 1),
  id: uuidSchema,
})
export const attachmentOcrResultSchema = mutableStruct({ text: Schema.String })
export const attachmentUploadSchema = mutableStruct({
  taskId: minValue(Schema.String, 1),
  queuedMessageId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  detached: Schema.optional(Schema.Boolean),
  /** Bind a direct composer upload to the draft that selected the file. */
  draftGuard: Schema.optional(maxValue(minValue(Schema.String, 64), 64)),
  id: uuidSchema,
  name: maxValue(minValue(Schema.String, 1), 250),
  data: maxValue(Schema.String, Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
})
export const attachmentReplaceSchema = mutableStruct({
  ...attachmentUploadSchema.fields,
  replaceId: uuidSchema,
})
export const attachmentIdsSchema = refine(
  maxValue(mutableArray(uuidSchema), MAX_ATTACHMENTS),
  (ids) => new Set(ids).size === ids.length,
  'Duplicate attachment',
)
export const attachmentPrepareSchema = mutableStruct({
  taskId: minValue(Schema.String, 1),
  ids: attachmentIdsSchema,
})
export const attachmentPreparedSchema = mutableStruct({ missing: attachmentIdsSchema })
export type Attachment = Schema.Schema.Type<typeof attachmentSchema>
export function isImageAttachment(file: Attachment) {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime)
}

export function attachmentDocumentKind(name: string) {
  if (/\.docx$/i.test(name)) return 'docx'
  if (/\.epub$/i.test(name)) return 'epub'
}

export function attachmentTextPreview(name: string, data: string) {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(data), (character) => character.charCodeAt(0)),
    )
    if (source.includes('\0')) return
    const markdown = /\.ipynb$/i.test(name) ? notebookMarkdown(source) : undefined
    const text = markdown ?? source
    return {
      markdown: markdown !== undefined,
      text:
        text.slice(0, ATTACHMENT_PREVIEW_CHARS) +
        (text.length > ATTACHMENT_PREVIEW_CHARS ? '\n… Preview truncated' : ''),
    }
  } catch {
    return
  }
}
