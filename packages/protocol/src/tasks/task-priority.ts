import { taskIsWorking } from './task-working.js'
import type { Task } from '../workspace.js'

export const taskSnoozeOptions = [
  { hours: 1, label: 'For 1 hour' },
  { hours: 4, label: 'For 4 hours' },
  { hours: 24, label: 'For 24 hours' },
  { hours: 48, label: 'For 2 days' },
  { hours: 72, label: 'For 3 days' },
  { hours: 168, label: 'For 7 days' },
] as const

export function isSnoozed(task: Task, now: number) {
  return !!task.snoozedUntil && Date.parse(task.snoozedUntil) > now
}
function promptTime(task: Task) {
  if (task.lastPromptAt) return task.lastPromptAt
  // Older servers do not report lastPromptAt. Use actual user input, never updatedAt.
  let latest = task.createdAt
  for (const messages of [task.messages, task.queue ?? []]) {
    for (const message of messages) {
      if (
        message.role !== 'user' ||
        message.id.startsWith('answer:') ||
        message.file ||
        message.review ||
        message.text.trim() === '/compact'
      )
        continue
      if (message.createdAt && message.createdAt > latest) latest = message.createdAt
    }
  }
  return latest
}
export function compareTaskActivity(a: Task, b: Task, _needsInput?: ReadonlySet<string>) {
  return promptTime(b).localeCompare(promptTime(a)) || a.id.localeCompare(b.id)
}

export const taskSortOptions = [
  { id: 'priority', name: 'Latest prompt' },
  { id: 'status', name: 'Status' },
  { id: 'activity', name: 'Latest input' },
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
// Reuse ICU collation state instead of constructing it for every sort comparison.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
export function compareTasks(
  a: Task,
  b: Task,
  sort: string,
  needsInput: ReadonlySet<string>,
  projects: ReadonlyMap<string, string>,
) {
  const pinned = Number(!!b.pinned) - Number(!!a.pinned)
  if (pinned) return pinned
  const recent = () => compareTaskActivity(a, b, needsInput)
  switch (sort) {
    case 'status': {
      const order = ['running', 'review', 'failed', 'draft', 'done', 'cancelled']
      return (
        order.indexOf(taskIsWorking(a) ? 'running' : a.status) -
          order.indexOf(taskIsWorking(b) ? 'running' : b.status) || recent()
      )
    }
    case 'activity':
      return recent()
    case 'newest':
      return b.createdAt.localeCompare(a.createdAt) || recent()
    case 'oldest':
      return a.createdAt.localeCompare(b.createdAt) || recent()
    case 'title':
      return nameCollator.compare(a.title, b.title) || recent()
    case 'project':
      return (
        nameCollator.compare(
          projects.get(a.repositoryId) ?? '',
          projects.get(b.repositoryId) ?? '',
        ) || recent()
      )
    default:
      return compareTaskActivity(a, b, needsInput)
  }
}
