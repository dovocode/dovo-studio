import { taskIsWorking } from './task-working.js'
import type { Task } from '../workspace.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct, decodeResult } from '../shared/schema.js'

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

export const taskSnoozeCalendarPresets = [
  ['later-today', 'Later today'],
  ['tomorrow-morning', 'Tomorrow morning'],
  ['tomorrow-evening', 'Tomorrow evening'],
  ['next-week', 'Next week'],
] as const
export const taskSnoozeWeekdays = Array.from({ length: 7 }, (_, day) => ({
  id: String(day),
  name: new Date(2024, 0, 7 + day).toLocaleDateString(undefined, { weekday: 'long' }),
}))
const snoozeClock = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)),
)
export const taskSnoozeScheduleSchema = mutableStruct({
  morningTime: snoozeClock,
  eveningTime: snoozeClock,
  weekStartsOn: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  ),
  presets: mutableArray(Schema.Literals(taskSnoozeCalendarPresets.map(([id]) => id))).pipe(
    Schema.check(Schema.makeFilter((values) => new Set(values).size === values.length)),
  ),
})
export type TaskSnoozeSchedule = typeof taskSnoozeScheduleSchema.Type
export const defaultTaskSnoozeSchedule: TaskSnoozeSchedule = {
  morningTime: '09:00',
  eveningTime: '18:00',
  weekStartsOn: 1,
  presets: taskSnoozeCalendarPresets.map(([id]) => id),
}
export function parseTaskSnoozeSchedule(value: unknown): TaskSnoozeSchedule {
  const result = decodeResult(taskSnoozeScheduleSchema, value)
  if (!result.success)
    throw new Error(
      'Use 24-hour times such as 09:00 and 18:00, a valid weekday, and different shortcuts.',
    )
  return result.data
}
export type TaskSnoozeChoice = { id: string; label: string; until: () => string }
/** Resolve at selection time, using local calendar days rather than 24-hour increments. */
export function taskSnoozeMenuChoices(
  minutes: readonly number[] = defaultTaskSnoozeMinutes,
  schedule: TaskSnoozeSchedule = defaultTaskSnoozeSchedule,
): TaskSnoozeChoice[] {
  const calendar = schedule.presets
    .filter((preset) => {
      if (preset !== 'later-today') return true
      const now = new Date()
      const cutoff = new Date(now)
      const [hours, minutes] = schedule.eveningTime.split(':').map(Number)
      cutoff.setHours(hours!, minutes!, 0, 0)
      return cutoff > now
    })
    .map((preset) => {
      const evening = preset === 'later-today' || preset === 'tomorrow-evening'
      const clock = evening ? schedule.eveningTime : schedule.morningTime
      const label = taskSnoozeCalendarPresets.find(([id]) => id === preset)![1]
      const name =
        preset === 'next-week' ? `Next ${taskSnoozeWeekdays[schedule.weekStartsOn]!.name}` : label
      return {
        id: preset,
        label: `${name} · ${clock}`,
        until: () => {
          const now = new Date()
          const target = new Date(now)
          const [hours, minutes] = clock.split(':').map(Number)
          if (preset === 'next-week')
            target.setDate(
              target.getDate() + ((schedule.weekStartsOn - target.getDay() + 7) % 7 || 7),
            )
          else if (preset !== 'later-today') target.setDate(target.getDate() + 1)
          target.setHours(hours!, minutes!, 0, 0)
          // A menu left open past the cutoff still schedules a future evening.
          if (target <= now) target.setDate(target.getDate() + 1)
          return target.toISOString()
        },
      }
    })
  return [
    ...calendar,
    ...taskSnoozeChoices(minutes).map(({ hours, label }) => ({
      id: `duration-${hours}`,
      label,
      until: () => new Date(Date.now() + hours * 3600000).toISOString(),
    })),
  ]
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
