import { mutableStruct } from './schema.js'
import { minValue, maxValue, refine, decode, decodeResult } from './schema.js'
import { Schema } from 'effect'
import { forgeIssueSchema } from './forge-work.js'
export const workTargetSchema = refine(
  mutableStruct({
    repositoryId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
    jiraSourceId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
    url: Schema.optional(forgeIssueSchema.fields.url),
    id: Schema.optional(maxValue(minValue(Schema.String, 1), 300)),
    sha: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  }),
  (value) => !!value.repositoryId !== !!value.jiraSourceId,
  'Choose one issue source',
)
export type WorkTarget = Schema.Schema.Type<typeof workTargetSchema>
export function encodeWorkTarget(target: WorkTarget): string {
  return JSON.stringify(decode(workTargetSchema, target))
}
export function decodeWorkTarget(value?: string): WorkTarget | undefined {
  if (!value) return undefined
  try {
    const parsed = decodeResult(workTargetSchema, JSON.parse(value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
