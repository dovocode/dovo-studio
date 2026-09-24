import type { Attachment } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Activity } from '../storage/activity.js'
import { HttpError } from '../errors.js'
import { createHash } from 'node:crypto'
const fingerprint = (text: string, attachments: Attachment[]) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        text,
        attachments: attachments.map(({ id, name, mime, size }) => ({ id, name, mime, size })),
      }),
    )
    .digest('hex')
export class TaskQueue {
  constructor(
    private store: WorkspaceStore,
    private activity?: Pick<Activity, 'add'>,
  ) {}
  accepted(id: string, messageId: string, text: string, attachments: Attachment[] = []) {
    const task = this.store.task(id)
    const receipt = this.store.taskSubmission(id, messageId)
    if (receipt) {
      if (receipt !== fingerprint(text, attachments))
        throw new HttpError(409, 'This message id already has different text or attachments')
      return true
    }
    const existing = [...task.messages, ...(task.queue ?? [])].find((m) => m.id === messageId)
    if (existing) {
      if (fingerprint(existing.text, existing.attachments ?? []) !== fingerprint(text, attachments))
        throw new HttpError(409, 'This message id already has different text')
      return true
    }
    return false
  }
  add(
    id: string,
    messageId: string,
    text: string,
    attachments: Attachment[] = [],
    response?: { id: string; fingerprint: string },
  ) {
    if (this.accepted(id, messageId, text, attachments)) return false
    const task = this.store.task(id)
    if (task.archived) throw new HttpError(409, 'Restore this task before sending a message')
    if ((task.queue?.length ?? 0) >= 50)
      throw new HttpError(409, 'Queue is full (50 messages). Remove a message or let it run.')
    this.store.updateTask(
      id,
      (t) => ({
        ...t,
        checkoutLocked: true,
        draftAttachments: t.draftAttachments?.filter(
          (f) => !attachments.some((a) => a.id === f.id),
        ),
        queue: [
          ...(t.queue ?? []),
          {
            id: messageId,
            role: 'user',
            text,
            ...(attachments.length ? { attachments } : {}),
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      { id: messageId, fingerprint: fingerprint(text, attachments), response },
    )
    this.activity?.add(
      'message',
      id,
      'Follow-up queued',
      { id: messageId, text, attachments },
      `queued:${id}:${messageId}`,
    )
    return true
  }
  take(id: string) {
    this.store.updateTask(id, (t) => {
      const [message, ...queue] = t.queue ?? []
      return {
        ...t,
        status: 'running',
        runPhase: 'preparing',
        runAttempt: { inputMessageIds: message ? [message.id] : [], promptAccepted: false },
        ...(message ? { queue, messages: [...t.messages, message] } : {}),
      }
    })
  }
  change(id: string, action: 'remove' | 'up' | 'down' | 'pause', messageId?: string) {
    const task = this.store.task(id)
    if (action === 'pause') {
      this.store.updateTask(id, (t) => ({
        ...t,
        queuePaused: true,
        restartRecovery: t.restartRecovery ? { ...t.restartRecovery, automatic: false } : undefined,
      }))
      return
    }
    const queue = [...(task.queue ?? [])],
      index = queue.findIndex((m) => m.id === messageId)
    if (index < 0) throw new HttpError(409, 'This message already started or was removed')
    const removed = action === 'remove' ? queue[index] : undefined
    if (action === 'remove') queue.splice(index, 1)
    else {
      const target = index + (action === 'up' ? -1 : 1)
      if (target >= 0 && target < queue.length)
        [queue[index], queue[target]] = [queue[target], queue[index]]
    }
    this.store.updateTask(
      id,
      (t) => ({
        ...t,
        queue,
        checkoutLocked: true,
        restartRecovery:
          !queue.length && t.restartRecovery?.kind === 'queue' ? undefined : t.restartRecovery,
      }),
      removed && !this.store.taskSubmission(id, removed.id)
        ? {
            id: removed.id,
            fingerprint: fingerprint(removed.text, removed.attachments ?? []),
          }
        : undefined,
    )
    this.activity?.add('queue', id, `Queued message ${action}`, { messageId })
  }
}
