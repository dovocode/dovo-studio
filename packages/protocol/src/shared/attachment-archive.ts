import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, uuidSchema } from './schema.js'

export const ATTACHMENT_ARCHIVE_MAX_ENTRIES = 512
export const ATTACHMENT_ARCHIVE_MAX_EXPANDED_BYTES = 20 * 1024 * 1024
export const attachmentArchiveRequestSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  id: uuidSchema,
})
export const attachmentArchiveReadRequestSchema = mutableStruct({
  ...attachmentArchiveRequestSchema.fields,
  path: maxValue(minValue(Schema.String, 1), 1024),
})
const archiveSize = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const attachmentArchiveEntrySchema = mutableStruct({
  path: maxValue(minValue(Schema.String, 1), 1024),
  size: archiveSize,
  directory: Schema.Boolean,
})
export const attachmentArchiveListSchema = mutableStruct({
  entries: maxValue(mutableArray(attachmentArchiveEntrySchema), ATTACHMENT_ARCHIVE_MAX_ENTRIES),
})
export const attachmentArchiveReadSchema = mutableStruct({
  path: maxValue(minValue(Schema.String, 1), 1024),
  name: maxValue(minValue(Schema.String, 1), 250),
  mime: Schema.String,
  size: archiveSize,
  data: Schema.String,
})
export type AttachmentArchiveEntry = Schema.Schema.Type<typeof attachmentArchiveEntrySchema>
export type AttachmentArchiveFile = Schema.Schema.Type<typeof attachmentArchiveReadSchema>

export function isZipAttachment(file: { name: string; mime: string }) {
  return (
    ['application/zip', 'application/x-zip-compressed'].includes(
      file.mime.split(';', 1)[0]!.trim().toLowerCase(),
    ) || file.name.toLowerCase().endsWith('.zip')
  )
}
