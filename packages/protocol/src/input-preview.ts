import { Schema } from 'effect'
import { mutableArray, mutableStruct } from './shared/schema.js'
import {
  connectionSchema,
  approvalSchema,
  approvalDecisionSchema,
  approvalActions,
  type Approval,
  type ApprovalDecision,
} from './runtime/connection/runtime.js'
import { pendingQuestionSchema, questionAnswersSchema } from './conversation/workflow/questions.js'
import type { SideThreadRequest } from './tasks/side-thread-attention.js'

export const inputPreviewItemSchema = mutableStruct({
  runtimeId: Schema.String,
  runtimeName: Schema.String,
  taskTitle: Schema.String,
  parentTaskId: Schema.optional(Schema.String),
  connection: connectionSchema,
  connected: Schema.Boolean,
  request: Schema.Union([
    mutableStruct({ kind: Schema.Literal('question'), value: pendingQuestionSchema }),
    mutableStruct({ kind: Schema.Literal('approval'), value: approvalSchema }),
  ]),
})
export const inputPreviewSyncSchema = mutableStruct({
  enabled: Schema.Boolean,
  /** Foreground Browser mode has no inline form; independent of background popup preferences. */
  showWhileFocused: Schema.optional(Schema.Boolean),
  items: mutableArray(inputPreviewItemSchema),
})
export const inputPreviewAnswerSchema = mutableStruct({
  key: Schema.String,
  answer: Schema.Union([questionAnswersSchema, Schema.Null, Schema.Boolean]),
  /** The exact approval action the user chose from `approvalActions`. */
  decision: Schema.optional(approvalDecisionSchema),
})
export type InputPreviewItem = Schema.Schema.Type<typeof inputPreviewItemSchema>
/** Credentials stay in the host process and are never sent to the preview renderer. */
export type InputPreview = Omit<InputPreviewItem, 'connection'> & { key: string; waiting: number }
export type InputPreviewAnswer = Schema.Schema.Type<typeof inputPreviewAnswerSchema>
export type InputPreviewThreadTarget = {
  runtimeId: string
  entityId: string
  threadRequest: SideThreadRequest
}
export type InputPreviewBridge = {
  sync: (state: Schema.Schema.Type<typeof inputPreviewSyncSchema>) => Promise<void>
  current: () => Promise<InputPreview | null>
  subscribe: (listener: (state: InputPreview | null) => void) => () => void
  answer: (value: InputPreviewAnswer) => Promise<void>
  dismiss: (key: string) => Promise<void>
  openThread: (key: string) => Promise<void>
  onOpenThread: (listener: (target: InputPreviewThreadTarget) => void) => () => void
}
export function inputPreviewKey(item: InputPreviewItem) {
  return JSON.stringify([item.runtimeId, item.request.kind, item.request.value.id])
}

/** The approval decision behind a preview answer. Only an action the request offers is valid, so
 * a key press or stale window cannot choose a scope the provider did not offer. */
export function inputPreviewApprovalDecision(
  approval: Pick<Approval, 'title' | 'rememberRule' | 'scopes'>,
  answer: Pick<InputPreviewAnswer, 'answer' | 'decision'>,
): ApprovalDecision {
  const decision =
    answer.decision ??
    (answer.answer === true ? 'approve' : answer.answer === false ? 'deny' : undefined)
  if (!decision || answer.answer !== (decision !== 'deny'))
    throw new Error('Invalid response for this request')
  if (!approvalActions(approval).some((action) => action.decision === decision))
    throw new Error('This permission choice is not available for this request')
  return decision
}
