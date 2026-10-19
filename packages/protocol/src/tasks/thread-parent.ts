import type { TaskMetadata } from './task-summary.js'

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
  if (task.spawnParent)
    return {
      runtimeId: task.spawnParent.runtimeId,
      runtimeIdentity: task.spawnParent.runtimeId,
      threadId: task.spawnParent.threadId,
      title: task.spawnParent.title ?? 'Parent thread',
    }
  if (!task.delegation) {
    // Existing targeted children predate the durable backlink. Infer only explicit saved ownership.
    for (const source of sources)
      for (const owner of source.tasks)
        if (
          owner.threadWatches?.some(
            (watch) =>
              watch.relation === 'spawned' &&
              watch.threadId === task.id &&
              ((runtimeIdentity && watch.snapshot?.runtimeId === runtimeIdentity) ||
                watch.runtimeId === runtimeId ||
                (watch.runtimeId === 'local' && source.runtimeId === runtimeId)),
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
