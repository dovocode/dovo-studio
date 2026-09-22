import { jiraBindingSchema, jiraSourceSchema, jiraIssueLinkSchema } from './jira.js'
import { taskWorkItemSchema } from './work-task.js'
import { resourceSettingsSchema } from './resources.js'
import { attachmentSchema, MAX_ATTACHMENTS } from './attachments.js'
import { z } from 'zod'
import { forgeBindingSchema, forgeProviderSchema } from './forges.js'

export const executionSchema = z.enum(['main', 'worktree'])
export const providerSchema = z.enum(['codex', 'opencode', 'claude', 'acp'])
export const agentIconSchema = z.enum([
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
])
export const agentSchema = z.object({
  icon: agentIconSchema.optional(),
  resources: resourceSettingsSchema.optional(),
  id: z.string(),
  name: z.string().min(1),
  provider: providerSchema,
  model: z.string(),
  reasoning: z.string().max(100).optional(),
  serviceTier: z.string().max(100).optional(),
  cyberAccessProgram: z.enum(['standard', 'daybreakBlue', 'daybreakRed']).optional(),
  instructions: z.string(),
  permission: z.enum(['ask', 'read-only', 'workspace-write', 'auto', 'full-access']),
  endpoint: z.string(),
  args: z.array(z.string()).optional(),
})
export const taskHarnessSchema = agentSchema.omit({ id: true, name: true, icon: true })
export type TaskHarness = z.infer<typeof taskHarnessSchema>
export const repositorySchema = z.object({
  forge: forgeBindingSchema.optional(),
  jira: jiraBindingSchema.optional(),
  resources: resourceSettingsSchema.optional(),
  id: z.string(),
  name: z.string().min(1),
  path: z.string().min(1),
  branch: z.string(),
})
export const fileSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
  viewed: z.boolean(),
  diskContents: z.string().optional(),
})
export const diffCommentSchema = z.object({
  side: z.enum(['additions', 'deletions']),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  excerpt: z.string(),
  body: z.string().trim().min(1).max(10000),
})
export const taskFeedbackSchema = diffCommentSchema
  .extend({ id: z.string().min(1), path: z.string().min(1) })
  .refine((v) => v.end >= v.start, 'Invalid line range')
export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  file: z.string().optional(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  diffComment: diffCommentSchema.optional(),
  createdAt: z.string().optional(),
})
export const taskPullSchema = z.object({
  provider: forgeProviderSchema.optional(),
  connectionId: z.string().optional(),
  headRef: z.string().optional(),
  cloneUrl: z.url({ protocol: /^https?$/ }).optional(),
  number: z.number().int().positive(),
  url: z.url({ protocol: /^https?$/ }),
  repositoryUrl: z.url({ protocol: /^https?$/ }),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
})
export const queuedMessageSchema = messageSchema.extend({
  role: z.literal('user'),
  createdAt: z.string(),
})
export const turnCheckpointSchema = z.object({
  before: z.string(),
  after: z.string().optional(),
  files: z.array(fileSchema),
  omitted: z.array(z.string()),
  error: z.string().optional(),
})
export const turnSchema = z.object({
  runtimeHost: z.string().optional(),
  branch: z.string().optional(),
  id: z.string(),
  assistantId: z.string(),
  checkpoint: turnCheckpointSchema.optional(),
  agentId: z.string(),
  provider: providerSchema,
  model: z.string(),
  reasoning: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  error: z.string().optional(),
})
export const taskModelSchema = agentSchema
  .pick({
    model: true,
    reasoning: true,
    permission: true,
    serviceTier: true,
    cyberAccessProgram: true,
  })
  .partial()
  .extend({
    // Omission inherits the custom agent; null explicitly clears a task override.
    serviceTier: agentSchema.shape.serviceTier.nullable(),
    cyberAccessProgram: agentSchema.shape.cyberAccessProgram.nullable(),
  })
