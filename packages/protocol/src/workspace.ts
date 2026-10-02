import { pullStackSummarySchema } from './scm/pulls/pull-stack.js'
import { filePreviewMetadataSchema } from './scm/repositories/file-previews.js'
import { mutableArray, mutableStruct } from './shared/schema.js'
import { minValue, maxValue, refine, urlSchema, isoDateTime } from './shared/schema.js'
import { subagentSchema } from './conversation/workflow/subagents.js'
import { jiraBindingSchema, jiraSourceSchema, jiraIssueLinkSchema } from './scm/forges/jira.js'
import { taskWorkItemSchema } from './scm/work/work-task.js'
import { resourceSettingsSchema } from './shared/resources.js'
import { attachmentSchema, MAX_ATTACHMENTS } from './shared/attachments.js'
import { Schema } from 'effect'
import { forgeBindingSchema, forgeProviderSchema } from './scm/forges/forges.js'
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
export const agentPresetSchema = mutableStruct({
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
  executablePath: Schema.optional(Schema.String),
  configDirectory: Schema.optional(Schema.String),
  args: Schema.optional(mutableArray(Schema.String)),
  env: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }).pipe(
      Schema.filter((env) =>
        Object.keys(env).every(
          (name) =>
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
            name !== 'DOVO_OWNER_TOKEN' &&
            name !== 'ELECTRON_RUN_AS_NODE',
        ),
      ),
    ),
  ),
  acpInstallationId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  acpMode: Schema.optional(maxValue(Schema.String, 200)),
  acpConfig: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export const agentSchema = mutableStruct({
  ...agentPresetSchema.fields,
  globalPreset: Schema.optional(agentPresetSchema),
  serverOverride: Schema.optional(Schema.Boolean),
})
export const taskHarnessSchema = agentPresetSchema.omit('id', 'name', 'icon')
export type TaskHarness = Schema.Schema.Type<typeof taskHarnessSchema>
export const projectTaskDefaultsSchema = mutableStruct({
  setupCommand: Schema.optional(maxValue(Schema.String, 20000)),
  permission: Schema.optional(agentSchema.fields.permission),
  harness: Schema.optional(taskHarnessSchema.omit('resources')),
  execution: Schema.optional(executionSchema),
  // A fixed default base branch was replaced by Start from origin; older saved values are dropped
  // on read. A task can still pick its own base branch before its first message.
  /** Start worktrees from origin (fetched first) instead of the local branch. */
  worktreeFromOrigin: Schema.optional(Schema.Boolean),
})
export type ProjectTaskDefaults = Schema.Schema.Type<typeof projectTaskDefaultsSchema>
/** A one-tap command for a project, such as "Run tests", run in the task's terminal. */
export const projectActionSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 100),
  name: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 60),
  command: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 4000),
})
export type ProjectAction = Schema.Schema.Type<typeof projectActionSchema>
/** A reusable prompt for a project, inserted in the composer by typing "#" and its name. */
export const savedPromptSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 100),
  name: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 60),
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 20000),
})
export type SavedPrompt = Schema.Schema.Type<typeof savedPromptSchema>
/** A saved starting point for new tasks in a project: goal, agent and checkout choices. */
export const taskTemplateSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 100),
  name: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 80),
  objective: maxValue(Schema.String, 20000),
  agentId: Schema.optional(maxValue(Schema.String, 200)),
  harness: Schema.optional(taskHarnessSchema),
  execution: Schema.optional(executionSchema),
  worktreeFromOrigin: Schema.optional(Schema.Boolean),
  setupCommand: Schema.optional(maxValue(Schema.String, 20000)),
})
export type TaskTemplate = Schema.Schema.Type<typeof taskTemplateSchema>
export const SCRATCH_PROJECT_ID = 'dovo:scratch'
export const repositorySchema = mutableStruct({
  /** Missing means a Git project, preserving existing workspaces. */
  kind: Schema.optional(Schema.Literal('folder', 'scratch')),
  /** User-selected project icon, stored as a small PNG for every client. */
  iconOverride: Schema.optional(
    maxValue(Schema.String.pipe(Schema.pattern(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)), 50000),
  ),
  /** Derived from files in the project checkout by the runtime. */
  discoveredIcon: Schema.optional(
    maxValue(Schema.String.pipe(Schema.pattern(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)), 50000),
  ),
  /** Exact commands the owner has approved for this project. */
  approvedCommands: Schema.optional(
    maxValue(mutableArray(maxValue(minValue(Schema.String, 1), 4000)), 100),
  ),
  templates: Schema.optional(maxValue(mutableArray(taskTemplateSchema), 30)),
  actions: Schema.optional(maxValue(mutableArray(projectActionSchema), 20)),
  prompts: Schema.optional(maxValue(mutableArray(savedPromptSchema), 40)),
  gitIdentity: Schema.optional(Schema.String),
  gitIdentityError: Schema.optional(Schema.String),
  taskDefaults: Schema.optional(projectTaskDefaultsSchema),
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
  preview: Schema.optional(filePreviewMetadataSchema),
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
  /** Exact completed provider-message offsets within accumulated assistant text. */
  textBreaks: Schema.optional(mutableArray(Schema.Number.pipe(Schema.int(), Schema.nonNegative()))),
  bookmarked: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  attachments: Schema.optional(maxValue(mutableArray(attachmentSchema), MAX_ATTACHMENTS)),
  diffComment: Schema.optional(diffCommentSchema),
  createdAt: Schema.optional(Schema.String),
  /** Sent in plan mode: the agent is asked to propose a plan before changing anything. */
  plan: Schema.optional(Schema.Boolean),
  /** A request for the agent to review its changes; its reply lists findings. */
  review: Schema.optional(Schema.Boolean),
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
  // Set while this turn's file changes are undone; `backup` is the snapshot taken just before
  // undoing, so redo can bring back exactly what was there (including later edits).
  undone: Schema.optional(mutableStruct({ at: Schema.String, backup: Schema.String })),
})
export const usageAccountSchema = mutableStruct({
  id: Schema.String,
  label: Schema.String,
  subscription: Schema.optional(Schema.String),
})
export const turnSchema = mutableStruct({
  usageAccount: Schema.optional(usageAccountSchema),
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
  /** Tokens this turn used, when the provider reports them. */
  tokens: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.nonNegative())),
  tokenUsage: Schema.optional(
    mutableStruct({
      input: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
      output: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
      cacheRead: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
      cacheWrite: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
    }),
  ),
  mixedModels: Schema.optional(Schema.Boolean),
  costSource: Schema.optional(Schema.Literal('provider', 'estimated')),
  pricingVersion: Schema.optional(Schema.String),
  /** Local standard API price estimate, not an amount billed by a subscription. */
  estimatedCostUsd: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.nonNegative())),
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
  budget: Schema.optional(
    mutableStruct({
      tokens: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive())),
      minutes: Schema.optional(
        Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive()),
      ),
    }),
  ),
  scheduledMessages: Schema.optional(
    maxValue(
      mutableArray(
        mutableStruct({
          id: Schema.String,
          text: maxValue(minValue(Schema.String, 1), 20000),
          at: isoDateTime(Schema.String),
          failed: Schema.optional(Schema.String),
        }),
      ),
      50,
    ),
  ),
  startAfter: Schema.optional(
    mutableStruct({
      taskId: Schema.String,
      messageId: Schema.String,
      text: maxValue(Schema.String, 20000),
    }),
  ),
  runPhase: Schema.optional(Schema.Literal('preparing', 'provider', 'finalizing')),
  // Admission is durable before checkout preparation; a session alone proves no delivery.
  runAttempt: Schema.optional(
    mutableStruct({ inputMessageIds: mutableArray(Schema.String), promptAccepted: Schema.Boolean }),
  ),
  setupCommand: Schema.optional(maxValue(Schema.String, 20000)),
  worktreeSetupComplete: Schema.optional(Schema.Boolean),
  // Runtime-owned: this task was forked from another task's turn. `snapshot` is that turn's
  // files; the fork's new worktree is restored to it once, then it is cleared.
  sideChats: Schema.optional(
    mutableArray(
      mutableStruct({
        id: Schema.String,
        title: maxValue(Schema.String, 100),
        draft: maxValue(Schema.String, 4000),
        createdAt: Schema.String,
        messages: mutableArray(
          mutableStruct({
            id: Schema.String,
            question: Schema.String,
            answer: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
            status: Schema.Literal('pending', 'completed', 'failed'),
            createdAt: Schema.String,
          }),
        ),
      }),
    ),
  ),
  forkedFrom: Schema.optional(
    mutableStruct({
      taskId: Schema.String,
      turnId: Schema.optional(Schema.String),
      head: Schema.optional(Schema.String),
      title: maxValue(Schema.String, 400),
      snapshot: Schema.optional(Schema.String),
    }),
  ),
  // Runtime-owned: how full the agent's context window is, from its latest usage report.
  contextUsage: Schema.optional(
    mutableStruct({
      used: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.nonNegative())),
      limit: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.positive())),
      updatedAt: Schema.String,
    }),
  ),
  // Provider-confirmed context reductions; retained across reconnects and restarts.
  compactions: Schema.optional(
    mutableArray(
      mutableStruct({
        at: Schema.String,
        turnId: Schema.String,
        textOffset: Schema.optional(
          Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.nonNegative()),
        ),
        sessionId: Schema.String,
        provider: providerSchema,
        trigger: Schema.Literal('manual', 'auto'),
      }),
    ),
  ),
  // Runtime-owned: the task's pull request state and check summary, refreshed in the background.
  // Strings, not literals, so a new forge state never breaks an older client's snapshot.
  pullStatus: Schema.optional(
    mutableStruct({
      stack: Schema.optional(pullStackSummarySchema),
      number: Schema.Number.pipe(Schema.finite(), Schema.int(), Schema.positive()),
      url: maxValue(Schema.String, 2000),
      state: maxValue(Schema.String, 40),
      // 'passed', 'failed' or 'pending'; absent when the pull request has no checks.
      checks: Schema.optional(maxValue(Schema.String, 20)),
      failedChecks: Schema.optional(maxValue(mutableArray(maxValue(Schema.String, 200)), 20)),
      checkedAt: Schema.String,
    }),
  ),
  // Runtime-owned checkout progress while runPhase is 'preparing'. Step ids are strings, not
  // literals, so a newer runtime's extra step never breaks an older client's snapshot.
  preparation: Schema.optional(
    mutableStruct({
      steps: maxValue(mutableArray(maxValue(minValue(Schema.String, 1), 40)), 12),
      current: maxValue(Schema.String, 40),
      branch: Schema.optional(maxValue(Schema.String, 300)),
      startedAt: Schema.String,
      // Set when the run failed on `current`; kept so clients can show where and offer retry.
      failed: Schema.optional(Schema.Boolean),
    }),
  ),
  checkoutBranch: Schema.optional(Schema.String),
  /** Reuse a registered Git worktree instead of creating one for this task. */
  existingWorktreePath: Schema.optional(maxValue(minValue(Schema.String, 1), 4096)),
  worktreeBaseBranch: Schema.optional(Schema.String),
  worktreeFromOrigin: Schema.optional(Schema.Boolean),
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
  /** Most recent accepted prompt, excluding question answers and generated agent input. */
  lastPromptAt: Schema.optional(Schema.String),
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
  ignoredPullRequestUrls: Schema.optional(
    maxValue(mutableArray(maxValue(Schema.String, 2000)), 100),
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
  harness: Schema.optional(taskHarnessSchema),
  agentOverrides: taskSchema.fields.agentOverrides,
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
  planLimits: Schema.optional(
    mutableArray(
      mutableStruct({
        provider: Schema.Literal('codex', 'claude'),
        account: Schema.optional(usageAccountSchema),
        sourceTaskId: Schema.optional(Schema.String),
        agentId: Schema.optional(Schema.String),
        bucketId: Schema.optional(Schema.String),
        windowId: Schema.optional(Schema.String),
        durationMins: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.positive())),
        window: Schema.String,
        usedPercent: Schema.Number.pipe(Schema.finite()),
        resetsAt: Schema.optional(Schema.Number.pipe(Schema.finite())),
        updatedAt: Schema.String,
      }),
    ),
  ),
  jiraSources: Schema.optional(mutableArray(jiraSourceSchema)),
  jiraIssueLinks: Schema.optional(mutableArray(jiraIssueLinkSchema)),
})
export type Agent = Schema.Schema.Type<typeof agentSchema>
export type Repository = Schema.Schema.Type<typeof repositorySchema>
export function projectIcon(repository: Repository | undefined) {
  return repository?.iconOverride ?? repository?.discoveredIcon
}
const projectColors = [
  '#6d28d9',
  '#1d4ed8',
  '#0f766e',
  '#be123c',
  '#7c3aed',
  '#0369a1',
  '#a21caf',
  '#b45309',
  '#047857',
  '#9f1239',
] as const
/** Repository IDs are random at creation, so this gives each fallback icon one stable color. */
export function projectIconColor(repository: Repository | undefined) {
  if (!repository) return projectColors[0]
  let hash = 2166136261
  for (const char of repository.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return projectColors[(hash >>> 0) % projectColors.length]
}
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
  if (task.archived || task.archivedAt) return false
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
/** ACP sessions belong to one installation, even though all use the ACP adapter. */
export function lockedAcpInstallationId(task: Task, agents: readonly Agent[]): string | undefined {
  return lockedTaskProvider(task, agents) === 'acp'
    ? (resolveTaskAgent(task, agents)?.acpInstallationId ?? '')
    : undefined
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
    permission: 'full-access',
    endpoint: '',
  }
}
