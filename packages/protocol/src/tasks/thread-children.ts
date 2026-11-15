import type { TaskMetadata } from './task-summary.js'

type ChildMetadata = Pick<
  TaskMetadata,
  'id' | 'createdAt' | 'archivedAt' | 'sideThread' | 'botJob' | 'botMention'
>

/** Presentation only. A Bot association never transfers execution or grants access. */
export function threadChildren<T extends ChildMetadata>(
  sources: readonly { runtimeId: string | null; runtimeIdentity?: string; tasks: readonly T[] }[],
  parent: { id: string; runtimeId: string | null; runtimeIdentity?: string },
) {
  const seen = new Set<string>()
  return sources
    .flatMap((source) =>
      source.tasks.flatMap((task) => {
        const local =
          source.runtimeIdentity && parent.runtimeIdentity
            ? source.runtimeIdentity === parent.runtimeIdentity
            : source.runtimeId === parent.runtimeId
        const mentioned =
          task.botMention?.botId === parent.id &&
          !!parent.runtimeIdentity &&
          task.botMention.runtimeId === parent.runtimeIdentity
        if (local && task.id === parent.id) return []
        if (
          !mentioned &&
          !(
            local &&
            (task.sideThread?.parentTaskId === parent.id || task.botJob?.botId === parent.id)
          )
        )
          return []
        return [{ task, runtimeId: source.runtimeId, runtimeIdentity: source.runtimeIdentity }]
      }),
    )
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