export const taskSchema = z.object({
  checkoutBranch: z.string().optional(),
  checkoutLocked: z.boolean().optional(),
  // Captured on the first submitted input; queued input keeps the lock after removal.
  providerLock: providerSchema.optional(),
  id: z.string(),
  title: z.string().min(1),
  repositoryId: z.string(),
  execution: executionSchema.optional(),
  agentId: z.string(),
  status: z.enum(['draft', 'running', 'review', 'done', 'failed', 'cancelled']),
  createdAt: z.string(),
  messages: z.array(messageSchema),
  files: z.array(fileSchema),
  draft: z.string(),
  draftAttachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  example: z.boolean(),
  origin: z.string().optional(),
  pullRequest: taskPullSchema.optional(),
  // Informational links never select or change the checkout used for execution.
  linkedPullRequests: z
    .array(
      taskPullSchema
        .pick({ number: true, url: true, provider: true, repositoryUrl: true })
        .extend({ title: z.string() }),
    )
    .max(20)
    .optional(),
  workItem: taskWorkItemSchema.optional(),
  sessionId: z.string().optional(),
  sessionAgentId: z.string().optional(),
  error: z.string().optional(),
  activity: z.string().optional(),
  updatedAt: z.string().optional(),
  lastViewedTurnId: z.string().min(1).max(200).optional(),
  viewedRevision: z.number().int().nonnegative().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  agentOverrides: taskModelSchema.optional(),
  harness: taskHarnessSchema.nullable().optional(),
  queue: z.array(queuedMessageSchema).optional(),
  queuePaused: z.boolean().optional(),
  turns: z.array(turnSchema).optional(),
  consumedMessageIds: z.array(z.string()).optional(),
})
export const nodeDataSchema = z.object({
  kind: z.enum(['trigger', 'task', 'review']),
  label: z.string(),
  trigger: z.enum(['manual', 'schedule', 'webhook']),
  schedule: z.string(),
  timezone: z.string(),
  objective: z.string(),
  agentId: z.string(),
  repositoryId: z.string(),
  execution: executionSchema.optional(),
})
export const flowNodeSchema = z.object({
  id: z.string(),
  type: z.literal('automation'),
  position: z.object({ x: z.number(), y: z.number() }),
  data: nodeDataSchema,
})
export const flowEdgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string() })
export const automationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  enabled: z.boolean().optional(),
})
export const workspaceSchema = z.object({
  version: z.literal(1),
  agents: z.array(agentSchema),
  repositories: z.array(repositorySchema),
  tasks: z.array(taskSchema),
  automations: z.array(automationSchema),
  runtimeAddress: z.string(),
  jiraSources: z.array(jiraSourceSchema).optional(),
  jiraIssueLinks: z.array(jiraIssueLinkSchema).optional(),
})
export type Agent = z.infer<typeof agentSchema>
export type Repository = z.infer<typeof repositorySchema>
export type Task = z.infer<typeof taskSchema>
export type ChangedFile = z.infer<typeof fileSchema>
export type ChatMessage = z.infer<typeof messageSchema>
export type Automation = z.infer<typeof automationSchema>
export type AutomationData = z.infer<typeof nodeDataSchema>
export type AutomationNode = z.infer<typeof flowNodeSchema>
export type Workspace = z.infer<typeof workspaceSchema>

export type TaskTurn = z.infer<typeof turnSchema>

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
    ? { ...task.harness, id: `task:${task.id}`, name: task.harness.provider }
    : agents.find((agent) => agent.id === task.agentId)
  if (!base) return undefined
  const merged = { ...base, ...task.agentOverrides }
  return {
    ...merged,
    serviceTier: merged.serviceTier ?? undefined,
    cyberAccessProgram: merged.cyberAccessProgram ?? undefined,
  }
}
export function defaultTaskHarness(provider: TaskHarness['provider']): TaskHarness {
  return { provider, model: '', reasoning: '', instructions: '', permission: 'ask', endpoint: '' }
}
