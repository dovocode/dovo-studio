import { Schema } from 'effect'
import {
  isoDateTime,
  mutableArray,
  maxValue,
  minValue,
  mutableStruct,
  strictStruct,
} from '../shared/schema.js'

import { githubTriggerSchema } from '../automation/triggers.js'

const id = maxValue(minValue(Schema.String, 1), 200)
const provider = Schema.Literals([
  'codex',
  'opencode',
  'claude',
  'vibe',
  'hermes',
  'copilot',
  'grok',
  'muse',
  'cursor',
  'pi',
  'acp',
])

/** Saved workflow instructions and graph. Agent configuration stays in effective resources. */
export const automationReviewWorkflowSchema = mutableStruct({
  id,
  name: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  nodes: maxValue(
    mutableArray(
      mutableStruct({
        id,
        type: Schema.Literal('automation'),
        position: mutableStruct({ x: Schema.Number, y: Schema.Number }),
        data: mutableStruct({
          kind: Schema.Literals(['trigger', 'task', 'review']),
          label: Schema.String,
          trigger: Schema.Literals(['manual', 'schedule', 'once', 'webhook', 'github']),
          schedule: Schema.String,
          timezone: Schema.String,
          runAt: Schema.optional(Schema.String),
          objective: Schema.String,
          github: Schema.optional(githubTriggerSchema),
        }),
      }),
    ),
    100,
  ),
  edges: maxValue(mutableArray(mutableStruct({ id, source: id, target: id })), 1000),
})
export type AutomationReviewWorkflow = Schema.Schema.Type<typeof automationReviewWorkflowSchema>

/** A bounded, public review. Private Bot instructions and credentials never enter this data. */
export const automationActionSchema = mutableStruct({
  automationId: id,
  revision: id,
  workflow: automationReviewWorkflowSchema,
  resources: maxValue(
    mutableArray(
      mutableStruct({
        nodeId: id,
        label: Schema.String,
        botId: Schema.optional(id),
        botName: Schema.optional(Schema.String),
        repositoryId: id,
        repositoryName: Schema.String,
        execution: Schema.optional(Schema.Literals(['main', 'worktree'])),
        projects: maxValue(
          mutableArray(
            mutableStruct({
              id,
              name: Schema.String,
              path: Schema.optional(Schema.String),
            }),
          ),
          13,
        ),
        agent: mutableStruct({
          name: Schema.optional(Schema.String),
          provider,
          model: Schema.String,
          /** Pending first-turn selection. The concrete model is chosen when the run starts. */
          modelSelection: Schema.optional(Schema.Literals(['inherit', 'auto', 'smart'])),
          reasoning: Schema.optional(Schema.String),
          permission: Schema.Literals([
            'read-only',
            'ask',
            'workspace-write',
            'auto',
            'full-access',
          ]),
          approvalPolicy: Schema.optional(
            Schema.Literals(['untrusted', 'on-failure', 'on-request', 'never']),
          ),
          sandboxMode: Schema.optional(
            Schema.Literals(['read-only', 'workspace-write', 'danger-full-access']),
          ),
        }),
      }),
    ),
    100,
  ),
})

export type AutomationAction = Schema.Schema.Type<typeof automationActionSchema>

/** What an agent proposes. The person sending the action can change all of it. */
export const threadActionSuggestionSchema = mutableStruct({
  provider: Schema.optional(provider),
  model: Schema.optional(maxValue(minValue(Schema.String, 1), 500)),
  reasoning: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  agentId: Schema.optional(id),
})
export type ThreadActionSuggestion = Schema.Schema.Type<typeof threadActionSuggestionSchema>

/** A prepared "start a new agent thread" action. An agent creates it with the dovo_task
 * `thread_prepare` tool; nothing runs until a person reviews it and taps Send from a paired
 * client. Runtime-owned: workspace create/PATCH cannot add or change it. */
export const threadActionSchema = mutableStruct({
  /** Stable across retries of the same `key` in the same thread. */
  id,
  /** The agent's stable key. Preparing the same key again replaces the unsent action. */
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String, 1), 120),
  prompt: maxValue(minValue(Schema.String, 1), 20000),
  suggestion: Schema.optional(threadActionSuggestionSchema),
  automation: Schema.optional(automationActionSchema),
  /** The run that prepared it. Clients show the card after the last message with this
   * `turnId`, or at the end of the thread when no such message exists. */
  runId: id,
  state: Schema.Literals(['prepared', 'sent', 'dismissed']),
  createdAt: isoDateTime(Schema.String),
  updatedAt: isoDateTime(Schema.String),
  /** Set once, in the same transaction that creates the automation run. */
  automationSent: Schema.optional(mutableStruct({ runId: id, sentAt: isoDateTime(Schema.String) })),
  /** Set once, in the same transaction that creates the new thread. */
  sent: Schema.optional(
    mutableStruct({
      taskId: id,
      messageId: id,
      sentAt: isoDateTime(Schema.String),
    }),
  ),
})
export type ThreadAction = Schema.Schema.Type<typeof threadActionSchema>
export const maxThreadActions = 20

/** `thread_prepare` tool input. Run credentials only; the runtime binds it to the run's thread. */
export const threadPrepareCommandSchema = strictStruct({
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120),
  prompt: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
  ...threadActionSuggestionSchema.fields,
})
export type ThreadPrepareCommand = Schema.Schema.Type<typeof threadPrepareCommandSchema>

/** Prepares a review of one existing automation. Preparation never starts work. */
export const automationPrepareCommandFields = {
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120),
  automationId: id,
  prompt: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000),
}
export const automationPrepareCommandSchema = strictStruct(automationPrepareCommandFields)
export type AutomationPrepareCommand = Schema.Schema.Type<typeof automationPrepareCommandSchema>

/** Safe workflow discovery through the regular run-bound MCP bridge. */
export const automationListPageSize = 100
export const automationListNameLength = 200
/** UTF-8 JSON response bytes, including the continuation cursor. */
export const automationListByteBudget = 32 * 1024
export const automationListCommandFields = {
  limit: Schema.optional(maxValue(minValue(Schema.Int, 1), automationListPageSize)),
  cursor: Schema.optional(id),
}
export const automationListCommandSchema = strictStruct(automationListCommandFields)
export const automationListResultSchema = mutableStruct({
  automations: maxValue(
    mutableArray(
      mutableStruct({
        id,
        name: maxValue(Schema.String, automationListNameLength),
        enabled: Schema.Boolean,
      }),
    ),
    automationListPageSize,
  ),
  nextCursor: Schema.optional(id),
})
export type AutomationListResult = Schema.Schema.Type<typeof automationListResultSchema>
