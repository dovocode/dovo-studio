import { propagateDelegatedPermissions } from '../agents/tasks/delegation-permissions.js'
import { projectDelegatedAgents } from '../agents/tasks/delegation-state.js'
import { versionReviewedFiles } from './file-review-versions.js'
import { Conversations } from './conversations.js'
import { TaskHistories, type HistoryBudget } from './task-histories.js'
import { WorkspaceDocuments, type StoredWorkspace } from './workspace-documents.js'
import { ProviderActions, type ProviderAction } from './provider-actions.js'
import { UsageTranscripts } from './usage-transcripts.js'
import { UsagePricing } from './usage-pricing.js'
import { UsageHistory } from './usage-history.js'
import { resolveScopedAgents, resolveScopedSettings, resolveTaskDefaults } from '@dovo/protocol'
import { RuntimeDefaults, validateDefaultHarness } from './runtime-defaults.js'
import { McpSecrets } from './mcp-secrets.js'
import { newSecret } from '../auth/devices.js'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { migrateJiraSources } from './jira-migration.js'
import type Database from 'better-sqlite3'
import { Schema, Struct } from 'effect'
import {
  messageSchema,
  turnSchema,
  agentSchema,
  automationSchema,
  canChangeTaskCheckout,
  jiraIssueLinkSchema,
  jiraSourceSchema,
  repositorySchema,
  taskSchema,
  taskHarnessSchema,
  latestCompletedTaskTurn,
  lockedTaskProvider,
  resolveTaskAgent,
  permissionPolicyWithinCeiling,
  taskFamilyIds,
  taskFamilyWorking,
  nativeAgentWorking,
  taskSearchNeedle,
  taskSearchOrder,
  workspaceSchema,
  patchSchema,
  summarizeTask,
  summarizeTaskHistory,
  taskHistorySummarySchema,
  taskMetadataSchema,
  taskHistorySummaryVersion,
  taskMetadata,
  type Workspace,
  type WorkspacePatch,
  type Task,
  type TaskMetadata,
  type TaskSummary,
  type WorkspaceSummary,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import {
  reconcileWorkspaceEdit,
  workspaceDraftConsumed,
  workspaceRecoverySchema,
  type WorkspaceRecovery,
} from '@dovo/protocol'
const rowSchema = mutableStruct({
  value: Schema.String,
})
const collectionSchemas = {
  agents: agentSchema,
  repositories: repositorySchema,
  tasks: taskSchema,
  automations: automationSchema,
  jiraSources: jiraSourceSchema,
  jiraIssueLinks: jiraIssueLinkSchema,
} as const
function validatedItems<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  items: unknown,
  old: S['Type'][],
): S['Type'][] {
  if (items === old) return old
  const known = new Map<unknown, S['Type']>(old.map((item) => [item, item]))
  return decode(Schema.Array(Schema.Unknown), items).map(
    (item) => known.get(item) ?? decode(schema, item),
  )
}
const metadataKeys = Object.keys(taskMetadataSchema.fields).filter(
  (key): key is keyof TaskMetadata => Object.hasOwn(taskMetadataSchema.fields, key),
)
type History = Pick<Task, 'messages' | 'turns'>
/** One workspace update. A summary keeps its stored history; a complete task replaces it. */
export type WorkspaceDraft = Omit<Workspace, 'tasks'> & { tasks: (TaskSummary | Task)[] }
/** What one update committed. `histories` holds complete tasks, before and after, only where the
 * update wrote history; every other task changed metadata at most. */
export interface WorkspaceChange {
  before: WorkspaceSummary
  after: WorkspaceSummary
  histories: ReadonlyMap<string, { before?: Task; after: Task }>
}
const incomplete = (id: string) =>
  new Error(
    `History for ${id} is incomplete. Restore the runtime database from a backup before continuing.`,
  )
function withHistory(summary: TaskSummary, history: History): Task {
  return {
    ...taskMetadata(summary),
    messages: history.messages,
    ...(history.turns !== undefined ? { turns: history.turns } : {}),
  }
}
function withoutHistory(task: TaskSummary | TaskMetadata): TaskMetadata {
  return 'history' in task ? taskMetadata(task) : task
}
function storedMetadata({ messages: _messages, turns: _turns, ...metadata }: Task): TaskMetadata {
  return metadata
}
/** Loads the stored workspace. A document written by another version, or one that a tightened
 * limit now rejects, must not stop the runtime: keep a full copy, then load every entry that
 * still validates. Entries left out stay recoverable from that copy. Version 2 and 3 tasks carry
 * empty histories here; version 1 tasks still embed theirs. */
function loadStoredWorkspace(db: Database.Database, stored: StoredWorkspace): Workspace {
  const parsed = stored.workspace
  const strict = decodeResult(workspaceSchema, parsed)
  if (strict.success) return strict.data
  const backupId = `workspace-backup:${new Date().toISOString()}`
  db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run(backupId, stored.raw)
  const source = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const repaired: Record<string, unknown> = { ...source }
  const omitted: string[] = []
  const omittedTasks: Record<string, string> = {}
  for (const [key, schema] of Object.entries(collectionSchemas)) {
    const items = source[key]
    if (!Array.isArray(items)) continue
    repaired[key] = items.flatMap((item, index) => {
      const result = decodeResult(schema, item)
      if (result.success) return [result.data]
      omitted.push(`${key}[${index}]`)
      if (key === 'tasks') {
        const [id, row] = [...stored.taskRows][index] ?? []
        if (id !== undefined && row !== undefined) omittedTasks[id] = row
      }
      return []
    })
  }
  // Version 3 task metadata lives outside the document; keep omitted rows beside its copy.
  if (Object.keys(omittedTasks).length)
    db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run(
      `${backupId}:tasks`,
      JSON.stringify(omittedTasks),
    )
  const recovered = decodeResult(workspaceSchema, repaired)
  if (!recovered.success)
    throw new Error(
      `The stored workspace could not be loaded. A copy was kept as ${backupId}. ${recovered.error.message}`,
    )
  console.error(
    `Loaded the workspace without ${omitted.length} unreadable ${omitted.length === 1 ? 'entry' : 'entries'} (${omitted.join(', ')}). The original is kept as ${backupId}.`,
  )
  return recovered.data
}
/** A stored history summary that agrees with its row's counts, or undefined to derive it again. */
function storedHistorySummary(
  raw: string | undefined,
  task: Task,
  counts: { messages: number; turns: number },
) {
  if (!raw) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = decodeResult(
    mutableStruct({
      version: Schema.Literal(taskHistorySummaryVersion),
      history: taskHistorySummarySchema,
    }),
    value,
  )
  if (!result.success) return undefined
  const history = result.data.history
  return history.messages === counts.messages &&
    (history.turns ?? 0) === counts.turns &&
    (history.turns === undefined) === (task.turns === undefined)
    ? history
    : undefined
}
export interface WorkspaceStoreOptions {
  /** Complete histories kept in memory, least recently used first out. */
  historyBudget?: HistoryBudget
}
/** The runtime workspace. Memory holds task summaries: metadata and bounded facts about each
 * history. `task(id)` and `updateTaskHistory` read and write a complete conversation through a
 * bounded cache over `conversation_items`; nothing else loads history. */
