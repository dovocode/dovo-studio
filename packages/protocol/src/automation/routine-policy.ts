import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct } from '../shared/schema.js'
const positive = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThan(0)),
)
export const routinePolicySchema = mutableStruct({
  matter: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
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
export const routineJsonPointerSchema = maxValue(Schema.String, 1000).pipe(
  Schema.check(Schema.isPattern(/^(?:\/(?:[^~]|~[01])*)*$/)),
)
export const routineMonitorSchema = mutableStruct({
  url: maxValue(Schema.String, 2000),
  mcp: Schema.optional(
    mutableStruct({
      server: maxValue(minValue(Schema.String, 1), 80),
      uri: maxValue(minValue(Schema.String, 1), 2000),
    }),
  ),
  /** RFC 6901 pointer. Absent compares the complete response bytes. */
  jsonPointer: Schema.optional(routineJsonPointerSchema),
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

export function routineOptionFields(flow: {
  policy?: RoutinePolicy
  monitor?: typeof routineMonitorSchema.Type
}) {
  return {
    matter: flow.policy?.matter ?? '',
    minutes: flow.policy?.minutes?.toString() ?? '',
    tokens: flow.policy?.tokens?.toString() ?? '',
    costUsd: flow.policy?.costUsd?.toString() ?? '',
    url: flow.monitor?.url ?? '',
    jsonPointer: flow.monitor?.jsonPointer ?? '',
    mcpServer: flow.monitor?.mcp?.server ?? '',
    mcpUri: flow.monitor?.mcp?.uri ?? '',
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
    matter: fields.matter.trim() || undefined,
    minutes: fields.minutes.trim() ? Number(fields.minutes) : undefined,
    tokens: fields.tokens.trim() ? Number(fields.tokens) : undefined,
    costUsd: fields.costUsd.trim() ? Number(fields.costUsd) : undefined,
    quietHours:
      fields.start || fields.end
        ? { start: fields.start, end: fields.end, timezone: fields.timezone }
        : undefined,
  })
  if (policy.quietHours) new Intl.DateTimeFormat('en', { timeZone: policy.quietHours.timezone })
  if ((fields.mcpServer.trim() || fields.mcpUri.trim()) && fields.url.trim())
    throw new Error('Choose one HTTP or MCP resource source.')
  const mcp =
    fields.mcpServer.trim() || fields.mcpUri.trim()
      ? { server: fields.mcpServer.trim(), uri: fields.mcpUri.trim() }
      : undefined
  if (fields.jsonPointer && !fields.url.trim() && !mcp)
    throw new Error('A JSON pointer needs a source URL.')
  const monitor =
    fields.url.trim() || mcp
      ? Schema.decodeUnknownSync(routineMonitorSchema)({
          url: fields.url.trim() ? routineMonitorUrl(fields.url.trim()).href : '',
          mcp,
          jsonPointer: fields.jsonPointer || undefined,
        })
      : undefined
  return { policy, monitor }
}
export const routineOptionLabels = {
  matter: 'Finding group (optional, shared across routines for this Bot)',
  url: 'Monitor source URL',
  jsonPointer: 'JSON pointer (optional, e.g. /release/version)',
  mcpServer: 'Monitor MCP server (resource reads only)',
  mcpUri: 'Monitor MCP resource URI',
  minutes: 'Time limit (minutes)',
  tokens: 'Token limit',
  costUsd: 'Estimated cost limit (USD)',
  start: 'Quiet hours start',
  end: 'Quiet hours end',
  timezone: 'Quiet hours time zone',
} as const
