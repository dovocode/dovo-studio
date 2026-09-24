import type { Task } from './workspace.js'

export type PendingMessage = {
  taskId: string
  message: Task['messages'][number]
  state: 'sending' | 'failed'
}

/** Presentation only: never persist an unacknowledged message into the workspace. */
export function visiblePendingMessage(
  task: Pick<Task, 'id' | 'messages' | 'queue'>,
  pending: PendingMessage | null,
) {
  return pending?.taskId === task.id &&
    !task.messages.some((message) => message.id === pending.message.id) &&
    !task.queue?.some((message) => message.id === pending.message.id)
    ? pending
    : null
}
