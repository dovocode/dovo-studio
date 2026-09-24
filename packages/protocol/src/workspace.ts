import { mutableArray, mutableStruct } from './schema.js'
import { minValue, maxValue, refine, urlSchema, isoDateTime } from './schema.js'
import { subagentSchema } from './subagents.js'
import { jiraBindingSchema, jiraSourceSchema, jiraIssueLinkSchema } from './jira.js'
import { taskWorkItemSchema } from './work-task.js'
import { resourceSettingsSchema } from './resources.js'
import { attachmentSchema, MAX_ATTACHMENTS } from './attachments.js'
import { Schema } from 'effect'
import { forgeBindingSchema, forgeProviderSchema } from './forges.js'
export const executionSchema = Schema.Literal('main', 'worktree')
export const providerSchema = Schema.Literal('codex', 'opencode', 'claude', 'acp')
export const agentIconSchema = Schema.Literal(
  'bot',
  'code',
  'wrench',
  'shield',
  'bug',
  'search',
  'rocket',
  'terminal',
  'pen',
  'brain',
  'flask',
)
export const agentSchema = mutableStruct({
  icon: Schema.optional(agentIconSchema),
  resources: Schema.optional(resourceSettingsSchema),
  id: Schema.String,
  name: minValue(Schema.String, 1),
  provider: providerSchema,
  model: Schema.String,
  reasoning: Schema.optional(maxValue(Schema.String, 100)),
  serviceTier: Schema.optional(maxValue(Schema.String, 100)),
  cyberAccessProgram: Schema.optional(Schema.Literal('standard', 'daybreakBlue', 'daybreakRed')),
  instructions: Schema.String,
  permission: Schema.Literal('ask', 'read-only', 'workspace-write', 'auto', 'full-access'),
  endpoint: Schema.String,
  args: Schema.optional(mutableArray(Schema.String)),
  acpInstallationId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  acpMode: Schema.optional(maxValue(Schema.String, 200)),
  acpConfig: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export const taskHarnessSchema = agentSchema.omit('id', 'name', 'icon')
export type TaskHarness = Schema.Schema.Type<typeof taskHarnessSchema>
export const repositorySchema = mutableStruct({
  forge: Schema.optional(forgeBindingSchema),
  jira: Schema.optional(jiraBindingSchema),
  resources: Schema.optional(resourceSettingsSchema),
  id: Schema.String,
  name: minValue(Schema.String, 1),
  path: minValue(Schema.String, 1),
  branch: Schema.String,
})
export const fileSchema = mutableStruct({
  path: Schema.String,
  before: Schema.String,
  after: Schema.String,
  viewed: Schema.Boolean,
  diskContents: Schema.optional(Schema.String),
})
export const diffCommentSchema = mutableStruct({
  side: Schema.Literal('additions', 'deletions'),
  start: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  end: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  excerpt: Schema.String,
  body: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 10000),
})
export const taskFeedbackSchema = refine(
  mutableStruct({
    ...diffCommentSchema.fields,
    ...{
      id: minValue(Schema.String, 1),
      path: minValue(Schema.String, 1),
    },
  }),
  (v) => v.end >= v.start,
  'Invalid line range',
)
export const messageSchema = mutableStruct({
  id: Schema.String,
  role: Schema.Literal('user', 'assistant'),
  text: Schema.String,
  file: Schema.optional(Schema.String),
  attachments: Schema.optional(maxValue(mutableArray(attachmentSchema), MAX_ATTACHMENTS)),
  diffComment: Schema.optional(diffCommentSchema),
  createdAt: Schema.optional(Schema.String),
})
export const taskPullSchema = mutableStruct({
  provider: Schema.optional(forgeProviderSchema),
  connectionId: Schema.optional(Schema.String),
  headRef: Schema.optional(Schema.String),
  cloneUrl: Schema.optional(
    urlSchema({
      protocol: /^https?$/,
    }),
  ),
  number: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  url: urlSchema({
    protocol: /^https?$/,
  }),
  repositoryUrl: urlSchema({
    protocol: /^https?$/,
  }),
  headSha: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40}$/)),
  baseSha: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40}$/)),
})
export const queuedMessageSchema = mutableStruct({
  ...messageSchema.fields,
  ...{
    role: Schema.Literal('user'),
    createdAt: Schema.String,
  },
})
export const turnCheckpointSchema = mutableStruct({
  before: Schema.String,
  after: Schema.optional(Schema.String),
  files: mutableArray(fileSchema),
  omitted: mutableArray(Schema.String),
  error: Schema.optional(Schema.String),
})
export const turnSchema = mutableStruct({
  runtimeHost: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  id: Schema.String,
  assistantId: Schema.String,
  checkpoint: Schema.optional(turnCheckpointSchema),
  agentId: Schema.String,
  provider: providerSchema,
  model: Schema.String,
  reasoning: Schema.optional(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  status: Schema.Literal('running', 'completed', 'failed', 'cancelled'),
  error: Schema.optional(Schema.String),
})
export const taskModelSchema = mutableStruct({
  acpInstallationId: Schema.optional(Schema.NullOr(agentSchema.fields.acpInstallationId.from)),
  acpMode: agentSchema.fields.acpMode,
  acpConfig: agentSchema.fields.acpConfig,
  model: Schema.optional(agentSchema.fields.model),
  reasoning: agentSchema.fields.reasoning,
  permission: Schema.optional(agentSchema.fields.permission),
  serviceTier: Schema.optional(Schema.NullOr(agentSchema.fields.serviceTier.from)),
  cyberAccessProgram: Schema.optional(Schema.NullOr(agentSchema.fields.cyberAccessProgram.from)),
})
export const taskSchema = mutableStruct({
  runPhase: Schema.optional(Schema.Literal('preparing', 'provider', 'finalizing')),
  // Admission is durable before checkout preparation; a session alone proves no delivery.
  runAttempt: Schema.optional(
    mutableStruct({ inputMessageIds: mutableArray(Schema.String), promptAccepted: Schema.Boolean }),
  ),
  checkoutBranch: Schema.optional(Schema.String),
  checkoutLocked: Schema.optional(Schema.Boolean),
  // Captured on the first submitted input; queued input keeps the lock after removal.
  providerLock: Schema.optional(providerSchema),
  id: Schema.String,
  title: minValue(Schema.String, 1),
  repositoryId: Schema.String,
  execution: Schema.optional(executionSchema),
  agentId: Schema.String,
  status: Schema.Literal('draft', 'running', 'review', 'done', 'failed', 'cancelled'),
  createdAt: Schema.String,
  messages: mutableArray(messageSchema),
  files: mutableArray(fileSchema),
  draft: Schema.String,
  draftAttachments: Schema.optional(maxValue(mutableArray(attachmentSchema), MAX_ATTACHMENTS)),
  example: Schema.Boolean,
  origin: Schema.optional(Schema.String),
  pullRequest: Schema.optional(taskPullSchema),
  // Informational links never select or change the checkout used for execution.
  linkedPullRequests: Schema.optional(
    maxValue(
      mutableArray(
        mutableStruct({
          ...taskPullSchema.pick('number', 'url', 'provider', 'repositoryUrl').fields,
          ...{
            title: Schema.String,
          },
        }),
      ),
      20,
    ),
  ),
  workItem: Schema.optional(taskWorkItemSchema),
  sessionId: Schema.optional(Schema.String),
  sessionAgentId: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  activity: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  lastViewedTurnId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  viewedRevision: Schema.optional(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.nonNegative()),
  ),
  pinned: Schema.optional(Schema.Boolean),
  // Legacy archived flag means Settled; archivedAt hides the thread from normal lists.
  archived: Schema.optional(Schema.Boolean),
  archivedAt: Schema.optional(Schema.NullOr(isoDateTime(Schema.String))),
  subagents: Schema.optional(mutableArray(subagentSchema)),
  snoozedUntil: Schema.optional(Schema.NullOr(isoDateTime(Schema.String))),
  agentOverrides: Schema.optional(taskModelSchema),
  harness: Schema.optional(Schema.NullOr(taskHarnessSchema)),
  queue: Schema.optional(mutableArray(queuedMessageSchema)),
  queuePaused: Schema.optional(Schema.Boolean),
  restartRecovery: Schema.optional(
    mutableStruct({ kind: Schema.Literal('turn', 'queue'), automatic: Schema.Boolean }),
  ),
  turns: Schema.optional(mutableArray(turnSchema)),
  consumedMessageIds: Schema.optional(mutableArray(Schema.String)),
})
export const nodeDataSchema = mutableStruct({
  kind: Schema.Literal('trigger', 'task', 'review'),
  label: Schema.String,
  trigger: Schema.Literal('manual', 'schedule', 'webhook'),
  schedule: Schema.String,
  timezone: Schema.String,
  objective: Schema.String,
  agentId: Schema.String,
  repositoryId: Schema.String,
  execution: Schema.optional(executionSchema),
})
export const flowNodeSchema = mutableStruct({
  id: Schema.String,
  type: Schema.Literal('automation'),
  position: mutableStruct({
    x: Schema.Number.pipe(Schema.finite()),
    y: Schema.Number.pipe(Schema.finite()),
  }),
  data: nodeDataSchema,
})
export const flowEdgeSchema = mutableStruct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
})
export const automationSchema = mutableStruct({
  id: Schema.String,
  name: minValue(Schema.String, 1),
  nodes: mutableArray(flowNodeSchema),
  edges: mutableArray(flowEdgeSchema),
  enabled: Schema.optional(Schema.Boolean),
})
export const workspaceSchema = mutableStruct({
  version: Schema.Literal(1),
  agents: mutableArray(agentSchema),
  repositories: mutableArray(repositorySchema),
  tasks: mutableArray(taskSchema),
  automations: mutableArray(automationSchema),
  runtimeAddress: Schema.String,
  jiraSources: Schema.optional(mutableArray(jiraSourceSchema)),
  jiraIssueLinks: Schema.optional(mutableArray(jiraIssueLinkSchema)),
})
export type Agent = Schema.Schema.Type<typeof agentSchema>
export type Repository = Schema.Schema.Type<typeof repositorySchema>
export type Task = Schema.Schema.Type<typeof taskSchema>
export type ChangedFile = Schema.Schema.Type<typeof fileSchema>
export type ChatMessage = Schema.Schema.Type<typeof messageSchema>
export type Automation = Schema.Schema.Type<typeof automationSchema>
export type AutomationData = Schema.Schema.Type<typeof nodeDataSchema>
export type AutomationNode = Schema.Schema.Type<typeof flowNodeSchema>
export type Workspace = Schema.Schema.Type<typeof workspaceSchema>
export type TaskTurn = Schema.Schema.Type<typeof turnSchema>

