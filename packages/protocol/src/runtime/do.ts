import { Schema } from 'effect'
import {
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  strictStruct,
  superRefine,
  uuidSchema,
} from '../shared/schema.js'
import { executionSchema, linkedCheckoutsSchema } from '../workspace.js'

/**
 * Experimental Do: a runtime-owned run of a saved goal and an explicit, user-authored work-item
 * plan. Enabled per runtime with the `enableDo` preference (off by default); snapshots report it
 * as `doEnabled`.
 *
 * Turning Do off never hides or strands existing work. `list`, `read`, `cancel`, `complete` and
 * `delete` keep working, and the runtime keeps observing and stopping threads it already owns.
 * Only `save`, `start`, `retry`, `discover` and new dispatches require it on; affected items
 * report `blocked`. A paired computer with Do off still answers `inspect` and `stop`.
 *
 * Paired-client API. Every endpoint is `POST /api/do/<operation>` with a JSON body, authenticated
 * with the client's paired device token. Agent run tokens are rejected. Errors use the normal
 * runtime error reply (`RuntimeRequestError` status + message): 400 invalid input, 403 disabled,
 * 404 unknown run, 409 revision or state conflict, 503 paired computer unavailable.
 *
 * - `list`     {} → `doListReplySchema`. Newest first, bounded to `DO_LIMITS.runs`.
 * - `read`     `doReadRequestSchema` → `doRunReplySchema`.
 * - `save`     `doSaveRequestSchema` → `doRunReplySchema`. Creates a draft with a client-generated
 *              UUID when `expectedRevision` is omitted; an identical retry returns the stored draft.
 *              Updating requires the current `revision`. Only drafts can be edited.
 * - `start`    `doStartRequestSchema` → `doRunReplySchema`. A human approves exactly the reviewed
 *              plan: `expectedRevision` must match. Retrying a start of that revision is a no-op.
 * - `cancel`   `doReadRequestSchema` → `doRunReplySchema`. Stops only threads this run created.
 *              The run stays `cancelling` until every stop is confirmed; unconfirmed remote stops
 *              keep their item `cancelling` with a `blockedReason`. Never reports a run
 *              `cancelled` while any owned thread may still be working.
 * - `retry`    `doRetryRequestSchema` → `doRunReplySchema`. Retries failed, blocked or cancelled
 *              items (all of them when `itemIds` is omitted). The item's original thread is
 *              inspected and reused with a new follow-up message; a new thread is only created
 *              when the original no longer exists. Completed items are never rerun.
 * - `complete` `doCompleteRequestSchema` → `doRunReplySchema`. Final human review of a run in
 *              `review`; records the decision. Nothing is merged or published.
 * - `delete`   `doDeleteRequestSchema` → `{ ok: true }`. Drafts and finished runs only. Owned
 *              threads are kept.
 * - `discover` `doDiscoverRequestSchema` → `doDiscoverReplySchema`. Computers, projects and
 *              agents usable as targets. Paired computers are only listed while Studio on this
 *              computer is connected and their runtime ID is known or verifiable; there are no
 *              separate Do credentials.
 *
 * Runtime-to-runtime work items use `POST /api/do/remote/<operation>` on the paired target with
 * the paired device token Studio registered on the origin runtime. Dispatch is idempotent per
 * `key` and `messageId`, so a lost reply never creates a second thread or message. When the
 * paired computer is not registered (Studio closed on this computer) or unreachable, discovery
 * returns 503 and work items report `blocked` with a `blockedReason`.
 */

export const DO_LIMITS = {
  runs: 200,
  items: 32,
  maxConcurrency: 8,
  defaultConcurrency: 2,
  title: 200,
  goal: 16000,
  instructions: 16000,
  /** Agent-reported result excerpt kept per item. */
  summary: 4000,
  /** Upstream result excerpt included per dependency, and in total, in dependent instructions. */
  upstreamSummary: 2000,
  upstreamContext: 8000,
  note: 4000,
  reason: 1000,
  /** Complete dispatched message: instructions, a goal excerpt, upstream context and framing. */
  prompt: 30000,
} as const

const id = maxValue(minValue(Schema.String, 1), 200)
const text = (limit: number) => maxValue(Schema.String, limit)
const nonEmpty = (limit: number) =>
  maxValue(minValue(Schema.String, 1), limit).pipe(Schema.check(Schema.isPattern(/\S/)))
const count = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)

/** Plan-local item IDs, referenced by `dependsOn`. */
export const doItemIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
)
/**
 * `local` is the runtime that owns the run. A paired computer is identified by its own runtime ID
 * (as reported by its `/health`), never by a client's saved-connection profile ID, so a plan
 * saved from one client stays valid from another. Saving the owning runtime's own ID stores
 * `local`. Other IDs come from `discover`.
 */
