import { turnSettingsSchema, type Task } from '../../workspace.js'
import type { MutationOutbox } from '../../runtime/connection/mutations.js'
import { decodeResult, mutableStruct } from '../../shared/schema.js'
import { Schema } from 'effect'

export type PendingMessage = {
  taskId: string
  message: Task['messages'][number]
  state: 'sending' | 'saved' | 'failed'
  destination?: 'thread' | 'queue'
}

export function visiblePendingMessages(
  task: Pick<Task, 'id' | 'messages' | 'queue'> & Partial<Pick<Task, 'status'>>,
  pending: readonly PendingMessage[],
) {
  let lookups = 0
  if (pending.length + (task.status === 'running' ? (task.queue?.length ?? 0) : 0) >= 20) {
    for (const item of pending) {
      if (item.taskId === task.id) lookups++
      if (lookups >= 20) break
    }
    if (lookups < 20 && task.status === 'running')
      for (const message of task.queue ?? []) {
        if (message.steering) lookups++
        if (lookups >= 20) break
      }
  }
  if (lookups >= 20) {
    const candidates = new Set(
      pending.filter((item) => item.taskId === task.id).map((item) => item.message.id),
    )
    if (task.status === 'running')
      for (const message of task.queue ?? []) if (message.steering) candidates.add(message.id)
    const delivered = new Set<string>()
    for (const message of task.messages) if (candidates.has(message.id)) delivered.add(message.id)
    const queued = new Set((task.queue ?? []).map((message) => message.id))
    const byId = new Map<string, PendingMessage>()
    for (const item of pending)
      if (
        item.taskId === task.id &&
        !delivered.has(item.message.id) &&
        !queued.has(item.message.id)
      )
        byId.set(item.message.id, item)
    for (const message of task.queue ?? [])
      if (message.steering && task.status === 'running' && !delivered.has(message.id))
        byId.set(message.id, { taskId: task.id, message, state: 'sending', destination: 'thread' })
    return [...byId.values()]
  }
  const byId = new Map<string, PendingMessage>()
  for (const item of pending) if (visiblePendingMessage(task, item)) byId.set(item.message.id, item)
  for (const message of task.queue ?? []) {
    if (
      message.steering &&
      task.status === 'running' &&
      !task.messages.some((item) => item.id === message.id)
    )
      byId.set(message.id, { taskId: task.id, message, state: 'sending', destination: 'thread' })
  }
  return [...byId.values()]
}

export function mergePendingMessages(
  task: Task,
  saved: readonly PendingMessage[],
  local: readonly PendingMessage[],
) {
  const retained = local.flatMap((item) => {
    const journal = saved.find((saved) => saved.message.id === item.message.id)
    // Explicit discard removes saved previews; completed receipts remain until snapshot handoff.
    if (item.state === 'saved') return journal ? [{ ...item, state: journal.state }] : []
    return [journal?.state === 'failed' ? { ...item, state: 'failed' as const } : item]
  })
  return visiblePendingMessages(task, [...saved, ...retained])
}

const savedSendSchema = mutableStruct({
  id: Schema.String,
  messageId: Schema.String,
  turnSettings: Schema.optional(turnSettingsSchema),
  text: Schema.String,
  queueOnly: Schema.optional(Schema.Boolean),
  plan: Schema.optional(Schema.Boolean),
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
})

/** Restore presentation from the authoritative delivery journal, including after remount. */
export function savedPendingMessages(task: Task, journal: MutationOutbox): PendingMessage[] {
  const pending: PendingMessage[] = []
  for (const item of journal) {
    if (item.path !== '/api/tasks/message' && item.path !== '/api/tasks/steer') continue
    const input = decodeResult(savedSendSchema, item.input)
    if (!input.success || input.data.id !== task.id) continue
    pending.push({
      taskId: task.id,
      state: item.blocked ? 'failed' : 'saved',
      destination: pendingMessageDestination(
        task,
        item.path === '/api/tasks/steer' ? 'steer' : input.data.queueOnly ? 'stage' : 'queue',
      ),
      message: {
        id: input.data.messageId,
        role: 'user',
        text: input.data.text,
        turnSettings: input.data.turnSettings,
        ...(input.data.plan ? { plan: true } : {}),
        attachments: task.draftAttachments?.filter((file) =>
          input.data.attachmentIds?.includes(file.id),
        ),
      },
    })
  }
  return visiblePendingMessages(task, pending)
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
  mode: 'queue' | 'steer' | 'stage',
) {
  if (mode === 'stage') return 'queue'
  return mode === 'queue' && (task.status === 'running' || !!task.queue?.length)
    ? 'queue'
    : 'thread'
}
export function pendingMessageQueue(
  task: Pick<Task, 'id' | 'messages' | 'queue'> & Partial<Pick<Task, 'status'>>,
  pending: PendingMessage | readonly PendingMessage[] | null,
): NonNullable<Task['queue']> {
  // History events can arrive before the next queue snapshot during a steering handoff.
  const delivered = new Set(task.messages.map((message) => message.id))
  const queue = (task.queue ?? []).filter(
    (message) => !delivered.has(message.id) && !(message.steering && task.status === 'running'),
  )
  const visible = visiblePendingMessages(
    task,
    pending === null ? [] : Array.isArray(pending) ? pending : [pending],
  )
  return [
    ...queue,
    ...visible
      .filter((item) => item.destination === 'queue' && item.message.role === 'user')
      .map((item) => ({
        ...item.message,
        role: 'user' as const,
        createdAt: item.message.createdAt ?? '',
      })),
  ]
}

/** A paused message blocks the queue when it reaches the front. */
export function nextQueuedMessage(task: Pick<Task, 'queue'>) {
  const first = task.queue?.[0]
  return first?.paused ? undefined : first
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
  return nextQueuedMessage(task)
}
