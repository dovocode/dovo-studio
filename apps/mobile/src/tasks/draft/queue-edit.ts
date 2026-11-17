import {
  attachmentSchema,
  mutableArray,
  mutableStruct,
  sameTurnSettings,
  turnSettingsSchema,
  type ChatMessage,
} from '@dovo/protocol'
import { Schema } from 'effect'

const valuesSchema = mutableStruct({
  text: Schema.String,
  files: mutableArray(attachmentSchema),
  settings: Schema.NullOr(turnSettingsSchema),
  plan: Schema.Boolean,
})
const attemptSchema = mutableStruct({
  id: Schema.String,
  version: Schema.Number,
  intended: valuesSchema,
})
export const queueEditSchema = mutableStruct({
  session: Schema.String,
  messageId: Schema.String,
  version: Schema.Number,
  revision: Schema.Number,
  original: valuesSchema,
  draft: valuesSchema,
  attempt: Schema.optional(attemptSchema),
})
export type QueueEdit = Schema.Schema.Type<typeof queueEditSchema>
type Values = QueueEdit['draft']
type Attempt = NonNullable<QueueEdit['attempt']>

function valuesOf(message: ChatMessage): Values {
  return {
    text: message.text,
    files: message.attachments ?? [],
    settings: message.turnSettings ?? null,
    plan: message.plan === true,
  }
}
const fileIds = (values: Values) => values.files.map((file) => file.id)
const sameFiles = (left: Values, right: Values) =>
  JSON.stringify(fileIds(left)) === JSON.stringify(fileIds(right))
const sameValues = (left: Values, right: Values) =>
  left.text === right.text &&
  sameTurnSettings(left.settings, right.settings) &&
  left.plan === right.plan &&
  sameFiles(left, right)

export function startQueueEdit(message: ChatMessage, session: string): QueueEdit {
  const original = valuesOf(message)
  return { session, messageId: message.id, version: 0, revision: 0, original, draft: original }
}

export function prepareQueueEdit(
  edit: QueueEdit,
  threadId: string,
  text: string,
  id: string,
  support: { attachments: boolean; settings: boolean; plan: boolean },
) {
  const { original, draft } = edit
  if (
    (!support.attachments && !sameFiles(draft, original)) ||
    (!support.settings && !sameTurnSettings(draft.settings, original.settings)) ||
    (!support.plan && draft.plan !== original.plan)
  )
    throw new Error('Update the task computer before saving these queued message changes.')
  const intended = { ...draft, text }
  const attempt: Attempt = { id, version: edit.version, intended }
  return {
    attempt,
    input: {
      id: threadId,
      action: 'edit' as const,
      messageId: edit.messageId,
      text,
      expectedText: original.text,
      ...(support.attachments
        ? { attachmentIds: fileIds(intended), expectedAttachmentIds: fileIds(original) }
        : {}),
      ...(support.settings
        ? { turnSettings: intended.settings, expectedTurnSettings: original.settings }
        : {}),
      ...(support.plan ? { plan: intended.plan, expectedPlan: original.plan } : {}),
    },
  }
}

export function observeQueueEdit(edit: QueueEdit, attempt: Attempt, message?: ChatMessage) {
  if (!message || message.id !== edit.messageId) return 'removed'
  const observed = valuesOf(message)
  if (sameValues(observed, edit.original)) return 'original'
  return sameValues(observed, attempt.intended) ? 'saved' : 'conflict'
}

export function settleQueueEdit(
  current: QueueEdit | undefined,
  session: string,
  attempt: Attempt,
  saved: boolean,
) {
  if (current?.session !== session || current.attempt?.id !== attempt.id) return current
  if (saved && current.version === attempt.version) return undefined
  return {
    ...current,
    original: saved ? attempt.intended : current.original,
    attempt: undefined,
  }
}