/** Only the newest successful, idle turn can be presented as a completed task. */
export function latestCompletedTaskTurn(task: Task): TaskTurn | undefined {
  if (task.status !== 'review' && task.status !== 'done') return undefined
  const turn = task.turns?.at(-1)
  return turn?.status === 'completed' ? turn : undefined
}
export function hasUnviewedTaskCompletion(task: Task): boolean {
  if (task.archived) return false
  const turn = latestCompletedTaskTurn(task)
  return !!turn && turn.id !== task.lastViewedTurnId
}

/** A submitted message binds a task to its project and checkout, including queued input. */
export function canChangeTaskCheckout(task: Task): boolean {
  return (
    task.status === 'draft' &&
    !task.checkoutLocked &&
    task.messages.length === 0 &&
    !task.queue?.length &&
    !task.turns?.length &&
    !task.consumedMessageIds?.length &&
    !task.sessionId &&
    !task.checkoutBranch &&
    !task.pullRequest
  )
}

/** Provider selection ends with the first submitted input, independently of checkout selection. */
export function canChangeTaskProvider(task: Task): boolean {
  return (
    !task.providerLock &&
    !task.checkoutLocked &&
    !task.messages.some((message) => message.role === 'user') &&
    !task.queue?.length &&
    !task.turns?.length &&
    !task.consumedMessageIds?.length &&
    !task.sessionId &&
    task.status === 'draft'
  )
}

