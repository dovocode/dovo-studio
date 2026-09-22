import { z } from 'zod'
import { forgeIssueSchema } from './forge-work.js'

export const workTargetSchema = z
  .object({
    repositoryId: z.string().min(1).max(200).optional(),
    jiraSourceId: z.string().min(1).max(200).optional(),
    url: forgeIssueSchema.shape.url.optional(),
    id: z.string().min(1).max(300).optional(),
    sha: z.string().min(1).max(200).optional(),
  })
  .refine((value) => !!value.repositoryId !== !!value.jiraSourceId, 'Choose one issue source')
export type WorkTarget = z.infer<typeof workTargetSchema>
export function encodeWorkTarget(target: WorkTarget): string {
  return JSON.stringify(workTargetSchema.parse(target))
}
export function decodeWorkTarget(value?: string): WorkTarget | undefined {
  if (!value) return undefined
  try {
    const parsed = workTargetSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
