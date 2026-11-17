import type { TaskMetadata } from './task-summary.js'
import { botParentLink, mentionSourceTitle } from './thread-parent.js'

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
        const link = botParentLink(task)
        const botChild =
          link?.botId === parent.id &&
          (!parentTask || !!parentTask.bot) &&
          (link.runtimeIdentity === undefined
            ? local
            : link.runtimeIdentity === parent.runtimeIdentity)
        if (local && task.id === parent.id) return []
        if (!botChild && !(local && task.sideThread?.parentTaskId === parent.id)) return []
        return [
          {
            task,
            runtimeId: source.runtimeId,
            runtimeIdentity: source.runtimeIdentity,
            mention: botChild && link.runtimeIdentity !== undefined ? task.botMention : undefined,
            mentionSourceTitle: botChild
              ? mentionSourceTitle(
                  task,
                  (id) => source.tasks.find((candidate) => candidate.id === id)?.title,
                )
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
