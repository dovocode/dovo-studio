import { nativeAgentWorking } from '../conversation/workflow/subagents.js'
import type { TaskTurn } from '../workspace.js'
import type { TaskMetadata } from './task-summary.js'

/** Display activity across a thread's children without changing its own execution status. */
export function taskIsWorking(
  task: Pick<TaskMetadata, 'status' | 'subagents' | 'threadWatches' | 'subagentInbox' | 'queue'>,
) {
  return (
    task.status === 'running' ||
    task.subagents?.some(
      (agent) =>
        agent.kind !== 'background' &&
        ((agent.source === 'dovo'
          ? agent.status === 'working' && !agent.finishedAt
          : nativeAgentWorking(agent)) ||
          agent.completion === 'pending'),
    ) === true ||
    task.threadWatches?.some(
      (watch) =>
        watch.delegated &&
        watch.status === 'watching' &&
        !watch.paused &&
        (watch.offline || watch.snapshot?.phase !== 'completed'),
    ) === true ||
    !!task.subagentInbox?.length ||
    task.queue?.some((message) => !!message.subagentResultId) === true
  )
}

export function threadStatusTimestamp(
  task: TaskMetadata,
  turn?: Pick<TaskTurn, 'startedAt' | 'finishedAt'>,
) {
  if (task.status === 'running' && task.runPhase !== 'finalizing') return turn?.startedAt
  if (task.status !== 'running' && taskIsWorking(task)) return undefined
  return (
    turn?.finishedAt ??
    (!task.archived && !task.archivedAt && (task.status === 'review' || task.status === 'done')
      ? (task.lastPromptAt ?? task.createdAt)
      : undefined)
  )
}

/** Keep the parent turn's clock while the thread is still working through its children. */
export function threadWorkingSince(task: TaskMetadata, turn?: Pick<TaskTurn, 'startedAt'>) {
  const running = task.status === 'running' ? task.runPhase !== 'finalizing' : taskIsWorking(task)
  return running ? turn?.startedAt : undefined
}

/** Provider-owned shell jobs can outlive an agent turn without keeping the thread Working. */
export function taskBackgroundTerminalCount(task: Pick<TaskMetadata, 'subagents'>) {
  return (
    task.subagents?.filter((agent) => agent.kind === 'background' && nativeAgentWorking(agent))
      .length ?? 0
  )
}
