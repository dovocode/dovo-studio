import { Schema } from 'effect'
import { maxValue, minValue, strictStruct } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError } from '../errors.js'
export const conversationReadSchema = strictStruct({
  taskId: minValue(Schema.String, 1),
  parentRunId: Schema.optional(Schema.String),
  messageId: maxValue(minValue(Schema.String, 1), 300),
  offset: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: 10000000 })),
    ),
  ),
})
export function conversationRead(store: WorkspaceStore, input: typeof conversationReadSchema.Type) {
  const message = store.contextMessage(input.taskId, input.messageId)
  if (!message || message.role !== 'assistant')
    throw new HttpError(404, 'Assistant response not found in retained context.')
  const offset = input.offset ?? 0
  if (offset > message.text.length) throw new HttpError(400, 'Offset is outside this response.')
  const end = Math.min(message.text.length, offset + 8000)
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    text: message.text.slice(offset, end),
    nextOffset: end < message.text.length ? end : null,
  }
}
