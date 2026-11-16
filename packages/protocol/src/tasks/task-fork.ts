import { Schema } from 'effect'
import { attachmentIdsSchema } from '../shared/attachments.js'
import { maxValue, minValue, mutableStruct, uuidSchema } from '../shared/schema.js'
import { mutableArray } from '../shared/schema.js'
import { fileSchema, type ChatMessage } from '../workspace.js'
import type { ConversationTurn } from '../conversation/timeline.js'
import type { TaskMetadata } from './task-summary.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const startForkSchema = mutableStruct({
  id,
  forkId: uuidSchema,
  text: maxValue(Schema.String, 120000),
  attachmentIds: attachmentIdsSchema,
})
export const taskForkResultSchema = mutableStruct({ id })
/** `forkId` is chosen by the client, so a retried request returns the same fork. */
export const forkMessageSchema = mutableStruct({ id, messageId: id, forkId: uuidSchema })

type ForkSource = Pick<
  TaskMetadata,
  | 'bot'
  | 'replica'
  | 'delegation'
  | 'sideThread'
  | 'importedCodexSession'
  | 'importedPiSession'
  | 'machineHandoff'
>

/** The thread kinds that handoffs keep with their original execution cannot be forked either. */
export function threadForkBlocker(task: ForkSource): string | undefined {
  if (task.replica)
    return `This thread runs on ${task.replica.ownerName || 'another computer'}. Open it there to fork it.`
  if (task.bot) return 'Bots keep one conversation. Reset its context instead of forking.'
  if (task.machineHandoff)
    return 'This thread is part of a computer transfer. Finish the transfer, then fork the thread on the computer where it continues.'
  if (task.delegation)
    return 'Delegated child threads stay with their parent thread. Fork the parent thread instead.'
  if (task.sideThread)
    return 'Side threads stay with their parent thread. Fork the parent thread instead.'
  if (task.importedCodexSession || task.importedPiSession)
    return 'Imported sessions stay with their original native session. Start a new thread to continue in another direction.'
  return undefined
}

/** Only settled history can start a fork. `status` is the message's conversation-turn status. */
export function messageForkBlocker(
  message: Pick<ChatMessage, 'role' | 'file'>,
  status: ConversationTurn['status'],
  running: boolean,
): string | undefined {
  if (message.role === 'user' && message.file)
    return 'A review comment cannot start a fork. Fork from a message in the conversation.'
  if (status === 'running' || (status === 'waiting' && running))
    return 'Wait for this turn to finish before forking from this message.'
  return undefined
}
export const createSideThreadSchema = mutableStruct({
  id,
  childId: uuidSchema,
  objective: Schema.optional(maxValue(Schema.String, 120000)),
})
export const bringBackSideThreadSchema = mutableStruct({
  id,
  expectedDraft: Schema.optional(Schema.String),
})
export const bringBackSideThreadResultSchema = mutableStruct({
  id,
  receiptId: Schema.String,
  text: Schema.String,
})
export const sideThreadChangesSchema = mutableStruct({ id })
export const sideThreadChangesInputSchema = sideThreadChangesSchema
export const discardSideThreadSchema = mutableStruct({ id })
export const sideThreadChangesResultSchema = mutableStruct({
  before: Schema.String,
  after: Schema.String,
  files: mutableArray(fileSchema),
  omitted: mutableArray(Schema.String),
})
export type SideThreadChanges = Schema.Schema.Type<typeof sideThreadChangesResultSchema>
export const sideThreadFileSchema = mutableStruct({
  id,
  before: Schema.String,
  after: Schema.String,
  path: maxValue(minValue(Schema.String, 1), 4000),
  full: Schema.optional(Schema.Boolean),
})
export const sideThreadFilePreviewSchema = sideThreadFileSchema
