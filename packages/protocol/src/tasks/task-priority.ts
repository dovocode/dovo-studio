import type { Task } from '../workspace.js'
export function isSnoozed(task: Task, now: number) {
  return !!task.snoozedUntil && Date.parse(task.snoozedUntil) > now
}
function activityTime(task: Task) {
  return task.status === 'running'
    ? (task.turns?.at(-1)?.startedAt ?? task.createdAt)
    : (task.updatedAt ?? task.createdAt)
}
export function compareTaskActivity(a: Task, b: Task, needsInput: ReadonlySet<string>) {
  const priority = (task: Task) =>
    needsInput.has(task.id) ? 0 : task.status === 'failed' ? 1 : task.status === 'running' ? 2 : 3
  return (
    priority(a) - priority(b) ||
    activityTime(b).localeCompare(activityTime(a)) ||
    a.id.localeCompare(b.id)
  )
}

export const taskSortOptions = [
  { id: 'priority', name: 'Priority' },
  { id: 'status', name: 'Status' },
  { id: 'activity', name: 'Recent activity' },
  { id: 'newest', name: 'Newest first' },
  { id: 'oldest', name: 'Oldest first' },
  { id: 'title', name: 'Title A–Z' },
  { id: 'project', name: 'Project A–Z' },
] as const
export const taskGroupOptions = [
  { id: 'none', name: 'No grouping' },
  { id: 'status', name: 'Status' },
  { id: 'project', name: 'Project' },
] as const
export type TaskGroup = (typeof taskGroupOptions)[number]['id']
export type TaskSort = (typeof taskSortOptions)[number]['id']
export function compareTasks(
  a: Task,
  b: Task,
  sort: string,
  needsInput: ReadonlySet<string>,
  projects: ReadonlyMap<string, string>,
) {
  const pinned = Number(!!b.pinned) - Number(!!a.pinned)
  if (pinned) return pinned
  const recent = activityTime(b).localeCompare(activityTime(a)) || a.id.localeCompare(b.id)
  switch (sort) {
    case 'status': {
      const order = ['running', 'review', 'failed', 'draft', 'done', 'cancelled']
      return order.indexOf(a.status) - order.indexOf(b.status) || recent
    }
    case 'activity':
      return recent
    case 'newest':
      return b.createdAt.localeCompare(a.createdAt) || recent
    case 'oldest':
      return a.createdAt.localeCompare(b.createdAt) || recent
    case 'title':
      return (
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || recent
      )
    case 'project':
      return (
        (projects.get(a.repositoryId) ?? '').localeCompare(
          projects.get(b.repositoryId) ?? '',
          undefined,
          { sensitivity: 'base', numeric: true },
        ) || recent
      )
    default:
      return compareTaskActivity(a, b, needsInput)
  }
}
