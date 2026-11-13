import { routinePolicySchema, routineMonitorSchema } from '../automation/routine-policy.js'
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
const actionText = maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 20000)

/** Native response buttons carry plain data. They never contain executable UI code. */
export const responseOperationSchema = Schema.Union([
  strictStruct({ kind: Schema.Literal('prompt'), prompt: actionText }),
  strictStruct({ kind: Schema.Literal('command'), command: actionText }),
  strictStruct({
    kind: Schema.Literal('mcp'),
    server: id,
    tool: id,
    arguments: Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
  }),
])
export type ResponseOperation = typeof responseOperationSchema.Type
export const responseDispatchSchema = strictStruct({
  actionId: id,
  values: Schema.Record(Schema.String, Schema.mutableKey(maxValue(Schema.String, 4000))),
})
export type ResponseDispatch = typeof responseDispatchSchema.Type
export const responseFormFieldSchema = mutableStruct({
  id,
  label: maxValue(minValue(Schema.String, 1), 120),
  type: Schema.Literals(['text', 'multiline', 'choice']),
  required: Schema.optional(Schema.Boolean),
  value: Schema.optional(maxValue(Schema.String, 4000)),
  options: Schema.optional(
    maxValue(
      mutableArray(
        mutableStruct({
          value: maxValue(minValue(Schema.String, 1), 200),
          label: maxValue(minValue(Schema.String, 1), 120),
        }),
      ),
      20,
    ),
  ),
})
export const responseActionSchema = Schema.Union([
  responseOperationSchema,
  strictStruct({
    kind: Schema.Literal('form'),
    description: maxValue(Schema.String, 2000),
    fields: maxValue(mutableArray(responseFormFieldSchema), 20),
    actions: maxValue(
      minValue(
        mutableArray(
          mutableStruct({
            id,
            title: maxValue(minValue(Schema.String, 1), 120),
            action: responseOperationSchema,
          }),
        ),
        1,
      ),
      8,
    ),
  }),
])
export type ResponseAction = typeof responseActionSchema.Type
export function responseFormDefaults(action: ResponseAction): Record<string, string> {
  return action.kind === 'form'
    ? Object.fromEntries(action.fields.map((field) => [field.id, field.value ?? '']))
    : {}
}
/** Substitute only declared values into plain strings. The resolved action still needs review. */
export function resolveResponseAction(
  action: ResponseAction,
  dispatch?: ResponseDispatch,
): ResponseOperation {
  if (action.kind !== 'form') {
    if (dispatch) throw Error('This action has no form.')
    return action
  }
  if (!dispatch) throw Error('Complete the action form first.')
  if (
    new Set(action.fields.map((field) => field.id)).size !== action.fields.length ||
    new Set(action.actions.map((item) => item.id)).size !== action.actions.length
  )
    throw Error('Form field and action IDs must be unique.')
  const selected = action.actions.find((item) => item.id === dispatch.actionId)
  if (!selected) throw Error('Choose an available form action.')
  if (Object.keys(dispatch.values).some((key) => !action.fields.some((field) => field.id === key)))
    throw Error('The form contains an unknown field.')
  const values = Object.fromEntries(
    action.fields.map((field) => {
      const value = dispatch.values[field.id] ?? field.value ?? ''
      if (value.length > 4000 || (field.required && !value.trim()))
        throw Error(`Complete ${field.label}.`)
      if (
        field.type === 'choice' &&
        value &&
        !field.options?.some((option) => option.value === value)
      )
        throw Error(`Choose a valid option for ${field.label}.`)
      return [field.id, value]
    }),
  )
  const replace = (text: string) =>
    text.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
      if (!Object.hasOwn(values, key)) throw Error(`Unknown form field: ${key}`)
      return values[key]
    })
  const map = (value: unknown): unknown => {
    if (typeof value === 'string') return replace(value)
    if (Array.isArray(value)) return value.map(map)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item)]))
    return value
  }
  const operation = selected.action
  if (operation.kind === 'prompt') return { ...operation, prompt: replace(operation.prompt) }
  if (operation.kind === 'command') return { ...operation, command: replace(operation.command) }
  return {
    ...operation,
    arguments: Object.fromEntries(
      Object.entries(operation.arguments).map(([key, value]) => [key, map(value)]),
    ),
  }
}

export const responseActionReviewSchema = mutableStruct({
  revision: id,
  dispatch: Schema.optional(responseDispatchSchema),
  resolved: responseOperationSchema,
  directory: Schema.String,
  description: maxValue(Schema.String, 4000),
})
export const responsePrepareCommandFields = {
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120),
  action: responseActionSchema,
}
export const responsePrepareCommandSchema = strictStruct(responsePrepareCommandFields)
export function responseActionText(action: ResponseAction) {
  return action.kind === 'prompt'
    ? action.prompt
    : action.kind === 'command'
      ? action.command
      : action.kind === 'form'
        ? action.description.trim() || 'Open action form'
        : `${action.server} · ${action.tool}\n${JSON.stringify(action.arguments)}`
}
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
  policy: Schema.optional(routinePolicySchema),
  monitor: Schema.optional(routineMonitorSchema),
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

/** A native card prepared by an agent. A paired human reviews it before Send/Run.
 * Runtime-owned: workspace create/PATCH cannot add or change it. Cards without
 * `automation` or `response` start a new thread, including older runtimes’ cards. */
export const threadActionSchema = mutableStruct({
  /** Stable across retries of the same `key` in the same thread. */
  id,
  /** The agent's stable key. Preparing the same key again replaces the unsent action. */
  key: maxValue(minValue(Schema.String, 1), 120),
  title: maxValue(minValue(Schema.String, 1), 120),
  prompt: maxValue(minValue(Schema.String, 1), 20000),
  suggestion: Schema.optional(threadActionSuggestionSchema),
  automation: Schema.optional(automationActionSchema),
  response: Schema.optional(responseActionSchema),
  responseReview: Schema.optional(responseActionReviewSchema),
  responseResult: Schema.optional(
    mutableStruct({
      status: Schema.Literals(['running', 'completed', 'failed', 'started', 'uncertain']),
      output: maxValue(Schema.String, 12000),
      terminalId: Schema.optional(id),
    }),
  ),
  /** The run that prepared it. Clients show the card after the last message with this
   * `turnId`, or at the end of the thread when no such message exists. */
  runId: id,
  state: Schema.Literals(['prepared', 'sent', 'dismissed']),
  createdAt: isoDateTime(Schema.String),
  updatedAt: isoDateTime(Schema.String),
  /** Set once, in the same transaction that creates the automation run. */
  automationSent: Schema.optional(mutableStruct({ runId: id, sentAt: isoDateTime(Schema.String) })),
  /** Set with the accepted prompt, for a new thread or this same thread. */
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
