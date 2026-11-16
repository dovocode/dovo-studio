import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'
import type { Automation, AutomationNode } from '../workspace.js'

/** Same bound as a Reply quote: enough to keep the owner's words, small enough for every row. */
export const ROUTINE_SOURCE_QUOTE_LIMIT = 500
/** A shorter cited quote must be a whole line or sentence, so "on" or "yes" inside a longer
 * message cannot pass as the owner's request. */
export const ROUTINE_CITED_QUOTE_MINIMUM = 12
/** The runtime keeps this many changes per routine, newest first. */
export const ROUTINE_CHANGE_RETENTION = 50
const ROUTINE_FIELD_CHANGE_LIMIT = 20
const FIELD_TEXT_LIMIT = 300

const id = maxValue(minValue(Schema.String, 1), 200)
/** A link to an existing automation, thread or message. It has the same bounds as that record's
 * own ID, so every saved record can be recorded. */
const reference = Schema.String

/** Who caused a routine change. Runtime-authored: clients and agents cannot choose `owner`. */
export const routineChangeSourceSchema = Schema.Union([
  mutableStruct({
    kind: Schema.Literal('owner'),
    taskId: reference,
    messageId: reference,
    quote: maxValue(Schema.String, ROUTINE_SOURCE_QUOTE_LIMIT),
    /** The quote is the start of a longer owner message. */
    truncated: Schema.optional(Schema.Boolean),
    /** The agent cited these exact words and the runtime found them in the owner's message.
     * Without it, the quote is the owner's newest message in the turn that made the change. It
     * shows when the change happened, not that the owner asked for it. */
    cited: Schema.optional(Schema.Boolean),
    /** Set when read: false after the source message or its thread was deleted. */
    linkAvailable: Schema.optional(Schema.Boolean),
  }),
  mutableStruct({
    kind: Schema.Literal('person'),
    deviceName: Schema.optional(maxValue(Schema.String, 200)),
  }),
  mutableStruct({
    kind: Schema.Literal('agent'),
    taskId: Schema.optional(reference),
  }),
])
export type RoutineChangeSource = Schema.Schema.Type<typeof routineChangeSourceSchema>

export const routineFieldChangeSchema = mutableStruct({
  label: maxValue(Schema.String, 200),
  before: Schema.optional(maxValue(Schema.String, FIELD_TEXT_LIMIT)),
  after: Schema.optional(maxValue(Schema.String, FIELD_TEXT_LIMIT)),
})
export type RoutineFieldChange = Schema.Schema.Type<typeof routineFieldChangeSchema>

export const routineChangeSchema = mutableStruct({
  id,
  automationId: reference,
  at: Schema.String,
  action: Schema.Literals(['created', 'updated']),
  source: routineChangeSourceSchema,
  changes: maxValue(mutableArray(routineFieldChangeSchema), ROUTINE_FIELD_CHANGE_LIMIT + 1),
})
export type RoutineChange = Schema.Schema.Type<typeof routineChangeSchema>

/** `POST /api/jobs/provenance` response. An empty list means the source was not recorded. */
export const routineProvenanceSchema = mutableStruct({
  automationId: reference,
  changes: maxValue(mutableArray(routineChangeSchema), ROUTINE_CHANGE_RETENTION),
})
export type RoutineProvenance = Schema.Schema.Type<typeof routineProvenanceSchema>

/** Optional agent input: the exact owner words that asked for this change. The runtime checks
 * that `quote` occurs in an owner message of the calling thread; it never trusts this claim. The
 * quote must have at least `ROUTINE_CITED_QUOTE_MINIMUM` characters, or be a whole line or
 * sentence of the message. */
export const routineSourceInputSchema = mutableStruct({
  messageId: id,
  quote: maxValue(minValue(Schema.String, 1), ROUTINE_SOURCE_QUOTE_LIMIT),
}).annotate({ identifier: 'RoutineSource' })

const clip = (text: string, limit = FIELD_TEXT_LIMIT) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

/** The owner's own words. A Reply block quotes an assistant response, so it never counts. */
export function routineOwnerWords(text: string) {
  return text.replace(/^\[Reply to assistant message [^\n]*\]\n(?:>[^\n]*(?:\n|$))*/gm, '').trim()
}

/** True when `quote` is specific enough to stand for the owner's request: it occurs in the
 * owner's words and is long enough, or is a whole line or sentence of them. */
export function routineCitedQuoteValid(words: string, quote: string) {
  const exact = quote.trim()
  if (!exact || !words.includes(exact)) return false
  if (exact.length >= ROUTINE_CITED_QUOTE_MINIMUM) return true
  return words
    .split('\n')
    .flatMap((line) => [line, ...line.split(/(?<=[.!?])\s+/)])
    .some((part) => part.trim() === exact)
}

/** The start of an owner message's own words, bounded like a Reply quote. */
export function routineSourceQuote(text: string) {
  const words = routineOwnerWords(text)
  return words.length > ROUTINE_SOURCE_QUOTE_LIMIT
    ? { quote: words.slice(0, ROUTINE_SOURCE_QUOTE_LIMIT), truncated: true as const }
    : { quote: words }
}