/** Historical execution is authoritative for tasks created before provider locks existed. */
export function lockedTaskProvider(
  task: Task,
  agents: readonly Agent[],
): Agent['provider'] | undefined {
  return (
    task.turns?.[0]?.provider ??
    task.providerLock ??
    (canChangeTaskProvider(task) ? undefined : resolveTaskAgent(task, agents)?.provider)
  )
}
export function resolveTaskAgent(
  task: Pick<Task, 'id' | 'agentId' | 'agentOverrides' | 'harness'>,
  agents: readonly Agent[],
): Agent | undefined {
  const base = task.harness
    ? {
        ...task.harness,
        id: `task:${task.id}`,
        name: task.harness.provider,
      }
    : agents.find((agent) => agent.id === task.agentId)
  if (!base) return undefined
  const merged = {
    ...base,
    ...task.agentOverrides,
  }
  return {
    ...merged,
    acpInstallationId: merged.acpInstallationId ?? undefined,
    serviceTier: merged.serviceTier ?? undefined,
    cyberAccessProgram: merged.cyberAccessProgram ?? undefined,
  }
}
export function defaultTaskHarness(provider: TaskHarness['provider']): TaskHarness {
  return {
    provider,
    model: '',
    reasoning: '',
    instructions: '',
    permission: 'ask',
    endpoint: '',
  }
}
