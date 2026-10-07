import { uuidSchema } from './schema.js'
import { mutableStruct, mutableArray } from './schema.js'
import { minValue, maxValue, refine } from './schema.js'
import { Schema } from 'effect'
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS = 5
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
  },
})
export const attachmentMutationSchema = mutableStruct({
  ok: Schema.Literal(true),
  revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})
export const attachmentReadSchema = mutableStruct({
  ...attachmentResultSchema.fields,
  ...{
    data: Schema.String,
  },
})
export const attachmentUploadSchema = mutableStruct({
  taskId: minValue(Schema.String, 1),
  id: uuidSchema,
  name: maxValue(minValue(Schema.String, 1), 250),
  data: maxValue(Schema.String, Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
})
export const attachmentIdsSchema = refine(
  maxValue(mutableArray(uuidSchema), MAX_ATTACHMENTS),
  (ids) => new Set(ids).size === ids.length,
  'Duplicate attachment',
)
export type Attachment = Schema.Schema.Type<typeof attachmentSchema>
export function isImageAttachment(file: Attachment) {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime)
}
