import type { Task } from '../workspace.js'
import { compareTaskActivity } from './task-priority.js'

export const settledSummaryPageSize = 25
/** Other orderings need complete summaries so the first page cannot omit their top rows. */
export function supportsSettledSummaryPaging(sort: string) {
  return sort === 'priority' || sort === 'activity'
}
/** Retain live/protected rows and ancestors even when their settled date is old. */
export function settledSummaryPage<T extends Task>(
  tasks: readonly T[],
  limit: number,
  selected: readonly string[] = [],
  now = Date.now(),
) {
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
  eligible.sort((a, b) => compareTaskActivity(a, b))
  const omitted = new Set(eligible.slice(limit).map((task) => task.id))
  return { tasks: tasks.filter((task) => !omitted.has(task.id)), omitted: omitted.size }
}