function triggerText(data: AutomationNode['data']) {
  switch (data.trigger) {
    case 'schedule':
      return `Schedule ${data.schedule} · ${data.timezone}`
    case 'once':
      return `One time ${data.runAt?.replace('T', ' ') ?? ''} · ${data.timezone}`
    case 'github':
      return `GitHub ${data.github?.event ?? ''} · ${data.github?.repository ?? ''}`
    case 'webhook':
      return 'Webhook'
    case 'manual':
      return 'Manual start'
  }
}
function monitorText(monitor: Automation['monitor']) {
  if (!monitor) return 'None'
  if (monitor.mcp) return `MCP ${monitor.mcp.server} · ${monitor.mcp.uri}`
  return monitor.url || 'None'
}
function policyText(policy: Automation['policy']) {
  const parts = [
    policy?.minutes !== undefined ? `${policy.minutes} min` : '',
    policy?.tokens !== undefined ? `${policy.tokens} tokens` : '',
    policy?.costUsd !== undefined ? `$${policy.costUsd}` : '',
    policy?.quietHours
      ? `Quiet ${policy.quietHours.start}-${policy.quietHours.end} ${policy.quietHours.timezone}`
      : '',
  ].filter(Boolean)
  return parts.join(' · ') || 'None'
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const triggerFields = (data: AutomationNode['data']) => [
  data.trigger,
  data.schedule,
  data.timezone,
  data.runAt,
  data.github,
]
/** Step settings other than its name and instructions. Trigger fields are dormant on steps. */
function settings(data: AutomationNode['data']) {
  const {
    label: _label,
    objective: _objective,
    trigger: _trigger,
    schedule: _schedule,
    timezone: _timezone,
    runAt: _runAt,
    github: _github,
    ...rest
  } = data
  return rest
}

/** A short, bounded before/after list for one routine save. Layout-only moves are ignored. */
export function routineChangeSummary(
  before: Automation | undefined,
  after: Automation,
): RoutineFieldChange[] {
  const changes: RoutineFieldChange[] = []
  const add = (label: string, from?: string, to?: string) =>
    changes.push({
      label: clip(label, 200),
      ...(from !== undefined ? { before: clip(from) } : {}),
      ...(to !== undefined ? { after: clip(to) } : {}),
    })
  if (before?.name !== after.name) add('Name', before?.name, after.name)
  if (before && !!before.enabled !== !!after.enabled)
    add('Triggers', before.enabled ? 'Enabled' : 'Paused', after.enabled ? 'Enabled' : 'Paused')
  if (!same(before?.monitor, after.monitor) && (before || after.monitor))
    add('Monitoring', before && monitorText(before.monitor), monitorText(after.monitor))
  if (!same(before?.policy, after.policy) && (before || after.policy))
    add('Limits and quiet hours', before && policyText(before.policy), policyText(after.policy))
  const previous = new Map(before?.nodes.map((node) => [node.id, node]))
  for (const node of after.nodes) {
    const old = previous.get(node.id)
    previous.delete(node.id)
    const data = node.data
    if (data.kind === 'trigger') {
      if (!old || !same(triggerFields(old.data), triggerFields(data)))
        add('Trigger', old && triggerText(old.data), triggerText(data))
      continue
    }
    if (!old) {
      add(`Added step · ${data.label}`, undefined, data.objective || undefined)
      continue
    }
    if (old.data.label !== data.label) add('Step name', old.data.label, data.label)
    if (old.data.objective !== data.objective)
      add(`Instructions · ${data.label}`, old.data.objective, data.objective)
    if (!same(settings(old.data), settings(data))) add(`Step settings · ${data.label}`)
  }
  for (const node of previous.values()) add(`Removed step · ${node.data.label}`)
  const links = (flow?: Automation) =>
    JSON.stringify(
      (flow?.edges ?? [])
        .map((edge) => `${edge.source}>${edge.target}`)
        .sort((a, b) => a.localeCompare(b)),
    )
  if (before && links(before) !== links(after)) add('Step order')
  return changes.length > ROUTINE_FIELD_CHANGE_LIMIT
    ? [
        ...changes.slice(0, ROUTINE_FIELD_CHANGE_LIMIT),
        { label: `${changes.length - ROUTINE_FIELD_CHANGE_LIMIT} more changes` },
      ]
    : changes
}

/** The newest recorded change at or before a run started. That configuration produced the run. */
export function routineChangeForRun(
  changes: readonly RoutineChange[],
  runCreatedAt: string,
): RoutineChange | undefined {
  const started = Date.parse(runCreatedAt)
  return changes
    .filter((change) => Date.parse(change.at) <= started)
    .reduce<RoutineChange | undefined>(
      (newest, change) =>
        !newest || Date.parse(change.at) > Date.parse(newest.at) ? change : newest,
      undefined,
    )
}

/** English display text. Mobile translates the same cases through its interface catalog.
 * "Because you said" is only for a quote the agent cited and the runtime verified. */
export function routineSourceText(source: RoutineChangeSource): string {
  switch (source.kind) {
    case 'owner': {
      const quote = `${source.quote}${source.truncated ? '…' : ''}`
      return source.cited ? `Because you said: "${quote}"` : `During your request: "${quote}"`
    }
    case 'person':
      return source.deviceName
        ? `Changed by you in the editor on ${source.deviceName}`
        : 'Changed by you in the editor'
    case 'agent':
      return 'Changed by an agent without an owner message'
  }
}

export function routineFieldChangeText(change: RoutineFieldChange): string {
  if (change.before !== undefined && change.after !== undefined)
    return `${change.label}: ${change.before} → ${change.after}`
  if (change.after !== undefined) return `${change.label}: ${change.after}`
  if (change.before !== undefined) return `${change.label}: was ${change.before}`
  return change.label
}
