import { nativeAgentWorking } from '../conversation/workflow/subagents.js'
import type { TaskMetadata } from './task-summary.js'

/** Display activity across a thread's children without changing its own execution status. */
export function taskIsWorking(
  task: Pick<TaskMetadata, 'status' | 'subagents' | 'threadWatches' | 'subagentInbox' | 'queue'>,
) {
  return (
    task.status === 'running' ||
    task.subagents?.some(
      (agent) =>
        (agent.source === 'dovo'
          ? agent.status === 'working' && !agent.finishedAt
          : nativeAgentWorking(agent)) || agent.completion === 'pending',
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
