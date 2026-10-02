import type { Attachment } from '@dovo/protocol'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { Activity } from '../../storage/activity.js'
import { HttpError } from '../../errors.js'
import { createHash, randomUUID } from 'node:crypto'
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
    review = false,
    resumePaused = false,
  ) {
    if (this.accepted(id, messageId, text, attachments)) return false
    const task = this.store.task(id)
    if (task.archived) throw new HttpError(409, 'Restore this task before sending a message')
    if ((task.queue?.length ?? 0) >= 50)
      throw new HttpError(409, 'Queue is full (50 messages). Remove a message or let it run.')
    const createdAt = new Date().toISOString()
    this.store.updateTask(
      id,
      (t) => ({
        ...t,
        checkoutLocked: true,
        ...(!response && !review && text.trim() !== '/compact' ? { lastPromptAt: createdAt } : {}),
        draft: t.draft.trim() === text.trim() ? '' : t.draft,
        ...(resumePaused ? { queuePaused: false, restartRecovery: undefined } : {}),
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
            ...(review ? { review: true } : {}),
            createdAt,
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
  edit(id: string, messageId: string, text: string, expectedText: string) {
    const task = this.store.task(id)
    const message = task.queue?.find((item) => item.id === messageId)
    if (!message) throw new HttpError(409, 'This message already started or was removed')
    if (message.text !== expectedText)
      throw new HttpError(409, 'This queued message changed. Reopen it before editing.')
    if (!text.trim() && !message.attachments?.length)
      throw new HttpError(400, 'A message needs text or attachments')
    this.store.updateTask(id, (current) => ({
      ...current,
      queue: current.queue?.map((item) => (item.id === messageId ? { ...item, text } : item)),
    }))
    this.activity?.add('queue', id, 'Queued message edited', { messageId })
  }
  take(id: string, runId: string = randomUUID(), attemptId?: string) {
    this.store.updateTask(
      id,
      (t) => {
        const [message, ...queue] = t.queue ?? []
        return {
          ...t,
          status: 'running',
          runPhase: 'preparing',
          ...(attemptId ? { activeRunId: attemptId } : {}),
          runAttempt: {
            runId,
            inputMessageIds: message ? [message.id] : [],
            promptAccepted: false,
          },
          ...(message ? { queue, messages: [...t.messages, message] } : {}),
        }
      },
      undefined,
      attemptId
        ? { id: `start:${attemptId}`, taskId: id, attemptId, kind: 'start', state: 'pending' }
        : undefined,
    )
  }
  change(id: string, action: 'remove' | 'restore' | 'up' | 'down' | 'pause', messageId?: string) {
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
    const removed = action === 'remove' || action === 'restore' ? queue[index] : undefined
    if (removed) queue.splice(index, 1)
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
        ...(action === 'restore' && removed
          ? {
              draft: [t.draft, removed.text].filter(Boolean).join('\n\n'),
              draftAttachments: [
                ...(t.draftAttachments ?? []),
                ...(removed.attachments ?? []).filter(
                  (file) => !t.draftAttachments?.some((draft) => draft.id === file.id),
                ),
              ],
            }
          : {}),
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
