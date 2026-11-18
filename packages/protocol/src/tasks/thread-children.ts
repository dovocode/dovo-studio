import type { TaskMetadata } from './task-summary.js'
import { botInvocationParent, mentionSourceTitle } from './thread-parent.js'

type ChildMetadata = Pick<
  TaskMetadata,
  | 'id'
  | 'createdAt'
  | 'archivedAt'
  | 'sideThread'
  | 'bot'
  | 'botJob'
  | 'botMention'
  | 'botConversation'
  | 'forkedFrom'
  | 'replica'
> &
  Partial<Pick<TaskMetadata, 'title'>>

/** Presentation only. A Bot association never transfers execution or grants access. */
export function threadChildren<T extends ChildMetadata>(
  sources: readonly { runtimeId: string | null; runtimeIdentity?: string; tasks: readonly T[] }[],
  parent: { id: string; runtimeId: string | null; runtimeIdentity?: string },
) {
  const isLocal = (source: (typeof sources)[number]) =>
    source.runtimeIdentity && parent.runtimeIdentity
      ? source.runtimeIdentity === parent.runtimeIdentity
      : source.runtimeId === parent.runtimeId
  const parentTask = sources
    .filter(isLocal)
    .map((source) => source.tasks.find((task) => task.id === parent.id))
    .find((task) => task !== undefined)
  const seen = new Set<string>()
  return sources
    .flatMap((source) => {
      const local = isLocal(source)
      return source.tasks.flatMap((task) => {
        const invocation = botInvocationParent(
          task,
          task.replica?.ownerRuntimeId ?? source.runtimeIdentity,
        )
        const sideCall =
          invocation?.threadId === parent.id &&
          !invocation.subthread &&
          (parent.runtimeIdentity && invocation.runtimeIdentity
            ? invocation.runtimeIdentity === parent.runtimeIdentity
            : !task.botMention?.sourceRuntimeId && local)
        const botChild =
          (task.botConversation?.botId ?? task.botJob?.botId) === parent.id &&
          (!parentTask || !!parentTask.bot) &&
          local
        if (local && task.id === parent.id) return []
        if (!sideCall && !botChild && !(local && task.sideThread?.parentTaskId === parent.id))
          return []
        return [
          {
            task,
            runtimeId: source.runtimeId,
            runtimeIdentity: source.runtimeIdentity,
            mention: sideCall ? task.botMention : undefined,
            mentionSourceTitle: sideCall
              ? mentionSourceTitle(task, () => parentTask?.title)
              : undefined,
          },
        ]
      })
    })
    .filter((row) => {
      const key = JSON.stringify([row.runtimeIdentity ?? row.runtimeId, row.task.id])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort(
      (a, b) =>
        Number(!!a.task.archivedAt) - Number(!!b.task.archivedAt) ||
        b.task.createdAt.localeCompare(a.task.createdAt) ||
        a.task.id.localeCompare(b.task.id),
    )
}
