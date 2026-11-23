import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct } from '../shared/schema.js'

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
export const remoteMcpCommandSchema = Schema.Union([
  mutableStruct({ part: Schema.Literal('discover'), command: remoteMcpDiscoverSchema }),
  mutableStruct({ part: Schema.Literal('threads'), command: remoteMcpThreadsSchema }),
  mutableStruct({ part: Schema.Literal('automations'), command: remoteMcpAutomationsSchema }),
])
export type RemoteMcpCommand = typeof remoteMcpCommandSchema.Type

export const remoteMcpAccessSchema = Schema.Literals(['read', 'run'])
export type RemoteMcpAccess = typeof remoteMcpAccessSchema.Type

export function remoteMcpWrites(input: RemoteMcpCommand) {
  return (
    input.part !== 'discover' &&
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