export const doRuntimeIdSchema = id

export const doTargetSchema = mutableStruct({
  runtimeId: doRuntimeIdSchema,
  repositoryId: id,
  /** Configured agent on the target runtime; omitted uses the project's default agent. */
  agentId: Schema.optional(id),
  /**
   * Only `worktree` items run in parallel. Others share the project's checkout, so the runtime
   * dispatches at most one of them per computer and project at a time.
   */
  execution: Schema.optional(executionSchema),
  linkedCheckouts: Schema.optional(linkedCheckoutsSchema),
})
export type DoTarget = typeof doTargetSchema.Type

export const doPlanItemSchema = mutableStruct({
  id: doItemIdSchema,
  title: nonEmpty(DO_LIMITS.title),
  instructions: nonEmpty(DO_LIMITS.instructions),
  dependsOn: maxValue(mutableArray(doItemIdSchema), DO_LIMITS.items),
  target: doTargetSchema,
})
export type DoPlanItem = typeof doPlanItemSchema.Type

export const doConcurrencySchema = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: DO_LIMITS.maxConcurrency })),
)

/** Unique IDs, known dependencies and no cycles. */
export function doPlanIssues(items: readonly Pick<DoPlanItem, 'id' | 'dependsOn'>[]) {
  const issues: { message: string; path: PropertyKey[] }[] = []
  const ids = new Map<string, number>()
  items.forEach((item, index) => {
    if (ids.has(item.id))
      issues.push({ message: `Duplicate item ID ${item.id}`, path: [index, 'id'] })
    else ids.set(item.id, index)
  })
  items.forEach((item, index) => {
    if (new Set(item.dependsOn).size !== item.dependsOn.length)
      issues.push({ message: 'Dependencies must be unique', path: [index, 'dependsOn'] })
    for (const dependency of item.dependsOn) {
      if (dependency === item.id)
        issues.push({ message: 'An item cannot depend on itself', path: [index, 'dependsOn'] })
      else if (!ids.has(dependency))
        issues.push({ message: `Unknown dependency ${dependency}`, path: [index, 'dependsOn'] })
    }
  })
  if (issues.length) return issues
  const state = new Map<string, 'visiting' | 'done'>()
  const byId = new Map(items.map((item) => [item.id, item]))
  const visit = (itemId: string): boolean => {
    const current = state.get(itemId)
    if (current === 'done') return false
    if (current === 'visiting') return true
    state.set(itemId, 'visiting')
    const cyclic = (byId.get(itemId)?.dependsOn ?? []).some(visit)
    state.set(itemId, 'done')
    return cyclic
  }
  items.forEach((item, index) => {
    if (!state.has(item.id) && visit(item.id))
      issues.push({ message: 'Dependencies cannot form a cycle', path: [index, 'dependsOn'] })
  })
  return issues
}

export const doPlanItemsSchema = superRefine(
  maxValue(minValue(mutableArray(doPlanItemSchema), 1), DO_LIMITS.items),
  (items, context) => {
    for (const issue of doPlanIssues(items)) context.addIssue({ code: 'custom', ...issue })
  },
)

/**
 * - `draft`: saved and editable; nothing has run.
 * - `running`: dispatching ready items within `maxConcurrency`.
 * - `attention`: no item can progress without a human (failed or blocked items). Retry or cancel.
 * - `cancelling`: stops requested; waiting for every owned thread to confirm.
 * - `cancelled`: every owned thread confirmed stopped, or never started.
 * - `review`: every item completed; awaiting the final human review.
 * - `completed`: a human recorded the final review decision.
 */
export const doRunStatusSchema = Schema.Literals([
  'draft',
  'running',
  'attention',
  'cancelling',
  'cancelled',
  'review',
  'completed',
])
export type DoRunStatus = typeof doRunStatusSchema.Type

/**
 * - `pending`: waiting for dependencies or a concurrency slot.
 * - `dispatching`: intent persisted; thread creation or message delivery not yet confirmed.
 *   Reconciliation repeats the idempotent dispatch, so it never duplicates the thread.
 * - `running`: the owned thread accepted this attempt's message and is working.
 * - `waiting`: the thread needs a human (native approval, question or paused queue). Answer it
 *   from the normal thread link.
 * - `blocked`: cannot dispatch or observe now (computer offline, Do disabled there, project or
 *   agent missing). Dispatch resumes automatically when the cause clears; see `blockedReason`.
 * - `completed`, `failed`: the attempt finished. Failed items block dependents until retried.
 * - `cancelling`: stop requested but not confirmed.
 * - `cancelled`: stopped, or cancelled before it started.
 */
export const doItemStatusSchema = Schema.Literals([
  'pending',
  'dispatching',
  'running',
  'waiting',
  'blocked',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
])
export type DoItemStatus = typeof doItemStatusSchema.Type

