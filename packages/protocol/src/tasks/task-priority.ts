import { taskIsWorking } from './task-working.js'
import type { Task } from '../workspace.js'
import { Schema } from 'effect'
import { mutableArray, decodeResult } from '../shared/schema.js'

export const defaultTaskSnoozeMinutes = [60, 240, 1440, 2880, 4320, 10080]
export const taskSnoozeMinutesSchema = mutableArray(
  Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 525600 })),
  ),
).pipe(
  Schema.check(
    Schema.makeFilter(
      (values) =>
        values.length >= 1 && values.length <= 12 && new Set(values).size === values.length,
      { message: 'Choose 1–12 different durations between 1 minute and 365 days.' },
    ),
  ),
)

export function taskSnoozeChoices(minutes: readonly number[] = defaultTaskSnoozeMinutes) {
  return minutes.map((value) => {
    const [amount, unit] =
      value >= 2880 && value % 1440 === 0
        ? ([value / 1440, 'day'] as const)
        : value % 60 === 0
          ? ([value / 60, 'hour'] as const)
          : ([value, 'minute'] as const)
    return { hours: value / 60, label: `For ${amount} ${unit}${amount === 1 ? '' : 's'}` }
  })
}
export const taskSnoozeOptions = taskSnoozeChoices()

export function formatTaskSnoozeMinutes(minutes: readonly number[]) {
  return minutes
    .map((value) => {
      for (const [unit, multiplier] of [
        ['w', 10080],
        ['d', 1440],
        ['h', 60],
      ] as const)
        if (value % multiplier === 0) return `${value / multiplier}${unit}`
      return `${value}m`
    })
    .join(', ')
}

export function parseTaskSnoozeMinutes(text: string): number[] {
  const minutes = text.split(',').map((part) => {
    const match = /^(\d+(?:\.\d+)?)\s*([mhdw])$/i.exec(part.trim())
    if (!match) throw new Error('Use comma-separated durations such as 15m, 1h, 4h, 1d or 1w.')
    const multiplier = { m: 1, h: 60, d: 1440, w: 10080 }[match[2]!.toLowerCase()]
    return Number(match[1]) * (multiplier ?? 0)
  })
  const result = decodeResult(taskSnoozeMinutesSchema, minutes)
  if (!result.success)
    throw new Error(
      'Choose 1–12 different durations between 1 minute and 365 days, in whole minutes.',
    )
  return result.data
}

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
