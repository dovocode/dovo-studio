import {
  visiblePendingMessage,
  pendingMessageQueue,
  startingConversationMessage,
  type Task,
  type PendingMessage,
} from '@dovo/protocol'
export type MobilePendingSend = Omit<PendingMessage, 'message'> & {
  message: NonNullable<Task['queue']>[number]
  destination: 'thread' | 'queue'
}
export { pendingMessageDestination as sendDestination } from '@dovo/protocol'
export function visibleMobileSend(task: Task, pending: MobilePendingSend | null) {
  return visiblePendingMessage(task, pending) ? pending : null
}
export function pendingQueue(task: Task, pending: MobilePendingSend | null) {
  const starting = startingConversationMessage(task)
  return pendingMessageQueue(task, pending).filter((message) => message.id !== starting?.id)
}
export function sendingDraft(text: string, pending: MobilePendingSend | null) {
  return pending?.state === 'sending' && text.trim() === pending.message.text.trim() ? '' : text
}
