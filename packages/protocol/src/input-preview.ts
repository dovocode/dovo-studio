import { Schema } from 'effect'
import { mutableArray, mutableStruct } from './shared/schema.js'
import { connectionSchema, approvalSchema } from './runtime/connection/runtime.js'
import { pendingQuestionSchema, questionAnswersSchema } from './conversation/workflow/questions.js'

export const inputPreviewItemSchema = mutableStruct({
  runtimeId: Schema.String,
  runtimeName: Schema.String,
  taskTitle: Schema.String,
  connection: connectionSchema,
  connected: Schema.Boolean,
  request: Schema.Union(
    mutableStruct({ kind: Schema.Literal('question'), value: pendingQuestionSchema }),
    mutableStruct({ kind: Schema.Literal('approval'), value: approvalSchema }),
  ),
})
export const inputPreviewSyncSchema = mutableStruct({
  enabled: Schema.Boolean,
  items: mutableArray(inputPreviewItemSchema),
})
export const inputPreviewAnswerSchema = mutableStruct({
  key: Schema.String,
  answer: Schema.Union(questionAnswersSchema, Schema.Null, Schema.Boolean),
})
export type InputPreviewItem = Schema.Schema.Type<typeof inputPreviewItemSchema>
/** Credentials stay in the host process and are never sent to the preview renderer. */
export type InputPreview = Omit<InputPreviewItem, 'connection'> & { key: string; waiting: number }
export type InputPreviewAnswer = Schema.Schema.Type<typeof inputPreviewAnswerSchema>
export type InputPreviewBridge = {
  sync: (state: Schema.Schema.Type<typeof inputPreviewSyncSchema>) => Promise<void>
  current: () => Promise<InputPreview | null>
  subscribe: (listener: (state: InputPreview | null) => void) => () => void
  answer: (value: InputPreviewAnswer) => Promise<void>
  dismiss: () => Promise<void>
  openThread: () => Promise<void>
  onOpenThread: (listener: (target: { runtimeId: string; entityId: string }) => void) => () => void
}
export function inputPreviewKey(item: InputPreviewItem) {
  return JSON.stringify([item.runtimeId, item.request.kind, item.request.value.id])
}
