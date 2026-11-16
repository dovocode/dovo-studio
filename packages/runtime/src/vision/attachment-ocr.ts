import { isImageAttachment } from '@dovo/protocol'
import { z } from 'zod'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { analyzeMirage } from './mirage.js'

const ocrResult = z.object({
  result: z.object({
    text: z.array(z.object({ string: z.string() })).optional(),
  }),
})

export async function attachmentOcr(
  s: Services,
  input: { taskId: string; id: string },
  signal: AbortSignal,
) {
  const file = s.attachments.read(input.taskId, input.id)
  if (!isImageAttachment(file.attachment)) throw new HttpError(400, 'Choose an image attachment')
  const result = await analyzeMirage(
    Buffer.from(file.data, 'base64'),
    { action: 'ocr', image: { attachmentId: input.id }, maxTextLines: 200, maxTokens: 4096 },
    signal,
  )
  return { text: (ocrResult.parse(result).result.text ?? []).map((line) => line.string).join('\n') }
}
