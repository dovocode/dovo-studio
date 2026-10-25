import type { Task } from '../workspace.js'

export const settledSummaryPageSize = 25
/** Retain live/protected rows and ancestors even when their settled date is old. */
export function settledSummaryPage<
  T extends Pick<
    Task,
    | 'id'
    | 'archived'
    | 'archivedAt'
    | 'pinned'
    | 'status'
    | 'snoozedUntil'
    | 'waitingForFeedback'
    | 'settledAt'
    | 'updatedAt'
    | 'createdAt'
    | 'subagents'
  >,
>(tasks: readonly T[], limit: number, selected: readonly string[] = [], now = Date.now()) {
  const protectedIds = new Set(selected)
  for (const task of tasks)
    for (const child of task.subagents ?? [])
      if (child.taskId) {
        protectedIds.add(task.id)
        protectedIds.add(child.taskId)
      }
  const eligible = tasks.filter(
    (task) =>
      task.archived &&
      !task.archivedAt &&
      !task.pinned &&
      task.status !== 'running' &&
      !task.waitingForFeedback &&
      !protectedIds.has(task.id) &&
      !(task.snoozedUntil && Date.parse(task.snoozedUntil) > now),
  )
  eligible.sort(
    (a, b) =>
      Date.parse(b.settledAt ?? b.updatedAt ?? b.createdAt) -
        Date.parse(a.settledAt ?? a.updatedAt ?? a.createdAt) || a.id.localeCompare(b.id),
  )
  const omitted = new Set(eligible.slice(limit).map((task) => task.id))
  return { tasks: tasks.filter((task) => !omitted.has(task.id)), omitted: omitted.size }
}
