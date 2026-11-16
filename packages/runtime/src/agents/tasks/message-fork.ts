import {
  conversationTurns,
  messageForkBlocker,
  threadForkBlocker,
  type forkMessageSchema,
  type Task,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'

/** Starts an independent thread from settled history. The source thread, its checkout and its
 * provider session stay unchanged. The fork has no provider session, so its first turn receives
 * the copied conversation through the same bounded transcript replay as a harness handoff. */
export function forkFromMessage(s: Services, input: typeof forkMessageSchema.Type) {
  return s.store.transaction(() => {
    const existing = s.store.get().tasks.find((task) => task.id === input.forkId)
    if (existing) {
      if (
        existing.forkedFrom?.taskId !== input.id ||
        existing.forkedFrom.messageId !== input.messageId
      )
        throw new HttpError(409, 'This fork ID belongs to another request.')
      return { id: existing.id }
    }
    if (s.store.wasTaskDeleted(input.forkId))
      throw new HttpError(409, 'This fork was deleted. Fork the message again.')
    const source = s.store.task(input.id)
    const blocker = threadForkBlocker(source)
    if (blocker) throw new HttpError(409, blocker)
    const index = source.messages.findIndex((message) => message.id === input.messageId)
    if (index < 0) throw new HttpError(404, 'This message is no longer in the thread.')
    const status =
      conversationTurns(source).find((group) =>
        group.messages.some((message) => message.id === input.messageId),
      )?.status ?? 'completed'
    const messageBlocker = messageForkBlocker(
      source.messages[index]!,
      status,
      source.status === 'running' || !!source.activeRunId,
    )
    if (messageBlocker) throw new HttpError(409, messageBlocker)
    // Review comments belong to the source diff, as in the other fork kinds.
    const history = source.messages
      .slice(0, index + 1)
      .filter((message) => message.role === 'assistant' || !message.file)
    const lastAssistant = history.map((message) => message.role).lastIndexOf('assistant')
    const messages = s.attachments.copyHistory(input.forkId, history).map((message, position) => {
      // Trailing requests have no reply in the fork. Its first turn takes ownership of them.
      if (position <= lastAssistant) return message
      const { turnId: _turnId, ...pending } = message
      return pending
    })
    // New threads take their checkout from the project defaults; the agent comes from the source.
    const defaults = s.store.taskDefaults(source.repositoryId)
    const fork: Task = {
      ...defaults,
      id: input.forkId,
      title: `Fork: ${source.title}`.slice(0, 200),
      repositoryId: source.repositoryId,
      agentId: source.agentId,
      agentName: source.agentName,
      agentIcon: source.agentIcon,
      harness: source.harness ?? (source.agentId ? undefined : defaults.harness),
      agentOverrides: source.agentOverrides,
      harnessCustomized: source.harnessCustomized,
      modelSelection:
        source.modelSelection ??
        (source.harness || source.agentId ? undefined : defaults.modelSelection),
      modelSelectionDifficulty: source.modelSelectionDifficulty,
      execution: defaults.execution,
      forkedFrom: { taskId: source.id, messageId: input.messageId, title: source.title },
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages,
      files: [],
      draft: '',
      example: false,
    }
    s.tasks.requireCheckoutReferencesAvailable(fork)
    s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, fork] }))
    s.activity.add('task', fork.id, 'Forked from another thread', {
      taskId: source.id,
      messageId: input.messageId,
    })
    return { id: fork.id }
  })
}
