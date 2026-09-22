import type { Attachment } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Activity } from '../storage/activity.js'
import { HttpError } from '../errors.js'
export class TaskQueue {
  constructor(
    private store: WorkspaceStore,
    private activity?: Pick<Activity, 'add'>,
  ) {}
  add(id: string, messageId: string, text: string, attachments: Attachment[] = []) {
    const task = this.store.task(id)
    if (task.archived) throw new HttpError(409, 'Restore this task before sending a message')
    const existing = [...task.messages, ...(task.queue ?? [])].find((m) => m.id === messageId)
    if (existing) {
      if (
        existing.text !== text ||
        JSON.stringify(existing.attachments ?? []) !== JSON.stringify(attachments)
      )
        throw new HttpError(409, 'This message id already has different text')
      return false
    }
    if ((task.queue?.length ?? 0) >= 50)
      throw new HttpError(409, 'Queue is full (50 messages). Remove a message or let it run.')
    this.store.updateTask(id, (t) => ({
      ...t,
      checkoutLocked: true,
      draftAttachments: t.draftAttachments?.filter((f) => !attachments.some((a) => a.id === f.id)),
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
    }))
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
      return message ? { ...t, queue, messages: [...t.messages, message] } : t
    })
  }
  change(id: string, action: 'remove' | 'up' | 'down' | 'pause', messageId?: string) {
    const task = this.store.task(id)
    if (action === 'pause') {
      this.store.updateTask(id, (t) => ({ ...t, queuePaused: true }))
      return
    }
    const queue = [...(task.queue ?? [])],
      index = queue.findIndex((m) => m.id === messageId)
    if (index < 0) throw new HttpError(409, 'This message already started or was removed')
    if (action === 'remove') queue.splice(index, 1)
    else {
      const target = index + (action === 'up' ? -1 : 1)
      if (target >= 0 && target < queue.length)
        [queue[index], queue[target]] = [queue[target], queue[index]]
    }
    this.store.updateTask(id, (t) => ({ ...t, queue, checkoutLocked: true }))
    this.activity?.add('queue', id, `Queued message ${action}`, { messageId })
  }
}