/**
 * Bounded excerpt of the thread's final agent message. It is agent-reported and unverified, not
 * extracted evidence. `branch` is the checkout branch recorded when the thread finished, when
 * there is one; it may not contain uncommitted changes. Do never copies, commits, pushes or
 * merges files between checkouts or computers: dependent items are told to inspect upstream
 * files or commits themselves, or to ask the human.
 */
export const doItemResultSchema = mutableStruct({
  summary: text(DO_LIMITS.summary),
  source: Schema.Literal('agent-message'),
  truncated: Schema.Boolean,
  branch: Schema.optional(text(300)),
})
export type DoItemResult = typeof doItemResultSchema.Type

/** Runtime-owned item state. Clients never send it. */
export const doItemStateSchema = mutableStruct({
  status: doItemStatusSchema,
  /** Increments on every dispatch attempt, including retries that reuse the thread. */
  attempt: count,
  /** Thread on `target.runtimeId`; open it through that runtime's normal thread link. */
  taskId: Schema.optional(id),
  attention: Schema.optional(Schema.Literals(['approval', 'question', 'paused'])),
  blockedReason: Schema.optional(text(DO_LIMITS.reason)),
  /** Failure of the latest attempt; kept on retried items until the next attempt runs. */
  error: Schema.optional(text(DO_LIMITS.reason)),
  result: Schema.optional(doItemResultSchema),
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
  updatedAt: Schema.String,
})
export type DoItemState = typeof doItemStateSchema.Type

export const doItemSchema = mutableStruct({
  ...doPlanItemSchema.fields,
  state: doItemStateSchema,
})
export type DoItem = typeof doItemSchema.Type

export const doReviewSchema = mutableStruct({
  decision: Schema.Literals(['accepted', 'rejected']),
  note: Schema.optional(text(DO_LIMITS.note)),
  reviewedAt: Schema.String,
})

