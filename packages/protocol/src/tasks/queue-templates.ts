import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableArray,
  refine,
  strictStruct,
  uuidSchema,
} from '../shared/schema.js'
import { workspaceDraftHash } from '../runtime/connection/workspace-reconciliation.js'
import type { queuedMessageSchema } from '../workspace.js'

const taskId = maxValue(minValue(Schema.String, 1), 200)
const name = maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 80)
const maxTemplateText = 120_000
const steps = refine(
  maxValue(minValue(mutableArray(refine(Schema.String, (value) => !!value.trim())), 1), 50),
  (values) => values.reduce((length, value) => length + value.length, 0) <= maxTemplateText,
)
export const queueTemplateSchema = strictStruct({ id: uuidSchema, name, steps })
export type QueueTemplate = typeof queueTemplateSchema.Type
export const queueTemplateListRequestSchema = strictStruct({ repositoryId: taskId })
export const queueTemplateListSchema = strictStruct({
  templates: mutableArray(queueTemplateSchema),
})
export const queueTemplateCommandSchema = Schema.Union([
  strictStruct({
    action: Schema.Literal('save'),
    taskId,
    id: uuidSchema,
    name,
    queueFingerprint: maxValue(Schema.String, 128),
  }),
  strictStruct({ action: Schema.Literal('delete'), taskId, id: uuidSchema }),
  strictStruct({ action: Schema.Literal('stage'), taskId, id: uuidSchema, requestId: uuidSchema }),
])

export function queueTemplateSource(queue: readonly (typeof queuedMessageSchema.Type)[]) {
  if (
    !queue.length ||
    queue.some(
      (message) =>
        !message.text.trim() ||
        message.attachments?.length ||
        message.steering ||
        message.review ||
        message.plan ||
        message.turnSettings ||
        message.subagentResultId ||
        (message.source && message.source.kind !== 'user'),
    )
  )
    return undefined
  const steps = queue.map((message) => message.text)
  if (steps.reduce((length, value) => length + value.length, 0) > maxTemplateText) return undefined
  return {
    steps,
    fingerprint: workspaceDraftHash(JSON.stringify(queue.map(({ id, text }) => [id, text]))),
  }
}
