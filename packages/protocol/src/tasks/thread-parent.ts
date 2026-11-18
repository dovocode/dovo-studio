import type { TaskMetadata } from './task-summary.js'
import { SCRATCH_PROJECT_ID } from '../workspace.js'
import type { ThreadWatchSummary } from './thread-watches.js'

export function botProjectThread(
  callerIsBot: boolean | undefined,
  repositoryId: string | undefined,
) {
  return !!callerIsBot && !!repositoryId && repositoryId !== SCRATCH_PROJECT_ID
}

export function spawnedThreadWatch(caller: Pick<TaskMetadata, 'bot'>, watch: ThreadWatchSummary) {
  return (
    watch.relation === 'spawned' &&
    !watch.steering &&
    !(caller.bot && watch.snapshot?.projectKind === 'project') &&
    !botProjectThread(!!caller.bot, watch.snapshot?.repositoryId)
  )
}

export function botInvocationParent(
  task: Pick<TaskMetadata, 'botMention'>,
  ownerIdentity?: string,
) {
  const invocation = task.botMention
  if (!invocation) return undefined
  const runtimeIdentity = invocation.sourceRuntimeId ?? ownerIdentity
  return {
    threadId: invocation.sourceTaskId,
    runtimeIdentity,
    subthread:
      invocation.sourceTaskId === invocation.botId && runtimeIdentity === invocation.runtimeId,
  }
}

export function mentionSourceTitle(
  task: Pick<TaskMetadata, 'botMention' | 'forkedFrom'>,
  lookup: (id: string) => string | undefined,
) {
  if (!task.botMention) return undefined
  const id = task.botMention.sourceTaskId
  return (
    lookup(id) ||
    task.botMention.sourceTitle ||
    (task.forkedFrom?.taskId === id ? task.forkedFrom.title : undefined)
  )
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
  const invocation = botInvocationParent(task, task.replica?.ownerRuntimeId ?? runtimeIdentity)
  if (
    invocation &&
    (invocation.threadId !== (task.replica?.threadId ?? task.id) ||
      invocation.runtimeIdentity !== (task.replica?.ownerRuntimeId ?? runtimeIdentity))
  ) {
    const identity = invocation.runtimeIdentity
    const local = identity === undefined || identity === runtimeIdentity
    const source = local
      ? { runtimeId, tasks }
      : sources.find((source) => source.runtimeIdentity === identity)
    return {
      runtimeId: source ? source.runtimeId : (identity ?? null),
      runtimeIdentity: identity,
      threadId: invocation.threadId,
      title:
        mentionSourceTitle(task, (id) => source?.tasks.find((parent) => parent.id === id)?.title) ??
        'Parent thread',
    }
  }
  const botId = task.botConversation?.botId ?? task.botJob?.botId
  if (botId) {
    const parent = tasks.find((parent) => parent.id === botId)
    if (!parent || parent.bot)
      return {
        runtimeId,
        runtimeIdentity,
        threadId: botId,
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
  if (task.spawnParent) {
    const owner = task.spawnParent
    const source =
      owner.runtimeId === runtimeIdentity
        ? tasks
        : sources.find((source) => source.runtimeIdentity === owner.runtimeId)?.tasks
    if (
      owner.steering ||
      botProjectThread(
        !!source?.find((parent) => parent.id === owner.threadId)?.bot,
        task.repositoryId,
      )
    )
      return undefined
    return {
      runtimeId: owner.runtimeId,
      runtimeIdentity: owner.runtimeId,
      threadId: owner.threadId,
      title: owner.title ?? 'Parent thread',
    }
  }
  if (!task.delegation) {
    // Existing targeted children predate the durable backlink. Infer only explicit saved ownership.
    for (const source of [{ runtimeId, runtimeIdentity, tasks }, ...sources])
      for (const owner of source.tasks)
        if (
          owner.threadWatches?.some(
            (watch) =>
              spawnedThreadWatch(owner, watch) &&
              !botProjectThread(!!owner.bot, task.repositoryId) &&
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
