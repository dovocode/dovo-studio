import type { Task } from './workspace.js'
export function isSnoozed(task: Task, now: number) {
  return !!task.snoozedUntil && Date.parse(task.snoozedUntil) > now
}
export function compareTaskActivity(a: Task, b: Task, needsInput: ReadonlySet<string>) {
  const priority = (task: Task) =>
    needsInput.has(task.id) ? 0 : task.status === 'failed' ? 1 : task.status === 'running' ? 2 : 3
  return (
    priority(a) - priority(b) ||
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) ||
    a.id.localeCompare(b.id)
  )
}

export const taskSortOptions = [
  { id: 'priority', name: 'Priority' },
  { id: 'activity', name: 'Recent activity' },
  { id: 'newest', name: 'Newest first' },
  { id: 'oldest', name: 'Oldest first' },
  { id: 'title', name: 'Title A–Z' },
  { id: 'project', name: 'Project A–Z' },
] as const
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
  const recent =
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) ||
    a.id.localeCompare(b.id)
  switch (sort) {
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
