import { z } from 'zod'
import { agentSchema } from './workspace.js'
export const titleGenerationSettingsSchema = z.object({
  harness: agentSchema.pick({ provider: true, endpoint: true, args: true }).optional(),
  agentId: z.string().max(200).default(''),
  model: z.string().max(300).default(''),
  reasoning: z.string().max(100).default(''),
})
export const generateTitleSchema = z.object({ text: z.string().trim().min(1).max(120000) })
export const generatedTitleSchema = z.object({ title: z.string().trim().min(1).max(120) })
export const cleanupDictationSchema = z.strictObject({
  text: z.string().trim().min(1).max(12000),
})
export const cleanedDictationSchema = z.strictObject({
  text: z.string().trim().min(1).max(16000),
})
export type TitleGenerationSettings = z.infer<typeof titleGenerationSettingsSchema>
