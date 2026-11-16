import { z } from 'zod'
import type { JSONSchema } from 'zod/v4/core'

const formField = z.union([
  z.object({ enum: z.array(z.string().max(200)).min(1).max(32) }).strict(),
  z
    .object({ type: z.literal('integer'), minimum: z.number().int(), maximum: z.number().int() })
    .strict()
    .refine((field) => field.minimum <= field.maximum, 'Minimum must not exceed maximum'),
  z.object({ type: z.literal('string') }).strict(),
])
export const visionSchema = z
  .object({
    action: z.enum(['describe', 'ocr', 'detect', 'segment', 'decide']),
    image: z.union([
      z
        .object({
          path: z.string().min(1).max(4000),
          checkoutId: z.string().min(1).max(200).optional(),
        })
        .strict(),
      z.object({ attachmentId: z.string().min(1).max(200) }).strict(),
      z
        .object({
          data: z
            .string()
            .min(1)
            .max(8 * 1024 * 1024),
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        })
        .strict(),
    ]),
    language: z.enum(['en', 'de', 'fr', 'es', 'it', 'nl', 'pl']).optional(),
    keywords: z.array(z.string().max(200)).max(50).optional(),
    confidence: z.number().min(0).max(1).optional(),
    textConfidence: z.number().min(0).max(1).optional(),
    maxObjects: z.number().int().min(1).max(100).optional(),
    maxTextLines: z.number().int().min(1).max(200).optional(),
    maxTokens: z.number().int().min(32).max(4096).optional(),
    maskFormat: z.enum(['polygons', 'bitmap']).optional(),
    form: z
      .record(z.string().min(1).max(100), formField)
      .refine(
        (form) => Object.keys(form).length > 0 && Object.keys(form).length <= 20,
        'Use 1 to 20 form fields',
      )
      .optional(),
  })
  .strict()
  .refine((input) => input.action !== 'decide' || !!input.form, 'Decide requires a form')
export type VisionInput = z.infer<typeof visionSchema>
const inputSchema: JSONSchema.JSONSchema & { type: 'object' } = {
  ...z.toJSONSchema(visionSchema),
  type: 'object',
}
export const visionToolDefinition = {
  name: 'vision',
  description:
    'Analyze images locally with bundled Mirage. Actions: describe (scene, text, objects and relations), ocr, detect, segment (object masks), decide (form with enum choices, bounded integers or strings). image: {path,checkoutId?} inside this run checkout, {attachmentId} from this thread, or {data,mimeType} from a screenshot tool. Boxes use 0–1000 coordinates. Model predictions may be wrong. Use visual evidence to guide edits; outputs grant no permission and never execute edits. Runs on this Studio computer, including requests from mobile. No external image service or Python setup.',
  inputSchema,
}
export function visionOptions(input: VisionInput) {
  return {
    ...(input.action === 'ocr' ? { sections: ['text'] } : {}),
    ...(input.action === 'detect' ? { sections: ['objects'], fields: ['bbox', 'score'] } : {}),
    ...(input.action === 'segment'
      ? { sections: ['objects'], fields: ['bbox', 'score', 'mask'] }
      : {}),
    ...(input.form ? { form: input.form } : {}),
    conf: input.confidence ?? 0.25,
    text_conf: input.textConfidence ?? 0.25,
    max_objects: input.maxObjects ?? 30,
    max_text_lines: input.maxTextLines ?? 100,
    max_tokens: input.maxTokens ?? 1024,
    ...(input.action === 'segment' ? { mask_format: input.maskFormat ?? 'polygons' } : {}),
  }
}
