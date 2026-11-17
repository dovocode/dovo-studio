import type { TaskMetadata } from './task-summary.js'

export function botParentLink(
  task: Pick<TaskMetadata, 'botConversation' | 'botMention' | 'botJob'>,
): { botId: string; runtimeIdentity?: string } | undefined {
  if (task.botConversation) return task.botConversation
  if (task.botMention)
    return { botId: task.botMention.botId, runtimeIdentity: task.botMention.runtimeId }
  return task.botJob
}

export function mentionSourceTitle(
  task: Pick<TaskMetadata, 'botMention' | 'forkedFrom'>,
  lookup: (id: string) => string | undefined,
) {
  if (!task.botMention) return undefined
  const id = task.botMention.sourceTaskId
  return lookup(id) || (task.forkedFrom?.taskId === id ? task.forkedFrom.title : undefined)
}

/** Resolve only navigation provenance. This never grants access to the referenced runtime. */
export function taskParentReference(
  task: TaskMetadata,
  runtimeId: string | null,
  tasks: readonly TaskMetadata[],
  runtimeIdentity?: string,
  sources: readonly {
    runtimeId: string | null
    runtimeIdentity?: string
    tasks: readonly TaskMetadata[]
  }[] = [],
) {
  const botLink = botParentLink(task)
  if (botLink) {
    const identity = botLink.runtimeIdentity
    const local = identity === undefined || identity === runtimeIdentity
    const source = local
      ? { runtimeId, tasks }
      : sources.find((source) => source.runtimeIdentity === identity)
    const parent = source?.tasks.find((parent) => parent.id === botLink.botId)
    if (!parent || parent.bot)
      return {
        runtimeId: source ? source.runtimeId : (identity ?? null),
        runtimeIdentity: identity ?? runtimeIdentity,
        threadId: botLink.botId,
        title: parent?.title ?? 'Bot',
      }
  }
  if (task.sideThread)
    return {
      runtimeId,
      runtimeIdentity,
      threadId: task.sideThread.parentTaskId,
      title:
        tasks.find((parent) => parent.id === task.sideThread?.parentTaskId)?.title ??
        'Parent thread',
    }
  if (task.spawnParent)
    return {
      runtimeId: task.spawnParent.runtimeId,
      runtimeIdentity: task.spawnParent.runtimeId,
      threadId: task.spawnParent.threadId,
      title: task.spawnParent.title ?? 'Parent thread',
    }
  if (!task.delegation) {
    // Existing targeted children predate the durable backlink. Infer only explicit saved ownership.
    for (const source of [{ runtimeId, runtimeIdentity, tasks }, ...sources])
      for (const owner of source.tasks)
        if (
          owner.threadWatches?.some(
            (watch) =>
              watch.relation === 'spawned' &&
              (watch.snapshot?.runtimeId
                ? watch.snapshot.runtimeId === (task.replica?.ownerRuntimeId ?? runtimeIdentity) &&
                  watch.threadId === (task.replica?.threadId ?? task.id)
                : watch.threadId === task.id &&
                  (watch.runtimeId === 'local'
                    ? source.runtimeIdentity && runtimeIdentity
                      ? source.runtimeIdentity === runtimeIdentity
                      : source.runtimeId === runtimeId
                    : watch.runtimeId === runtimeId)),
          )
        )
          return {
            runtimeId: source.runtimeId,
            runtimeIdentity: source.runtimeIdentity,
            threadId: owner.id,
            title: owner.title,
          }
    return undefined
  }
  return {
    runtimeId,
    runtimeIdentity,
    threadId: task.delegation.parentTaskId,
    title:
      tasks.find((parent) => parent.id === task.delegation?.parentTaskId)?.title ?? 'Parent thread',
  }
}
