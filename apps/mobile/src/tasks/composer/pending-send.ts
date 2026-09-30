import { visiblePendingMessage, type Task, type PendingMessage } from '@dovo/protocol'
export type MobilePendingSend = Omit<PendingMessage, 'message'> & {
  message: NonNullable<Task['queue']>[number]
  destination: 'thread' | 'queue'
}
export function sendDestination(task: Task, mode: 'queue' | 'steer') {
  return mode === 'queue' && (task.status === 'running' || !!task.queue?.length)
    ? 'queue'
    : 'thread'
}
export function visibleMobileSend(task: Task, pending: MobilePendingSend | null) {
  return visiblePendingMessage(task, pending) ? pending : null
}
export function pendingQueue(task: Task, pending: MobilePendingSend | null) {
  const visible = visibleMobileSend(task, pending)
  return visible?.destination === 'queue'
    ? [...(task.queue ?? []), visible.message]
    : (task.queue ?? [])
}
export function sendingDraft(text: string, pending: MobilePendingSend | null) {
  return pending?.state === 'sending' && text.trim() === pending.message.text.trim() ? '' : text
}
