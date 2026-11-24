import { Schema } from 'effect'
import { isoDateTime, maxValue, minValue, mutableArray, mutableStruct } from '../shared/schema.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const text = maxValue(minValue(Schema.String, 1), 12000)
const cursor = Schema.optional(id)

export const remoteMcpDiscoverSchema = mutableStruct({
  repositoryId: Schema.optional(id),
  agentId: Schema.optional(id),
})

export const remoteMcpThreadsSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list'), query: Schema.optional(id), before: cursor }),
  mutableStruct({ action: Schema.Literal('read'), id, before: cursor }),
  mutableStruct({
    action: Schema.Literal('message'),
    id,
    messageId: id,
    offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  mutableStruct({
    action: Schema.Literal('create'),
    title: id,
    repositoryId: id,
    agentId: Schema.optional(id),
    model: Schema.optional(id),
    prompt: text,
    requestId: id,
    start: Schema.Boolean,
  }),
  mutableStruct({ action: Schema.Literal('send'), id, text, messageId: id }),
  mutableStruct({ action: Schema.Literals(['stop', 'resume', 'snapshot']), id }),
])

export const remoteMcpAutomationsSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('list') }),
  mutableStruct({ action: Schema.Literals(['read', 'runs', 'cancel']), id }),
  mutableStruct({ action: Schema.Literal('run'), id, requestId: id }),
])
export const remoteMcpEventsExtension = 'io.modelcontextprotocol/events'
export const remoteMcpEventsVersion = '2026-07-28'
export const remoteMcpEventNameSchema = Schema.Literals([
  'thread.turn_finished',
  'thread.needs_input',
])
export const remoteMcpEventFilterSchema = mutableStruct({
  threadIds: Schema.optional(maxValue(mutableArray(id), 20)),
  projectIds: Schema.optional(maxValue(mutableArray(id), 20)),
})
export const remoteMcpEventPollSchema = mutableStruct({
  name: remoteMcpEventNameSchema,
  arguments: Schema.optional(remoteMcpEventFilterSchema),
  cursor: Schema.optional(Schema.NullOr(id)),
  maxEvents: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  ),
  maxAgeMs: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
    ),
  ),
})
export type RemoteMcpEventPoll = typeof remoteMcpEventPollSchema.Type

const threadFields = { threadId: id, projectId: Schema.NullOr(id) }
export const remoteMcpTurnFinishedSchema = mutableStruct({
  ...threadFields,
  turnId: id,
  outcome: Schema.Literals(['completed', 'failed', 'cancelled']),
})
export const remoteMcpNeedsInputSchema = mutableStruct({
  ...threadFields,
  requestId: id,
  kind: Schema.Literals(['question', 'approval']),
})
const eventFields = { eventId: id, timestamp: isoDateTime(Schema.String) }
export const remoteMcpEventSchema = Schema.Union([
  mutableStruct({
    ...eventFields,
    name: Schema.Literal('thread.turn_finished'),
    data: remoteMcpTurnFinishedSchema,
  }),
  mutableStruct({
    ...eventFields,
    name: Schema.Literal('thread.needs_input'),
    data: remoteMcpNeedsInputSchema,
  }),
])
export type RemoteMcpEvent = typeof remoteMcpEventSchema.Type
export const remoteMcpEventPageSchema = mutableStruct({
  resultType: Schema.Literal('complete'),
  events: maxValue(mutableArray(remoteMcpEventSchema), 100),
  cursor: id,
  truncated: Schema.Boolean,
  hasMore: Schema.Boolean,
  nextPollMs: Schema.Int,
})
export type RemoteMcpEventPage = typeof remoteMcpEventPageSchema.Type

export const remoteMcpCommandSchema = Schema.Union([
  mutableStruct({ part: Schema.Literal('discover'), command: remoteMcpDiscoverSchema }),
  mutableStruct({ part: Schema.Literal('threads'), command: remoteMcpThreadsSchema }),
  mutableStruct({ part: Schema.Literal('automations'), command: remoteMcpAutomationsSchema }),
  mutableStruct({ part: Schema.Literal('events'), command: remoteMcpEventPollSchema }),
])
export type RemoteMcpCommand = typeof remoteMcpCommandSchema.Type

export const remoteMcpAccessSchema = Schema.Literals(['read', 'run'])
export type RemoteMcpAccess = typeof remoteMcpAccessSchema.Type

export function remoteMcpWrites(input: RemoteMcpCommand) {
  return (
    (input.part === 'threads' || input.part === 'automations') &&
    ['create', 'send', 'stop', 'resume', 'run', 'cancel'].includes(input.command.action)
  )
}

export function remoteMcpAdmits(input: {
  active: boolean
  boundResource: boolean
  boundInstallation: boolean
  hostEnabled: boolean
  allowsWrite: boolean
  writes: boolean
}) {
  const { active, boundResource, boundInstallation, hostEnabled, allowsWrite, writes } = input
  return active && boundResource && boundInstallation && hostEnabled && (!writes || allowsWrite)
}

export const remoteMcpOfferSchema = mutableStruct({ id })
export const remoteMcpClaimSchema = mutableStruct({
  id,
  grantId: id,
  access: remoteMcpAccessSchema,
  input: remoteMcpCommandSchema,
})
export type RemoteMcpClaim = typeof remoteMcpClaimSchema.Type

export const remoteMcpReplySchema = Schema.Union([
  mutableStruct({ id, ok: Schema.Literal(true), result: Schema.Unknown }),
  mutableStruct({ id, ok: Schema.Literal(false), error: maxValue(Schema.String, 1000) }),
])
