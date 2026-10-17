import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  strictStruct,
  uuidSchema,
} from '../shared/schema.js'
import {
  doDiscoverReplySchema,
  doRunSchema,
  doRuntimeIdSchema,
  doRunSummarySchema,
  doSaveRequestSchema,
} from './do.js'

/**
 * Experimental Do chat: an ordinary conversation thread whose agent turns a user's goal into a
 * Do plan proposal. Requires `enableDo`, like the rest of Do.
 *
 * Paired-client API (paired device token; agent run tokens are rejected):
 * - `POST /api/do/chat/create` `doChatCreateRequestSchema` → `doChatCreateReplySchema`. Creates a
 *   normal thread with origin `DO_CHAT_ORIGIN` on the configured agent and delivers the first
 *   message through the normal queue. Idempotent per `id`: a retry with the same input returns
 *   the same `taskId` and never delivers the message twice; different input for a known `id` is
 *   409. Clients then open `taskId` as a normal conversation and reply through the normal send API.
 *
 * Coordinator agent tool `do_plan` (agent run token; parent turn scope enforced):
 * `POST /api/do/agent` `doAgentCommandSchema` → `doAgentReplySchema`. Only Do chat threads may use
 * it, and only for runs that thread proposed. It can discover targets, save or update a draft
 * proposal, list and read its own proposals, and cancel its own runs. It can never start, retry,
 * complete or delete a run: a human reviews the saved plan in Do and chooses Start.
 *
 * When a proposed run needs attention, waits for a human, finishes or is cancelled, the runtime
 * queues one notice per state change into the owning chat thread. Notices are durable and
 * idempotent; the agent never polls.
 */

export const DO_CHAT_ORIGIN = 'do-chat'

export const DO_CHAT_LIMITS = {
  message: 16000,
  /** Plans one chat thread can propose. */
  proposals: 20,
} as const

const id = maxValue(minValue(Schema.String, 1), 200)

export const doChatCreateRequestSchema = strictStruct({
  /** Client-generated request ID; retries reuse it. */
  id: uuidSchema,
  /** Omitted: the "No project" scratch workspace. Do targets are chosen in the plan, not here. */
  repositoryId: Schema.optional(id),
  /** Configured agent that coordinates; omitted uses the project's default agent. */
  agentId: Schema.optional(id),
  text: maxValue(minValue(Schema.String, 1), DO_CHAT_LIMITS.message).pipe(
    Schema.check(Schema.isPattern(/\S/)),
  ),
})
export type DoChatCreateRequest = typeof doChatCreateRequestSchema.Type
export const doChatCreateReplySchema = mutableStruct({ taskId: id })
export type DoChatCreateReply = typeof doChatCreateReplySchema.Type

/**
 * - `discover`: computers, projects and agents usable as targets (`doDiscoverReplySchema`).
 * - `propose`: save a draft. A new `plan.id` (client UUID, no `expectedRevision`) becomes owned by
 *   the calling thread; updates require the current `expectedRevision` and only apply to drafts.
 * - `list` / `read`: this thread's proposals only. Unknown or foreign IDs are 404.
 * - `cancel`: stops this thread's run, including one a human started.
 */
export const doAgentActionSchema = Schema.Union([
  strictStruct({
    action: Schema.Literal('discover'),
    /** Omit or `local` for this runtime; a paired computer ID reads its projects and agents. */
    runtimeId: Schema.optional(doRuntimeIdSchema),
    /** Lists the agents available to this project, including project-scoped agents. */
    repositoryId: Schema.optional(id),
  }),
  strictStruct({ action: Schema.Literal('propose'), plan: doSaveRequestSchema }),
  strictStruct({ action: Schema.Literal('list') }),
  strictStruct({ action: Schema.Literal('read'), id: uuidSchema }),
  strictStruct({ action: Schema.Literal('cancel'), id: uuidSchema }),
])
export type DoAgentAction = typeof doAgentActionSchema.Type
export const doAgentCommandSchema = strictStruct({
  taskId: id,
  parentRunId: id,
  command: doAgentActionSchema,
})
export type DoAgentCommand = typeof doAgentCommandSchema.Type

export const doAgentReplySchema = Schema.Union([
  doDiscoverReplySchema,
  mutableStruct({ runs: mutableArray(doRunSummarySchema) }),
  mutableStruct({ run: doRunSchema }),
])
export type DoAgentReply = typeof doAgentReplySchema.Type
