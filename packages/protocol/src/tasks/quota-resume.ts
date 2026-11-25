import type { Task, TaskTurn } from '../workspace.js'

/** An individual retry runs only against the failed turn the user reviewed. */
export function quotaRetryTurn(
  task: Pick<
    Task,
    | 'status'
    | 'activeRunId'
    | 'runPhase'
    | 'archived'
    | 'archivedAt'
    | 'example'
    | 'replica'
    | 'machineHandoff'
    | 'delegation'
    | 'botJob'
    | 'queue'
    | 'subagentInbox'
  >,
  turn: Pick<TaskTurn, 'id' | 'status' | 'quotaRetryAt'> | undefined,
  beforeReset?: number,
) {
  if (
    task.status !== 'failed' ||
    task.activeRunId ||
    task.runPhase ||
    task.archived ||
    task.archivedAt ||
    task.example ||
    task.replica ||
    task.machineHandoff ||
    task.delegation ||
    task.botJob ||
    task.queue?.length ||
    task.subagentInbox?.length ||
    turn?.status !== 'failed' ||
    !turn.quotaRetryAt ||
    (beforeReset !== undefined && !(Date.parse(turn.quotaRetryAt) > beforeReset))
  )
    return undefined
  return { turnId: turn.id, at: turn.quotaRetryAt }
}
