import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct } from '../shared/schema.js'
const positive = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThan(0)),
)
export const routinePolicySchema = mutableStruct({
  minutes: Schema.optional(maxValue(positive, 1440)),
  tokens: Schema.optional(maxValue(positive.pipe(Schema.check(Schema.isInt())), 100000000)),
  costUsd: Schema.optional(maxValue(positive, 10000)),
  quietHours: Schema.optional(
    mutableStruct({
      start: Schema.String.pipe(Schema.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/))),
      end: Schema.String.pipe(Schema.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/))),
      timezone: maxValue(minValue(Schema.String, 1), 100),
    }),
  ),
})
export const routineMonitorSchema = mutableStruct({
  url: maxValue(minValue(Schema.String, 1), 2000),
})
export type RoutinePolicy = typeof routinePolicySchema.Type
/** Equal start and end means no quiet interval. Local wall time supports overnight ranges and DST. */
export function routineQuietNow(quiet: RoutinePolicy['quietHours'], now = Date.now()) {
  if (!quiet || quiet.start === quiet.end) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: quiet.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const time = `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}`
  return quiet.start < quiet.end
    ? time >= quiet.start && time < quiet.end
    : time >= quiet.start || time < quiet.end
}
export function routineMonitorUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Use an HTTP or HTTPS source URL without credentials or a fragment.')
  return url
}

export function routineOptionFields(flow: { policy?: RoutinePolicy; monitor?: { url: string } }) {
  return {
    minutes: flow.policy?.minutes?.toString() ?? '',
    tokens: flow.policy?.tokens?.toString() ?? '',
    costUsd: flow.policy?.costUsd?.toString() ?? '',
    url: flow.monitor?.url ?? '',
    start: flow.policy?.quietHours?.start ?? '',
    end: flow.policy?.quietHours?.end ?? '',
    timezone:
      flow.policy?.quietHours?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC',
  }
}
export function parseRoutineOptions(fields: ReturnType<typeof routineOptionFields>) {
  const policy = Schema.decodeUnknownSync(routinePolicySchema)({
    minutes: fields.minutes.trim() ? Number(fields.minutes) : undefined,
    tokens: fields.tokens.trim() ? Number(fields.tokens) : undefined,
    costUsd: fields.costUsd.trim() ? Number(fields.costUsd) : undefined,
    quietHours:
      fields.start || fields.end
        ? { start: fields.start, end: fields.end, timezone: fields.timezone }
        : undefined,
  })
  if (policy.quietHours) new Intl.DateTimeFormat('en', { timeZone: policy.quietHours.timezone })
  const monitor = fields.url.trim() ? { url: routineMonitorUrl(fields.url.trim()).href } : undefined
  return { policy, monitor }
}
export const routineOptionLabels = {
  url: 'Monitor source URL',
  minutes: 'Time limit (minutes)',
  tokens: 'Token limit',
  costUsd: 'Estimated cost limit (USD)',
  start: 'Quiet hours start',
  end: 'Quiet hours end',
  timezone: 'Quiet hours time zone',
} as const