export class WorkspaceStore {
  private readonly secrets: McpSecrets
  private workspace: WorkspaceSummary
  private readonly conversations: Conversations
  private readonly histories: TaskHistories
  private readonly documents: WorkspaceDocuments
  /** Version 1 documents still embed histories; the first write moves them to SQLite rows. */
  private seedHistory = true
  /** Complete version 1 tasks, held only until that first write. */
  private seed?: ReadonlyMap<string, Task>
  /** Version 1 and 2 documents are rewritten as normalized version 3 task rows. */
  private rewriteDocuments = true
  readonly providerActions: ProviderActions
  readonly usage: UsageHistory
  readonly usagePricing: UsagePricing
  readonly usageTranscripts = new UsageTranscripts()
  private revision = 0
  private transactionDepth = 0
  private readonly commitListeners = new Set<
    (before: WorkspaceSummary, after: WorkspaceSummary) => void
  >()
  /** Execution side effects run only after the outermost transaction commits. */
  onCommitted(listener: (before: WorkspaceSummary, after: WorkspaceSummary) => void) {
    this.commitListeners.add(listener)
    return () => this.commitListeners.delete(listener)
  }
  private committed(before: WorkspaceSummary) {
    if (this.transactionDepth || before === this.workspace) return
    for (const listener of this.commitListeners) {
      try {
        listener(before, this.workspace)
      } catch (error) {
        console.error('Workspace commit listener failed', error)
      }
    }
  }
  private projected?: { revision: number; workspace: WorkspaceSummary }
  private readonly publicTasks = new WeakMap<TaskSummary, WeakRef<Task>>()
  private readonly validatedSummaries = new WeakMap<object, TaskSummary>()
  /** Host-local inventory survives thread deletion and changes to the worktree folder. */
  managedWorktrees(common: string): string[] {
    const row = decode(
      Schema.UndefinedOr(rowSchema),
      this.db.prepare('SELECT value FROM documents WHERE id = ?').get(`worktrees:${common}`),
    )
    return row ? decode(mutableArray(Schema.String), JSON.parse(row.value)) : []
  }
  rememberWorktree(common: string, path: string) {
    const paths = this.managedWorktrees(common)
    if (paths.includes(path)) return
    this.db
      .prepare('INSERT OR REPLACE INTO documents (id, value) VALUES (?, ?)')
      .run(`worktrees:${common}`, JSON.stringify([...paths, path]))
  }
  forgetWorktree(common: string, path: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO documents (id, value) VALUES (?, ?)')
      .run(
        `worktrees:${common}`,
        JSON.stringify(this.managedWorktrees(common).filter((item) => item !== path)),
      )
  }
  constructor(
    private readonly db: Database.Database,
    private onUpdate?: (change: WorkspaceChange) => void,
    options: WorkspaceStoreOptions = {},
  ) {
    this.conversations = new Conversations(db)
    this.histories = new TaskHistories(db, options.historyBudget)
    this.documents = new WorkspaceDocuments(db)
    this.providerActions = new ProviderActions(db)
    this.providerActions.recover()
    this.usage = new UsageHistory(db)
    this.usagePricing = new UsagePricing(db)
    const keyRow = db.prepare('SELECT value FROM documents WHERE id = ?').get('mcp-projection-key')
    const key = keyRow ? decode(rowSchema, keyRow).value : newSecret()
    if (!keyRow) db.prepare('INSERT INTO documents VALUES (?, ?)').run('mcp-projection-key', key)
    this.secrets = new McpSecrets(key)
    const stored = this.documents.read()
    const loaded: Workspace = stored
      ? loadStoredWorkspace(db, stored)
      : {
          version: 1,
          agents: [],
          repositories: [],
          tasks: [],
          automations: [],
          runtimeAddress: '',
        }
    this.seedHistory = !stored || stored.version === 1
    this.rewriteDocuments = stored?.version !== 3
    this.workspace = { ...loaded, tasks: this.loadSummaries(stored, loaded.tasks) }
    if (stored && stored.version !== 1) this.verifyHistoryCounts()
    this.backfillUsage(!stored)
    this.update((w) => ({
      ...w,
      tasks: w.tasks
        .filter((task) => !task.example)
        .map((task) => ({
          ...task,
          subagents: task.subagents?.map((agent) =>
            agent.source === 'dovo'
              ? agent
              : {
                  ...agent,
                  sessionLive: false,
                  status: nativeAgentWorking(agent) ? ('stopped' as const) : agent.status,
                  finishedAt: nativeAgentWorking(agent)
                    ? new Date().toISOString()
                    : agent.finishedAt,
                  ...(nativeAgentWorking(agent)
                    ? {
                        result: 'The runtime restarted before this native child finished.',
                        completion:
                          agent.completion === 'disposed'
                            ? ('disposed' as const)
                            : ('pending' as const),
                        completionId: `native-result:${agent.provider}:${agent.sessionId}:${agent.id}:${agent.startedAt}`,
                      }
                    : {}),
                },
          ),
        }))
        // Older branch switching wrote checkoutBranch to untouched local drafts.
        // That metadata is not a prepared checkout and must not lock the picker.
        .map((task) =>
          task.execution !== 'worktree' &&
          task.checkoutBranch &&
          canChangeTaskCheckout({ ...task, checkoutBranch: undefined })
            ? { ...task, checkoutBranch: undefined }
            : task,
        )
        .map((task) => this.recoverInterrupted(task)),
    }))
  }
  /** Restart recovery. Only interrupted turns need their task's history. */
  private recoverInterrupted(task: TaskSummary): TaskSummary | Task {
    const latest = task.history.latestTurn
    if (task.runPhase === 'finalizing' && latest?.finishedAt && latest.status !== 'running') {
      const complete = this.complete(task)
      return {
        ...complete,
        status:
          latest.status === 'completed'
            ? 'review'
            : latest.status === 'cancelled'
              ? 'cancelled'
              : 'failed',
        runPhase: 'finalizing',
        activeRunId: undefined,
        activity: undefined,
        queuePaused: true,
        restartRecovery: { kind: 'turn', automatic: !task.queuePaused },
        error:
          'The agent finished before the runtime stopped. Change capture was interrupted; review the working tree before continuing.',
        turns: complete.turns?.map((turn) =>
          turn.id === latest.id && turn.checkpoint && !turn.checkpoint.after
            ? {
                ...turn,
                checkpoint: {
                  ...turn.checkpoint,
                  error: 'Runtime stopped before change capture finished.',
                },
              }
            : turn,
        ),
      }
    }
    if (task.status === 'running') {
      const complete = this.complete(task)
      const queued = task.runPhase === 'preparing' && !task.runAttempt && !!task.queue?.length
      const uncertain = this.providerActions.uncertain(task.id, task.activeRunId)
      return {
        ...complete,
        status: 'failed',
        activeRunId: undefined,
        runPhase: undefined,
        preparation: undefined,
        activity: undefined,
        restartRecovery: {
          kind: queued ? 'queue' : 'turn',
          automatic: !queued && !task.queuePaused && !uncertain,
        },
        queuePaused: true,
        turns: complete.turns?.map((turn) =>
          turn.status === 'running'
            ? {
                ...turn,
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: 'Runtime stopped during this turn',
                checkpoint: turn.checkpoint
                  ? {
                      ...turn.checkpoint,
                      error: 'Runtime stopped before the after snapshot was captured.',
                    }
                  : undefined,
              }
            : turn,
        ),
        error: uncertain
          ? 'A provider action was not confirmed before the runtime stopped. Review the provider session before resuming.'
          : 'Runtime stopped while this task was running. Resume to continue.',
      }
    }
    if (task.activeRunId && (task.status === 'failed' || task.status === 'cancelled'))
      // This marker belonged to the previous runtime's execution, not a resumable
      // live owner. Keep the failure, history and uncertain provider receipts, and
      // require manual continuation rather than replaying its queued input.
      return {
        ...task,
        activeRunId: undefined,
        runPhase: undefined,
        preparation: undefined,
        activity: undefined,
        queuePaused: true,
        restartRecovery:
          task.status === 'failed' && task.restartRecovery
            ? { ...task.restartRecovery, automatic: false }
            : undefined,
      }
    return task.queue?.length
      ? {
          ...task,
          restartRecovery:
            task.restartRecovery ??
            (!task.queuePaused ? { kind: 'queue', automatic: false } : undefined),
          queuePaused: true,
        }
      : task
  }
  /** Version 3 rows carry each history summary. Earlier documents, and rows written before
   * summaries were stored, derive it once from that task's complete history. */
  private loadSummaries(stored: StoredWorkspace | undefined, loaded: Task[]): TaskSummary[] {
    if (!stored) return []
    // Legacy examples may share an ID with a real task; they are removed on the first write.
    const real = new Set(loaded.filter((task) => !task.example).map((task) => task.id))
    const tasks = loaded.filter((task) => !task.example || !real.has(task.id))
    if (stored.version === 1) {
      this.seed = new Map(tasks.map((task) => [task.id, task]))
      return tasks.map(summarizeTask)
    }
    return tasks.map((task) => {
      const counts = stored.historyCounts?.[task.id]
      if (!counts) throw incomplete(task.id)
      const metadata = storedMetadata(task)
      const history = storedHistorySummary(stored.historySummaries.get(task.id), task, counts)
      if (history) return { ...metadata, history }
      this.rewriteDocuments = true
      return summarizeTask(
        this.histories.load({
          ...metadata,
          history: {
            messages: counts.messages,
            ...(task.turns !== undefined ? { turns: counts.turns } : {}),
          },
        }),
      )
    })
  }
  /** One aggregate query keeps startup fail-closed without reading any history. */
  private verifyHistoryCounts() {
    const counts = this.histories.counts()
    for (const task of this.workspace.tasks) {
      const stored = counts.get(task.id) ?? { messages: 0, turns: 0 }
      if (stored.messages !== task.history.messages || stored.turns !== (task.history.turns ?? 0))
        throw incomplete(task.id)
    }
  }
  /** Usage records began after histories existed; record those once, one task at a time. */
  private backfillUsage(empty: boolean) {
    if (this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get('usage-history-backfill'))
      return
    this.db.transaction(() => {
      if (!empty)
        for (const task of this.workspace.tasks)
          if (!task.example && task.history.turns)
            this.usage.record([this.loadComplete(task)], new Map())
      this.db.prepare('INSERT INTO documents VALUES (?, ?)').run('usage-history-backfill', 'done')
    })()
  }
  acceptQuestionResponse(
    taskId: string,
    response: { id: string; fingerprint: string },
    action: ProviderAction,
  ) {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO question_responses VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .run(response.id, taskId, response.fingerprint)
      this.providerActions.record(action)
    })()
  }
  /** Task summaries and the rest of the workspace. No conversation history. */
  get(): WorkspaceSummary {
    return this.workspace
  }
  /** Enclosing writes must share this boundary so a rollback restores the live snapshot too.
   * Updates remain synchronously visible to other operations inside the transaction. Cached
   * histories are keyed by the summaries they were written for, so rolled-back histories are
   * never served again. */
  transaction<T>(fn: () => T): T {
    const workspace = this.workspace
    const revision = this.revision
    const seedHistory = this.seedHistory
    const seed = this.seed
    const rewriteDocuments = this.rewriteDocuments
    const projected = this.projected
    this.transactionDepth++
    let succeeded = false
    try {
      const result = this.db.transaction(fn)()
      succeeded = true
      return result
    } catch (error) {
      this.workspace = workspace
      this.revision = revision
      this.seedHistory = seedHistory
      this.seed = seed
      this.rewriteDocuments = rewriteDocuments
      this.projected = projected
      throw error
    } finally {
      this.transactionDepth--
      if (succeeded) this.committed(workspace)
    }
  }
  removeAgent(id: string) {
    const agent = this.workspace.agents.find((entry) => entry.id === id)
    if (!agent) return
    if (
      this.workspace.automations.some((flow) => flow.nodes.some((node) => node.data.agentId === id))
    )
      throw new HttpError(
        409,
        'Choose another configuration in automations before deleting this one',
      )
    if (
      this.workspace.tasks.some(
        (task) =>
          task.agentId === id &&
          (task.status === 'running' || task.subagents?.some(nativeAgentWorking)),
      )
    )
      throw new HttpError(409, 'Stop running threads before deleting their configuration')
    const harness = decode(taskHarnessSchema, agent)
    this.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.filter((entry) => entry.id !== id),
      tasks: workspace.tasks.map((task) =>
        task.agentId === id ? { ...task, agentId: '', harness: task.harness ?? harness } : task,
      ),
      repositories: workspace.repositories.map((repository) => ({
        ...repository,
        templates: repository.templates?.map((template) =>
          template.agentId === id
            ? { ...template, agentId: undefined, harness: template.harness ?? harness }
            : template,
        ),
      })),
    }))
  }
  /** The client projection of task summaries, with MCP secrets replaced by references. */
  publicWorkspace(): WorkspaceSummary {
    if (this.projected?.revision !== this.revision) {
      const workspace = this.validateWorkspace(
        this.secrets.public(this.workspace),
        this.projected?.workspace,
      )
      this.projected = {
        revision: this.revision,
        workspace: {
          ...workspace,
          tasks: workspace.tasks.map((task) => {
            if (!('history' in task)) throw new Error(`Task ${task.id} has no history summary.`)
            return task
          }),
        },
      }
    }
    return this.projected.workspace
  }
  /** One complete task for a client. Its identity is stable while the task is unchanged. */
  publicTask(id: string): Task {
    const summary = this.publicWorkspace().tasks.find((task) => task.id === id)
    if (!summary) throw new HttpError(404, 'Task not found')
    const complete = this.task(id)
    const cached = this.publicTasks.get(summary)?.deref()
    if (cached?.messages === complete.messages && cached.turns === complete.turns) return cached
    const task = withHistory(summary, complete)
    this.publicTasks.set(summary, new WeakRef(task))
    return task
  }
  /** Complete public tasks, read one at a time and not retained by the store. For clients that
   * predate paged history; `reuse` returns a task built earlier for the same summary. */
  *publicCompleteTasks(reuse?: (summary: TaskSummary) => Task | undefined) {
    const committedTasks = new Map(this.workspace.tasks.map((task) => [task.id, task]))
    for (const summary of this.publicWorkspace().tasks) {
      const reused = reuse?.(summary)
      if (reused) {
        yield { summary, task: reused }
        continue
      }
      const committed = committedTasks.get(summary.id)
      if (!committed) continue
      yield { summary, task: withHistory(summary, this.loadComplete(committed)) }
    }
  }
  publicValue(value: unknown) {
    return this.secrets.public(value)
  }
  restoreSecrets(value: unknown) {
    return this.secrets.restore(value, {
      workspace: this.workspace,
      defaults: new RuntimeDefaults(this.db).get(),
    })
  }
  projectSettings(repositoryId?: string) {
    return resolveScopedSettings(
      new RuntimeDefaults(this.db).get(),
      this.workspace.repositories.find((repo) => repo.id === repositoryId),
    )
  }
  agentsFor(repositoryId?: string) {
    return resolveScopedAgents(
      new RuntimeDefaults(this.db).get(),
      this.workspace.repositories.find((repo) => repo.id === repositoryId),
      this.workspace.agents,
    )
  }
  version() {
    return this.revision
  }
  /** Validates changed task metadata only. Summaries keep their history facts; tasks given as
   * complete tasks arrive here without their history, which is validated separately. */
  private validateTasks(
    items: unknown,
    old: readonly TaskSummary[],
  ): (TaskSummary | TaskMetadata)[] {
    if (items === old) return [...old]
    const known = new Map(old.map((task) => [task.id, task]))
    // A summary's facts must be the committed ones; `update` rejects any other value.
    const committed = new Map(this.workspace.tasks.map((task) => [task.id, task.history]))
    return decode(Schema.Array(Schema.Unknown), items).map((value): TaskSummary | TaskMetadata => {
      if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
        return decode(taskMetadataSchema, value)
      const previous = known.get(value.id)
      if (value === previous) return previous
      const candidate = decode(Schema.Record(Schema.String, Schema.Unknown), value)
      const stored = committed.get(value.id)
      const history = stored && candidate.history === stored ? stored : undefined
      // Projections of an unchanged summary keep their identity across revisions.
      const memo = history && this.validatedSummaries.get(value)
      if (memo && memo.history === history) return memo
      let metadata: TaskMetadata
      if (!previous) metadata = decode(taskMetadataSchema, value)
      else {
        const keys = metadataKeys.filter((key) => candidate[key] !== previous[key])
        const changed = decode(
          taskMetadataSchema.mapFields(Struct.pick(keys)),
          Object.fromEntries(keys.map((key) => [key, candidate[key]])),
        )
        metadata = { ...taskMetadata(previous), ...changed }
      }
      if (!history) return metadata
      const summary = { ...metadata, history }
      this.validatedSummaries.set(value, summary)
      return summary
    })
  }
  /** Validate changed entities only; immutable, already validated values remain shared. */
  private validateWorkspace(value: unknown, previous: WorkspaceSummary | undefined) {
    const candidate = decode(Schema.Record(Schema.String, Schema.Unknown), value)
    const collection = <S extends Schema.Codec<unknown, unknown>>(
      schema: S,
      items: unknown,
      old: S['Type'][],
    ): S['Type'][] => {
      return validatedItems(schema, items, old)
    }
    const shell = decode(workspaceSchema, {
      ...candidate,
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
      jiraSources: undefined,
      jiraIssueLinks: undefined,
      planLimits: undefined,
    })
    return {
      ...shell,
      agents: collection(agentSchema, candidate.agents, previous?.agents ?? []),
      repositories: collection(
        repositorySchema,
        candidate.repositories,
        previous?.repositories ?? [],
      ),
      tasks: this.validateTasks(candidate.tasks, previous?.tasks ?? []),
      automations: collection(automationSchema, candidate.automations, previous?.automations ?? []),
      jiraSources:
        candidate.jiraSources === previous?.jiraSources
          ? previous?.jiraSources
          : candidate.jiraSources === undefined
            ? undefined
            : decode(
                Schema.required(workspaceSchema.fields.jiraSources.schema),
                candidate.jiraSources,
              ),
      jiraIssueLinks:
        candidate.jiraIssueLinks === previous?.jiraIssueLinks
          ? previous?.jiraIssueLinks
          : candidate.jiraIssueLinks === undefined
            ? undefined
            : decode(
                Schema.required(workspaceSchema.fields.jiraIssueLinks.schema),
                candidate.jiraIssueLinks,
              ),
      planLimits:
        candidate.planLimits === previous?.planLimits
          ? previous?.planLimits
          : candidate.planLimits === undefined
            ? undefined
            : decode(
                Schema.required(workspaceSchema.fields.planLimits.schema),
                candidate.planLimits,
              ),
    }
  }
  private taskWatchLifecycle?: (
    tasks: TaskSummary[],
    agents: WorkspaceSummary['agents'],
  ) => TaskSummary[]
  /** Reconcile watch cancellation and the Waiting projection inside the workspace transaction. */
  setTaskWatchLifecycle(
    reconcile: (tasks: TaskSummary[], agents: WorkspaceSummary['agents']) => TaskSummary[],
  ) {
    this.taskWatchLifecycle = reconcile
  }
  /** The complete task for a committed summary, without retaining it. */
  private loadComplete(summary: TaskSummary): Task {
    const seeded = this.seed?.get(summary.id)
    return seeded ? withHistory(summary, seeded) : this.histories.load(summary)
  }
  /** The complete task for a summary, retained in the bounded history cache. */
  private complete(summary: TaskSummary): Task {
    const seeded = this.seed?.get(summary.id)
    return seeded ? withHistory(summary, seeded) : this.histories.get(summary)
  }
  /** Commits a workspace change. Tasks given as summaries keep their stored history; complete
   * tasks replace it, and are the only histories this update reads or writes. */
  update(
    fn: (workspace: WorkspaceSummary) => WorkspaceDraft,
    submission?: {
      taskId: string
      id: string
      fingerprint: string
      response?: { id: string; fingerprint: string }
    },
    action?: ProviderAction,
  ): WorkspaceSummary {
    const draft = fn(this.workspace)
    const previousTasks = new Map(this.workspace.tasks.map((task) => [task.id, task]))
    const written = new Map<string, History>()
    const candidates = draft.tasks.map((task): TaskSummary | TaskMetadata => {
      if ('history' in task) {
        // Facts are derived from the stored history; they cannot be edited directly.
        if ('messages' in task || 'turns' in task)
          throw new Error(`Task ${task.id} mixes a summary with conversation history.`)
        if (previousTasks.get(task.id)?.history !== task.history)
          throw new Error(`Write the complete history of task ${task.id} to change it.`)
        return task
      }
      const { messages, turns, ...metadata } = task
      written.set(task.id, { messages, ...(turns !== undefined ? { turns } : {}) })
      return metadata
    })
    const parsed = migrateJiraSources(
      this.validateWorkspace(this.restoreSecrets({ ...draft, tasks: candidates }), this.workspace),
    )
    const histories = new Map<string, History>()
    const summaries = parsed.tasks.map((task): TaskSummary => {
      const history = written.get(task.id)
      if (!history) {
        if (!('history' in task)) throw new Error(`Task ${task.id} has no history.`)
        return task
      }
      const previous = previousTasks.get(task.id)
      const prior = previous && this.histories.peek(previous)
      const messages = validatedItems(messageSchema, history.messages, prior?.messages ?? [])
      const turns =
        history.turns === undefined
          ? undefined
          : validatedItems(turnSchema, history.turns, prior?.turns ?? [])
      const validated = { messages, ...(turns !== undefined ? { turns } : {}) }
      histories.set(task.id, validated)
      return { ...withoutHistory(task), history: summarizeTaskHistory(validated) }
    })
    // A business rule for edits only: a stored harness that a newer or older build no longer
    // supports must not keep the workspace from loading at startup.
    for (const repository of parsed.repositories) {
      const harness = repository.taskDefaults?.harness
      const previous = this.workspace.repositories.find((item) => item.id === repository.id)
      if (harness && !isDeepStrictEqual(previous?.taskDefaults?.harness, harness))
        validateDefaultHarness(harness)
    }
    let defaults: ReturnType<RuntimeDefaults['get']> | undefined
    const getDefaults = () => (defaults ??= new RuntimeDefaults(this.db).get())
    const next: WorkspaceSummary = {
      ...parsed,
      tasks: summaries
        .filter((task) => !task.example)
        .map((task) => {
          const previous = previousTasks.get(task.id)
          if (task.archived) {
            const settledAt = previous?.archived
              ? (previous.settledAt ?? new Date().toISOString())
              : new Date().toISOString()
            if (task.settledAt !== settledAt) task = { ...task, settledAt }
          } else if (task.settledAt !== undefined) task = { ...task, settledAt: undefined }
          task = versionReviewedFiles(task, previous)
          const childPermissionChanged =
            task.delegation &&
            (!previous ||
              previous.agentId !== task.agentId ||
              !isDeepStrictEqual(
                resolveTaskAgent(previous, this.workspace.agents),
                resolveTaskAgent(task, parsed.agents),
              ) ||
              !isDeepStrictEqual(previous.harness, task.harness) ||
              !isDeepStrictEqual(previous.agentOverrides, task.agentOverrides) ||
              previous.delegation?.parentTaskId !== task.delegation.parentTaskId ||
              previous.delegation?.checkoutId !== task.delegation.checkoutId)
          if (previous && task.history.messages < previous.history.messages)
            task = { ...task, historyRevision: (previous.historyRevision ?? 0) + 1 }
          if (
            !task.harness &&
            task.agentId &&
            (task !== previous || parsed.agents !== this.workspace.agents)
          ) {
            const agents = resolveScopedAgents(
              getDefaults(),
              parsed.repositories.find((repo) => repo.id === task.repositoryId),
              parsed.agents,
            )
            const selected = agents.find((agent) => agent.id === task.agentId)
            const scoped = resolveScopedSettings(
              getDefaults(),
              parsed.repositories.find((repo) => repo.id === task.repositoryId),
            ).agents?.some((agent) => agent.id === task.agentId)
            if (selected && scoped)
              task = {
                ...task,
                agentName: selected.name,
                agentIcon: selected.icon,
                harness: decode(taskHarnessSchema, selected),
              }
          }
          if (task.agentId && task.harness && previous?.agentId !== task.agentId) {
            const selected = resolveScopedAgents(
              getDefaults(),
              parsed.repositories.find((repo) => repo.id === task.repositoryId),
              parsed.agents,
            ).find((agent) => agent.id === task.agentId)
            if (selected) task = { ...task, agentName: selected.name, agentIcon: selected.icon }
          }
          if (task.delegation && childPermissionChanged) {
            const parent = summaries.find((entry) => entry.id === task.delegation?.parentTaskId)
            const parentAgent = parent && resolveTaskAgent(parent, parsed.agents)
            const childAgent = resolveTaskAgent(task, parsed.agents)
            const checkout = parent?.linkedCheckouts?.find(
              (link) => link.id === task.delegation?.checkoutId,
            )
            if (
              parentAgent &&
              childAgent &&
              ((task.delegation.checkoutId && !checkout) ||
                !permissionPolicyWithinCeiling(
                  parentAgent,
                  childAgent,
                  checkout?.access === 'read-only',
                ))
            )
              throw new HttpError(
                403,
                'Child permissions cannot exceed their parent or checkout access',
              )
          }
          const locked = previous ? lockedTaskProvider(previous, this.workspace.agents) : undefined
          const provider = resolveTaskAgent(task, parsed.agents)?.provider
          const previousInstallation = previous
            ? (resolveTaskAgent(previous, this.workspace.agents)?.acpInstallationId ?? '')
            : ''
          const nextInstallation = resolveTaskAgent(task, parsed.agents)?.acpInstallationId ?? ''
          const configChanged =
            previous &&
            (previous.agentId !== task.agentId ||
              !isDeepStrictEqual(previous.harness, task.harness) ||
              resolveTaskAgent(previous, this.workspace.agents)?.provider !== provider)
          if (locked && configChanged && provider !== locked)
            throw new HttpError(
              409,
              `This task uses ${locked}. After the first message, choose models and settings within the same provider. Create a new task to use another provider.`,
            )
          if (locked === 'acp' && previousInstallation !== nextInstallation)
            throw new HttpError(
              409,
              'This thread uses a different ACP installation. Start a new task to use another agent.',
            )
          const providerLock = locked ?? lockedTaskProvider(task, parsed.agents)
          const updated =
            previous?.status === 'running' && task.status !== 'running'
              ? {
                  ...task,
                  subagents: task.subagents?.map((agent) =>
                    agent.status === 'working' && !agent.sessionLive
                      ? {
                          ...agent,
                          status: 'unknown' as const,
                        }
                      : agent,
                  ),
                }
              : task
          return providerLock && updated.providerLock !== providerLock
            ? {
                ...updated,
                providerLock,
              }
            : updated
        }),
    }
    // Collections are addressed by identity throughout the runtime. In particular,
    // duplicate tasks would merge histories while retaining incompatible manifest counts.
    for (const collection of [
      'agents',
      'repositories',
      'tasks',
      'automations',
      'jiraSources',
    ] as const) {
      const ids = new Set<string>()
      for (const item of next[collection] ?? []) {
        if (ids.has(item.id)) throw new HttpError(400, `Duplicate ${collection} ID: ${item.id}`)
        ids.add(item.id)
      }
    }
    const issueLinks = new Set<string>()
    for (const link of next.jiraIssueLinks ?? []) {
      const key = JSON.stringify([link.sourceId, link.issueId])
      if (issueLinks.has(key))
        throw new HttpError(400, `Duplicate Jira issue link: ${link.sourceId} / ${link.issueId}`)
      issueLinks.add(key)
    }
    next.tasks = propagateDelegatedPermissions(this.workspace, next)
    next.tasks = projectDelegatedAgents(next.tasks, next.agents)
    const nextTaskIds = new Set(next.tasks.map((task) => task.id))
    const removed = [...previousTasks.values()].filter((task) => !nextTaskIds.has(task.id))
    const changes = new Map<string, { before?: Task; after: Task }>()
    this.db.transaction(() => {
      if (this.rewriteDocuments) {
        // Migration keeps the original document in the same transaction as its replacement.
        const old = this.db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')
        if (old)
          this.db
            .prepare('INSERT OR IGNORE INTO documents VALUES (?, ?)')
            .run(
              this.seedHistory ? 'workspace-before-history-v2' : 'workspace-before-tasks-v3',
              decode(rowSchema, old).value,
            )
      }
      if (this.taskWatchLifecycle) next.tasks = this.taskWatchLifecycle(next.tasks, next.agents)
      // Only written histories are recorded. Version 1 migration seeds every history at once.
      const recorded: Task[] = []
      const recordedBefore = new Map<string, Task>()
      for (const task of next.tasks) {
        const history = histories.get(task.id)
        const previous = previousTasks.get(task.id)
        const before = previous && (history || this.seed) ? this.loadComplete(previous) : undefined
        const after = history
          ? withHistory(task, history)
          : this.seed?.has(task.id)
            ? this.loadComplete(task)
            : undefined
        if (!after) continue
        recorded.push(after)
        if (before) recordedBefore.set(task.id, before)
        changes.set(task.id, { before, after })
      }
      for (const task of removed) recordedBefore.set(task.id, this.loadComplete(task))
      this.conversations.record(recorded, recordedBefore, this.seedHistory)
      if (action) this.providerActions.record(action)
      // Usage records carry the title and session of each turn's task.
      const usage = [...recorded]
      const usageBefore = new Map(recordedBefore)
      for (const task of next.tasks) {
        const previous = previousTasks.get(task.id)
        if (
          !changes.has(task.id) &&
          previous &&
          task.history.turns &&
          (previous.title !== task.title || previous.sessionId !== task.sessionId)
        ) {
          const before = this.loadComplete(previous)
          usage.push(withHistory(task, before))
          usageBefore.set(task.id, before)
        }
      }
      this.usage.record(usage, usageBefore)
      if (submission)
        this.db
          .prepare('INSERT INTO task_submissions VALUES (?, ?, ?)')
          .run(submission.taskId, submission.id, submission.fingerprint)
      if (submission?.response)
        this.db
          .prepare('INSERT INTO question_responses VALUES (?, ?, ?)')
          .run(submission.response.id, submission.taskId, submission.response.fingerprint)
      for (const { id } of removed) {
        this.providerActions.remove(id)
        this.db.prepare('DELETE FROM task_submissions WHERE task_id = ?').run(id)
        this.db.prepare('DELETE FROM question_responses WHERE task_id = ?').run(id)
      }
      for (const collection of ['tasks', 'agents', 'repositories', 'automations'] as const) {
        const retained = new Set(next[collection].map((item) => item.id))
        for (const item of this.workspace[collection])
          if (!retained.has(item.id))
            this.db
              .prepare('INSERT OR IGNORE INTO documents (id,value) VALUES (?,?)')
              .run(
                `workspace-deleted:${collection}:${item.id}`,
                JSON.stringify({ deletedAt: new Date().toISOString() }),
              )
      }
      this.documents.write(next, this.workspace, this.rewriteDocuments)
      this.onUpdate?.({ before: this.workspace, after: next, histories: changes })
    })()
    this.seedHistory = false
    this.seed = undefined
    this.rewriteDocuments = false
    const committedBefore = this.workspace
    this.workspace = next
    this.revision++
    for (const { id } of removed) this.histories.forget(id)
    for (const task of next.tasks) {
      const written = histories.has(task.id) && changes.get(task.id)
      if (written) this.histories.remember(task, written.after)
    }
    this.committed(committedBefore)
    return next
  }
  taskDefaults(repositoryId?: string) {
    return resolveTaskDefaults(
      new RuntimeDefaults(this.db).get(),
      this.workspace.repositories.find((repo) => repo.id === repositoryId),
    )
  }
  /** Task metadata and history facts, without reading any history. */
  taskSummary(id: string): TaskSummary {
    const task = this.workspace.tasks.find((t) => t.id === id)
    if (!task) throw new HttpError(404, 'Task not found')
    return task
  }
  /** The complete task, including every message and turn. Reads SQLite unless the bounded
   * history cache holds it. */
  task(id: string): Task {
    return this.complete(this.taskSummary(id))
  }
  /** Attachments referenced by any committed message, without loading histories. */
  messageAttachmentIds() {
    return this.histories.attachmentIds()
  }
  /** Retained complete histories, for diagnostics and tests. */
  retainedHistories() {
    return this.histories.retained()
  }
  /** One committed history page read from SQLite. Undefined when the cursor no longer exists. */
  historyPage(id: string, before?: string) {
    return this.conversations.page(id, before, this.taskSummary(id).historyRevision)
  }
  /** Search committed histories in SQLite, ordered and bounded like `searchTaskMessages`. */
  searchHistory(query: string, id?: string) {
    return this.conversations.search(
      taskSearchOrder(id ? [this.taskSummary(id)] : this.workspace.tasks).map((task) => task.id),
      taskSearchNeedle(query),
    )
  }
  // Questions consumes this through its injected receipt-store contract.
  questionResponse(id: string) {
    const row = this.db
      .prepare('SELECT fingerprint AS value FROM question_responses WHERE id = ?')
      .get(id)
    return row ? decode(rowSchema, row).value : undefined
  }
  taskSubmission(id: string, messageId: string) {
    const row = this.db
      .prepare(
        'SELECT fingerprint AS value FROM task_submissions WHERE task_id = ? AND message_id = ?',
      )
      .get(id, messageId)
    return row ? decode(rowSchema, row).value : undefined
  }
  /** Updates one task's metadata. Its history is neither read nor written. */
  updateTask(
    id: string,
    fn: (task: TaskSummary) => TaskSummary,
    submission?: {
      id: string
      fingerprint: string
      response?: { id: string; fingerprint: string }
    },
    action?: ProviderAction,
  ) {
    this.update(
      (w) => {
        const previous = this.taskSummary(id)
        return this.replaceTask(w, previous, fn(previous))
      },
      submission ? { ...submission, taskId: id } : undefined,
      action,
    )
  }
  /** Updates one complete task, writing the difference in its messages and turns. */
  updateTaskHistory(
    id: string,
    fn: (task: Task) => Task,
    submission?: {
      id: string
      fingerprint: string
      response?: { id: string; fingerprint: string }
    },
    action?: ProviderAction,
  ) {
    this.update(
      (w) => {
        const previous = this.task(id)
        return this.replaceTask(w, previous, fn(previous))
      },
      submission ? { ...submission, taskId: id } : undefined,
      action,
    )
  }
  private replaceTask<T extends TaskSummary | Task>(
    w: WorkspaceSummary,
    previous: T,
    next: T,
  ): WorkspaceDraft {
    const id = previous.id
    const newActivity =
      previous.autoSettled &&
      !previous.archivedAt &&
      (('messages' in next &&
        'messages' in previous &&
        !isDeepStrictEqual(next.messages, previous.messages)) ||
        !isDeepStrictEqual(next.files, previous.files) ||
        !isDeepStrictEqual(next.queue, previous.queue))
    const reopened = previous.archived && next.archived === false && !previous.archivedAt
    const family = newActivity || reopened ? taskFamilyIds(w.tasks, id) : undefined
    return {
      ...w,
      tasks: w.tasks.map((task): TaskSummary | Task =>
        task.id === id
          ? {
              ...next,
              ...(newActivity ? { archived: false, autoSettled: undefined } : {}),
              updatedAt: new Date().toISOString(),
            }
          : family?.has(task.id) && (reopened || task.autoSettled) && !task.archivedAt
            ? {
                ...task,
                archived: false,
                autoSettled: undefined,
                snoozedUntil: reopened ? null : task.snoozedUntil,
              }
            : task,
      ),
    }
  }
  markTaskViewed(id: string, turnId: string, expectedRevision: number, viewed = true) {
    const task = this.taskSummary(id)
    if (
      (task.viewedRevision ?? 0) !== expectedRevision ||
      latestCompletedTaskTurn(task)?.id !== turnId
    )
      return
    if ((task.lastViewedTurnId === turnId) === viewed) return
    // Viewing is metadata only: do not update updatedAt or reorder activity-based task lists.
    this.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((item) =>
        item.id === id
          ? {
              ...item,
              lastViewedTurnId: viewed ? turnId : undefined,
              viewedRevision: expectedRevision + 1,
            }
          : item,
      ),
    }))
  }
  private validateProjectTask(task: TaskMetadata) {
    const repository = this.workspace.repositories.find((repo) => repo.id === task.repositoryId)
    if (
      repository?.kind &&
      (task.execution === 'worktree' ||
        task.existingWorktreePath ||
        task.worktreeBaseBranch ||
        task.worktreeFromOrigin ||
        task.setupCommand)
    )
      throw new HttpError(
        400,
        'Plain folders and projectless threads do not support Git worktree settings',
      )
  }
  patch(patch: WorkspacePatch) {
    const outcome = { reconciled: false }
    this.transaction(() => this.applyPatch(patch, outcome))
    return outcome
  }
  recoveredEdits(): WorkspaceRecovery[] {
    return this.recoveredEditsPage().edits
  }
  recoveredEditsPage(cursor?: string) {
    const rows = this.db
      .prepare(
        "SELECT rowid AS cursor,value FROM documents WHERE id >= 'workspace-recovery:' AND id < 'workspace-recovery;' AND rowid < ? ORDER BY rowid DESC LIMIT 101",
      )
      .all(cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor))
    const edits = rows.slice(0, 100).map((row) => {
      const stored = decode(rowSchema, row)
      return decode(workspaceRecoverySchema, this.publicValue(JSON.parse(stored.value)))
    })
    const last = rows[99]
    const nextCursor =
      rows.length > 100 && last
        ? String(decode(mutableStruct({ cursor: Schema.Number }), last).cursor)
        : undefined
    return { edits, nextCursor }
  }
  preserveEdit(patch: WorkspacePatch, host: unknown, reason?: string) {
    const id = createHash('sha256').update(JSON.stringify({ patch, host })).digest('hex')
    const edit: WorkspaceRecovery = { id, createdAt: new Date().toISOString(), patch, host, reason }
    this.db
      .prepare('INSERT OR IGNORE INTO documents (id, value) VALUES (?, ?)')
      .run(`workspace-recovery:${id}`, JSON.stringify(edit))
    return id
  }
  previewPatch(patch: WorkspacePatch): WorkspacePatch {
    const entity = this.workspace[patch.collection].find((item) => item.id === patch.id)
    if (!entity) return patch
    if (patch.create !== undefined)
      return { collection: patch.collection, id: patch.id, changes: {} }
    const current = decode(
      Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
      this.publicValue(entity),
    )
    return {
      ...patch,
      changes: Object.fromEntries(
        Object.entries(patch.changes).map(([key, change]) => [
          key,
          {
            before: current[key] ?? null,
            after: reconcileWorkspaceEdit(
              change.before ?? null,
              change.after ?? null,
              current[key] ?? null,
            ).value,
          },
        ]),
      ),
    }
  }
  private applyPatch(patch: WorkspacePatch, outcome: { reconciled: boolean }) {
    patch = decode(patchSchema, {
      ...patch,
      create: this.secrets.restore(patch.create, this.workspace, true),
      changes: Object.fromEntries(
        Object.entries(patch.changes).map(([key, change]) => [
          key,
          {
            // A lost-response retry may refer to a secret that was already replaced.
            // Keep missing before references for conflict checking; never persist them.
            before: this.secrets.restore(change.before, this.workspace, true),
            after: this.secrets.restore(change.after, this.workspace, true),
          },
        ]),
      ),
    })
    const list = this.workspace[patch.collection]
    const entity = list.find((item) => item.id === patch.id)
    if (patch.create !== undefined) {
      const record = decode(
        Schema.StructWithRest(
          Schema.Struct(
            mutableStruct({
              id: Schema.String,
            }).fields,
          ),
          [Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))],
        ),
        patch.create,
      )
      if (record.id !== patch.id) throw new HttpError(400, 'Item id does not match')
      if (
        patch.collection === 'tasks' &&
        (record.pullRequest !== undefined ||
          record.workItem !== undefined ||
          record.status !== 'draft' ||
          record.example === true ||
          record.sessionId !== undefined ||
          record.checkoutLocked !== undefined ||
          record.providerLock !== undefined ||
          record.worktreeSetupComplete !== undefined ||
          record.worktreeSubmodulesComplete !== undefined ||
          record.quotaContinuation !== undefined ||
          record.autoSettled !== undefined ||
          record.waitingForFeedback !== undefined ||
          record.threadWatches !== undefined ||
          record.watchCounts !== undefined ||
          record.lastViewedTurnId !== undefined ||
          record.viewedRevision !== undefined ||
          record.fileReviewVersion !== undefined ||
          record.fileReviewVersions !== undefined ||
          record.turns !== undefined ||
          record.subagents !== undefined ||
          record.linkedCheckoutSetup !== undefined ||
          record.delegation !== undefined ||
          record.archivedAt !== undefined ||
          record.queue !== undefined ||
          record.runPhase !== undefined ||
          record.activeRunId !== undefined ||
          record.historyBefore !== undefined ||
          record.historyRevision !== undefined ||
          record.historyTotals !== undefined ||
          record.runAttempt !== undefined ||
          record.preparation !== undefined ||
          record.pullStatus !== undefined ||
          record.pullStatuses !== undefined ||
          record.nativeTodos !== undefined ||
          record.autoProjectFallback !== undefined ||
          record.contextUsage !== undefined ||
          record.sideChats !== undefined ||
          record.forkedFrom !== undefined ||
          record.consumedMessageIds !== undefined)
      )
        throw new HttpError(400, 'New tasks must be drafts')
      const parsed = decode(
        workspaceSchema.fields[patch.collection].schema.value,
        entity ? record : this.restoreSecrets(record),
      )
      if (patch.collection === 'tasks') this.validateProjectTask(decode(taskSchema, parsed))
      if (patch.collection === 'repositories' && 'kind' in record && record.kind === 'scratch')
        throw new HttpError(400, 'The scratch workspace is managed by Dovo')
      if (entity) {
        if (patch.collection === 'tasks') {
          const existing = this.task(patch.id)
          const retry = versionReviewedFiles(decode(taskSchema, parsed), existing)
          if (isDeepStrictEqual(existing, retry)) return
        } else if (isDeepStrictEqual(entity, parsed)) return
        this.preserveEdit(patch, entity)
        outcome.reconciled = true
        return
      }
      if (
        this.db
          .prepare('SELECT 1 FROM documents WHERE id=?')
          .get(`workspace-deleted:${patch.collection}:${patch.id}`)
      ) {
        this.preserveEdit(patch, null, 'This item was deleted on the runtime.')
        outcome.reconciled = true
        return
      }
      this.update((w) => ({
        ...w,
        [patch.collection]: [...list, parsed],
      }))
      return
    }
    if (!entity) {
      this.preserveEdit(patch, null)
      outcome.reconciled = true
      return
    }
    if (
      patch.collection === 'tasks' &&
      'pullRequest' in entity &&
      entity.pullRequest &&
      patch.changes.repositoryId
    )
      throw new HttpError(400, 'PR tasks stay attached to their source repository')
    if (
      patch.collection === 'tasks' &&
      'workItem' in entity &&
      entity.workItem &&
      patch.changes.repositoryId
    )
      throw new HttpError(400, 'Linked tasks stay attached to their source repository')
    // Appending messages edits the history; every other task change edits metadata only.
    const summary =
      patch.collection === 'tasks' ? this.workspace.tasks.find((t) => t.id === patch.id) : undefined
    const complete = summary && patch.changes.messages ? this.task(patch.id) : undefined
    const current = decode(
      Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
      complete ?? entity,
    )
    if (
      patch.collection === 'repositories' &&
      (patch.changes.gitIdentity || patch.changes.gitIdentityError)
    )
      throw new HttpError(400, 'Cannot edit derived project metadata')
    if (patch.collection === 'repositories' && (patch.changes.kind || current.kind === 'scratch'))
      throw new HttpError(400, 'Cannot edit the managed project kind')
    if (
      patch.collection === 'tasks' &&
      current.delegation &&
      [
        'repositoryId',
        'execution',
        'existingWorktreePath',
        'worktreeBaseBranch',
        'worktreeFromOrigin',
        'submodules',
        'setupCommand',
      ].some((key) => patch.changes[key])
    )
      throw new HttpError(400, 'Child agents use their parent’s checkout')
    const allowed =
      patch.collection === 'tasks'
        ? new Set([
            'title',
            'agentId',
            'repositoryId',
            'autoProject',
            'autoProjectExecution',
            'draft',
            'messages',
            'files',
            'pinned',
            'archived',
            'settleBehavior',
            'archiveAfterSettledDays',
            'snoozedUntil',
            'linkedPullRequests',
            'ignoredPullRequestUrls',
            'agentOverrides',
            'harness',
            'harnessCustomized',
            'modelSelection',
            'execution',
            'existingWorktreePath',
            'worktreeBaseBranch',
            'worktreeFromOrigin',
            'submodules',
            'setupCommand',
          ])
        : null
    let changed = false
    const recovered: WorkspacePatch['changes'] = {}
    const applied: WorkspacePatch['changes'] = {}
    const recoveryHost: Record<string, unknown> = {}
    for (const [key, change] of Object.entries(patch.changes)) {
      if (key === 'id' || (allowed && !allowed.has(key)))
        throw new HttpError(400, `Cannot edit ${key}`)
      // A response can be lost after committing. Retrying that value is a no-op.
      if (isDeepStrictEqual(current[key] ?? null, change.after ?? null)) continue
      // Sending consumes the old draft outside workspace PATCH. Typing the next
      // message before its clear arrives remains an ordinary edit.
      const consumedDraft =
        key === 'draft' && !!summary && workspaceDraftConsumed(summary, change.before)
      const merged = consumedDraft
        ? { value: change.after, conflicted: false }
        : reconcileWorkspaceEdit(change.before ?? null, change.after ?? null, current[key] ?? null)
      if (!consumedDraft && !isDeepStrictEqual(current[key] ?? null, change.before ?? null))
        outcome.reconciled = true
      if (merged.conflicted) {
        recovered[key] = change
        recoveryHost[key] = current[key] ?? null
      }
      if (isDeepStrictEqual(current[key] ?? null, merged.value ?? null)) continue
      if (
        patch.collection === 'tasks' &&
        (key === 'execution' ||
          key === 'existingWorktreePath' ||
          key === 'repositoryId' ||
          key === 'autoProject' ||
          key === 'autoProjectExecution' ||
          (key === 'modelSelection' && merged.value != null) ||
          key === 'worktreeBaseBranch' ||
          key === 'worktreeFromOrigin' ||
          key === 'submodules' ||
          key === 'setupCommand') &&
        summary &&
        !canChangeTaskCheckout(summary)
      )
        throw new HttpError(409, 'Choose the working directory before sending the first message')
      if (
        patch.collection === 'tasks' &&
        (current.status === 'running' ||
          (key !== 'archived' &&
            this.workspace.tasks.some(
              (child) =>
                child.delegation?.parentTaskId === patch.id &&
                taskFamilyWorking(this.workspace.tasks, child.id),
            )) ||
          this.workspace.tasks
            .find((task) => task.id === patch.id)
            ?.subagents?.some(nativeAgentWorking)) &&
        [
          'agentId',
          'agentOverrides',
          'harness',
          'harnessCustomized',
          'repositoryId',
          'archived',
        ].includes(key)
      )
        throw new HttpError(409, 'Stop the active turn before changing task settings')
      if (patch.collection === 'tasks' && key === 'messages') {
        const old = decode(mutableArray(Schema.Unknown), current.messages),
          next = decode(
            mutableArray(
              Schema.StructWithRest(
                Schema.Struct(
                  mutableStruct({
                    role: Schema.String,
                  }).fields,
                ),
                [Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))],
              ),
            ),
            merged.value,
          )
        if (
          next.length < old.length ||
          !isDeepStrictEqual(next.slice(0, old.length), old) ||
          next.slice(old.length).some((message) => message.role !== 'user')
        )
          throw new HttpError(400, 'Only new user messages may be appended')
      }
      merged.value = this.restoreSecrets(merged.value)
      applied[key] = { before: current[key] ?? null, after: merged.value ?? null }
      current[key] = merged.value ?? undefined
      changed = true
    }
    if (Object.keys(recovered).length)
      this.preserveEdit({ ...patch, changes: recovered }, recoveryHost)
    patch = { ...patch, changes: applied }
    if (patch.collection === 'tasks' && (patch.changes.repositoryId || patch.changes.autoProject))
      current.autoProjectFallback = undefined
    if (
      patch.collection === 'tasks' &&
      changed &&
      ['execution', 'existingWorktreePath', 'repositoryId'].some((key) => patch.changes[key])
    ) {
      // Reusing an existing checkout does not run new-worktree setup. Switching
      // away resets the runtime-owned setup marker for the next created checkout.
      current.worktreeSubmodulesComplete = undefined
      current.worktreeSetupComplete =
        current.execution === 'worktree' && current.existingWorktreePath ? true : undefined
    }
    if (
      patch.collection === 'tasks' &&
      (patch.changes.archived?.after === true || patch.changes.snoozedUntil)
    )
      current.quotaContinuation = undefined
    const autoUnsettle =
      patch.collection === 'tasks' &&
      current.autoSettled &&
      !current.archivedAt &&
      !!(patch.changes.messages || patch.changes.files)
    if (autoUnsettle) {
      current.archived = false
      current.autoSettled = undefined
    }
    if (patch.collection === 'tasks' && patch.changes.archived) current.autoSettled = undefined
    if (patch.collection === 'tasks' && current.archived === false) current.archivedAt = undefined
    if (!changed) return
    const updatedTask: TaskSummary | Task | undefined = complete
      ? decode(taskSchema, current)
      : summary && { ...decode(taskMetadataSchema, current), history: summary.history }
    if (updatedTask) this.validateProjectTask(updatedTask)
    const family =
      patch.collection === 'tasks' &&
      (patch.changes.archived || patch.changes.snoozedUntil || autoUnsettle)
        ? taskFamilyIds(this.workspace.tasks, patch.id)
        : undefined
    if (
      family &&
      patch.changes.archived &&
      this.workspace.tasks.some(
        (task) =>
          family.has(task.id) &&
          (task.status === 'running' ||
            !!task.activeRunId ||
            task.subagents?.some(nativeAgentWorking)),
      )
    )
      throw new HttpError(409, 'Stop active child agents before settling or reopening this thread')
    this.update((w) => ({
      ...w,
      ...(updatedTask
        ? {}
        : { [patch.collection]: list.map((item) => (item.id === patch.id ? current : item)) }),
      ...(updatedTask
        ? {
            tasks: w.tasks.map((task): TaskSummary | Task => {
              if (task.id === patch.id) return updatedTask
              if (!family?.has(task.id)) return task
              if (autoUnsettle && task.autoSettled && !task.archivedAt)
                return { ...task, archived: false, autoSettled: undefined }
              return {
                ...task,
                ...(patch.changes.archived
                  ? {
                      archived: updatedTask.archived,
                      ...(updatedTask.archived === false ? { archivedAt: undefined } : {}),
                    }
                  : {}),
                ...(patch.changes.snoozedUntil
                  ? {
                      snoozedUntil: updatedTask.snoozedUntil,
                    }
                  : {}),
              }
            }),
          }
        : {}),
    }))
  }
}
