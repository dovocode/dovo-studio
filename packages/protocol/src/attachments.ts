import { z } from 'zod'
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS = 5
export const attachmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(250),
  mime: z.string(),
  size: z.number().int().nonnegative(),
})
export const attachmentResultSchema = z.object({ attachment: attachmentSchema })
export const attachmentUploadResultSchema = attachmentResultSchema.extend({ revision: z.number() })
export const attachmentMutationSchema = z.object({ ok: z.literal(true), revision: z.number() })
export const attachmentReadSchema = attachmentResultSchema.extend({ data: z.string() })
export const attachmentUploadSchema = z.object({
  taskId: z.string().min(1),
  id: z.uuid(),
  name: z.string().min(1).max(250),
  data: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
})
export const attachmentIdsSchema = z
  .array(z.uuid())
  .max(MAX_ATTACHMENTS)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate attachment')
export type Attachment = z.infer<typeof attachmentSchema>
export function isImageAttachment(file: Attachment) {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime)
}