export const doRunSchema = mutableStruct({
  id: uuidSchema,
  /** Plan revision. Changes on every save; runtime state updates keep it. */
  revision: uuidSchema,
  title: nonEmpty(DO_LIMITS.title),
  goal: nonEmpty(DO_LIMITS.goal),
  maxConcurrency: doConcurrencySchema,
  status: doRunStatusSchema,
  items: mutableArray(doItemSchema),
  review: Schema.optional(doReviewSchema),
  error: Schema.optional(text(DO_LIMITS.reason)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
})
export type DoRun = typeof doRunSchema.Type

export const doRunSummarySchema = mutableStruct({
  id: uuidSchema,
  revision: uuidSchema,
  title: Schema.String,
  status: doRunStatusSchema,
  items: Schema.Record(doItemStatusSchema, count),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type DoRunSummary = typeof doRunSummarySchema.Type

export const doListReplySchema = mutableStruct({ runs: mutableArray(doRunSummarySchema) })
export const doRunReplySchema = mutableStruct({ run: doRunSchema })

export const doReadRequestSchema = strictStruct({ id: uuidSchema })
export const doSaveRequestSchema = strictStruct({
  id: uuidSchema,
  /** Omit to create; otherwise the current plan revision. */
  expectedRevision: Schema.optional(uuidSchema),
  title: doRunSchema.fields.title,
  goal: doRunSchema.fields.goal,
  maxConcurrency: Schema.optional(doConcurrencySchema),
  items: doPlanItemsSchema,
})
export type DoSaveRequest = typeof doSaveRequestSchema.Type
export const doStartRequestSchema = strictStruct({ id: uuidSchema, expectedRevision: uuidSchema })
export const doRetryRequestSchema = strictStruct({
  id: uuidSchema,
  itemIds: Schema.optional(maxValue(minValue(mutableArray(doItemIdSchema), 1), DO_LIMITS.items)),
})
export const doCompleteRequestSchema = strictStruct({
  id: uuidSchema,
  decision: doReviewSchema.fields.decision,
  note: Schema.optional(text(DO_LIMITS.note)),
})
export const doDeleteRequestSchema = strictStruct({ id: uuidSchema, expectedRevision: uuidSchema })

export const doDiscoverRequestSchema = strictStruct({
  /** Omit or `local` for this runtime; a paired computer ID reads its projects and agents. */
  runtimeId: Schema.optional(doRuntimeIdSchema),
  /** Lists the agents available to this project, including project-scoped agents. */
  repositoryId: Schema.optional(id),
})
export const doComputerSchema = mutableStruct({
  /** `local`, or the paired computer's own runtime ID. */
  id: doRuntimeIdSchema,
  name: Schema.String,
  local: Schema.Boolean,
})
export const doDiscoverReplySchema = mutableStruct({
  runtimeId: doRuntimeIdSchema,
  /** Present for local discovery. Paired computers require Studio connected on this computer. */
  computers: Schema.optional(mutableArray(doComputerSchema)),
  projects: mutableArray(mutableStruct({ id: Schema.String, name: Schema.String })),
  agents: mutableArray(
    mutableStruct({
      id: Schema.String,
      name: Schema.String,
      provider: Schema.String,
    }),
  ),
})
export type DoDiscoverReply = typeof doDiscoverReplySchema.Type

/**
 * Runtime-to-runtime work item operations, `POST /api/do/remote/<operation>`.
 *
 * - `dispatch`: ensure the thread owned by `key` exists (creating it at most once) and that the
 *   message `messageId` was accepted. Re-sending the same `messageId` after a lost reply or a
 *   restart is safe and never creates a second thread or message. Retries reuse the thread with a
 *   new `messageId`. A deleted thread is only recreated for a new `messageId` (a human retry);
 *   re-sending the attempt during which it was deleted reports `failed`. Requires `enableDo` on
 *   the target.
 * - `inspect`: observe owned threads by key. Unknown keys are reported as `missing`.
 * - `stop`: stop owned threads by key and remove the attempt's undelivered message. `confirmed`
 *   means nothing of the thread is still working. Dispatching a stopped attempt returns 409.
 *
 * Every request names the target's own `runtimeId`; a target with another ID rejects it with
 * 409, so a reused address never receives another runtime's work. Keys begin with the origin
 * runtime ID (`<origin>:<run>:<item>`) and are namespaced by it, separately from the target's own
 * Do threads. Any paired device of the target may operate them: paired devices already have
 * full thread access there, and binding keys to one device would strand work after re-pairing
 * or when another Studio client on the origin computer registers the peer.
 */
export const doRemoteKeySchema = maxValue(
  Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]+:[A-Za-z0-9:_-]+$/))),
  300,
)
export const doRemoteDispatchRequestSchema = strictStruct({
  runtimeId: doRuntimeIdSchema,
  key: doRemoteKeySchema,
  messageId: id,
  title: doPlanItemSchema.fields.title,
  /** Complete message for this attempt, including bounded upstream context. */
  text: nonEmpty(DO_LIMITS.prompt),
  repositoryId: id,
  agentId: Schema.optional(id),
  execution: Schema.optional(executionSchema),
  linkedCheckouts: Schema.optional(linkedCheckoutsSchema),
})
export type DoRemoteDispatchRequest = typeof doRemoteDispatchRequestSchema.Type
export const doRemoteInspectRequestSchema = strictStruct({
  runtimeId: doRuntimeIdSchema,
  keys: maxValue(minValue(mutableArray(doRemoteKeySchema), 1), DO_LIMITS.items),
})
/**
 * `messageId` is the cancelled attempt. It is recorded even when the key has no thread yet, so a
 * dispatch of that attempt still in flight is rejected instead of starting after the stop.
 */
export const doRemoteStopRequestSchema = strictStruct({
  runtimeId: doRuntimeIdSchema,
  stops: maxValue(
    minValue(mutableArray(strictStruct({ key: doRemoteKeySchema, messageId: id })), 1),
    DO_LIMITS.items,
  ),
})

/** Observed thread state for one key and message. */
export const doThreadObservationSchema = mutableStruct({
  key: doRemoteKeySchema,
  /**
   * - `missing`: no thread for this key (never created, or deleted), or no message accepted yet.
   * - `queued`: the message is accepted but not delivered yet.
   * - `working`: an agent in the thread family is running.
   * - `waiting`: a native approval, question or paused queue needs a human.
   * - `finished` / `failed`: idle after delivery, with or without an error.
   */
  status: Schema.Literals(['missing', 'queued', 'working', 'waiting', 'finished', 'failed']),
  taskId: Schema.optional(id),
  /** Last message ID this key's thread accepted. */
  messageId: Schema.optional(id),
  attention: doItemStateSchema.fields.attention,
  error: Schema.optional(text(DO_LIMITS.reason)),
  result: Schema.optional(doItemResultSchema),
})
export type DoThreadObservation = typeof doThreadObservationSchema.Type
export const doRemoteDispatchReplySchema = mutableStruct({
  observation: doThreadObservationSchema,
  created: Schema.Boolean,
})
export const doRemoteInspectReplySchema = mutableStruct({
  observations: mutableArray(doThreadObservationSchema),
})
export const doRemoteStopReplySchema = mutableStruct({
  stops: mutableArray(
    mutableStruct({
      key: doRemoteKeySchema,
      /** `confirmed`: idle or missing. `requested`: stop sent, still shutting down. */
      stop: Schema.Literals(['confirmed', 'requested']),
    }),
  ),
})
