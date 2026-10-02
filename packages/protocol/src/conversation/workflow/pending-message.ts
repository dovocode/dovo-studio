import type { Task } from '../../workspace.js'

export type PendingMessage = {
  taskId: string
  message: Task['messages'][number]
  state: 'sending' | 'failed'
  destination?: 'thread' | 'queue'
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

export function pendingMessageDestination(
  task: Pick<Task, 'status' | 'queue'>,
  mode: 'queue' | 'steer',
) {
  return mode === 'queue' && (task.status === 'running' || !!task.queue?.length)
    ? 'queue'
    : 'thread'
}
export function pendingMessageQueue(
  task: Pick<Task, 'id' | 'messages' | 'queue'>,
  pending: PendingMessage | null,
): NonNullable<Task['queue']> {
  const visible = visiblePendingMessage(task, pending)
  if (visible?.destination !== 'queue' || visible.message.role !== 'user') return task.queue ?? []
  return [
    ...(task.queue ?? []),
    { ...visible.message, role: 'user', createdAt: visible.message.createdAt ?? '' },
  ]
}

/** The first accepted input is the conversation starter while its checkout is prepared. */
export function startingConversationMessage(
  task: Pick<Task, 'messages' | 'turns' | 'queue' | 'queuePaused' | 'status' | 'runPhase'>,
) {
  if (
    task.messages.length ||
    task.turns?.length ||
    task.queuePaused ||
    (task.status !== 'draft' && !(task.status === 'running' && task.runPhase === 'preparing'))
  )
    return undefined
  return task.queue?.[0]
}
