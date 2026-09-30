import {
  visiblePendingMessage,
  pendingMessageQueue,
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
  return pendingMessageQueue(task, pending)
}
export function sendingDraft(text: string, pending: MobilePendingSend | null) {
  return pending?.state === 'sending' && text.trim() === pending.message.text.trim() ? '' : text
}
