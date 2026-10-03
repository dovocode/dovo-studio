import { Conversations } from './conversations.js'
import { ProviderActions, type ProviderAction } from './provider-actions.js'
import { UsageTranscripts } from './usage-transcripts.js'
import { UsagePricing } from './usage-pricing.js'
import { UsageHistory } from './usage-history.js'
import { resolveTaskDefaults } from '@dovo/protocol'
import { RuntimeDefaults, validateDefaultHarness } from './runtime-defaults.js'
import { McpSecrets } from './mcp-secrets.js'
import { newSecret } from '../auth/devices.js'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { migrateJiraSources } from './jira-migration.js'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
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
  workspaceSchema,
  patchSchema,
  type Workspace,
  type WorkspacePatch,
  type Task,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { isDeepStrictEqual } from 'node:util'
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
function validatedItems<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  items: unknown,
  old: Schema.Schema.Type<S>[],
): Schema.Schema.Type<S>[] {
  if (items === old) return old
  const known = new Map<unknown, Schema.Schema.Type<S>>(old.map((item) => [item, item]))
  return decode(Schema.Array(Schema.Unknown), items).map(
    (item) => known.get(item) ?? decode(schema, item),
  )
}
/** Loads the stored workspace. A document written by another version, or one that a tightened
 * limit now rejects, must not stop the runtime: keep a full copy, then load every entry that
 * still validates. Entries left out stay recoverable from that copy. */
export function loadStoredWorkspace(db: Database.Database, raw: string): Workspace {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The stored workspace is not valid JSON. Restore it from a runtime backup.')
  }
  const envelope = decodeResult(
    mutableStruct({
      storageVersion: Schema.Number,
      workspace: Schema.Unknown,
      historyCounts: Schema.Record({
        key: Schema.String,
        value: mutableStruct({
          messages: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          turns: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        }),
      }),
    }),
    parsed,
  )
  if (envelope.success && envelope.data.storageVersion !== 2)
    throw new Error('This workspace uses a newer storage format. Update Dovo before opening it.')
  const storageMarker = decodeResult(mutableStruct({ storageVersion: Schema.Number }), parsed)
  if (storageMarker.success && !envelope.success)
    throw new Error(
      'The workspace history manifest is invalid. Restore the runtime database from a backup.',
    )
  if (envelope.success) parsed = envelope.data.workspace
  const hydrate = (workspace: Workspace) =>
    envelope.success
      ? new Conversations(db).hydrate(workspace, envelope.data.historyCounts)
      : workspace
  const strict = decodeResult(workspaceSchema, parsed)
  if (strict.success) return hydrate(strict.data)
  const backupId = `workspace-backup:${new Date().toISOString()}`
  db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run(backupId, raw)
  const source = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const repaired: Record<string, unknown> = { ...source }
  const omitted: string[] = []
  for (const [key, schema] of Object.entries(collectionSchemas)) {
    const items = source[key]
    if (!Array.isArray(items)) continue
    repaired[key] = items.flatMap((item, index) => {
      const result = decodeResult(schema, item)
      if (result.success) return [result.data]
      omitted.push(`${key}[${index}]`)
      return []
    })
  }
  const recovered = decodeResult(workspaceSchema, repaired)
  if (!recovered.success)
    throw new Error(
      `The stored workspace could not be loaded. A copy was kept as ${backupId}. ${recovered.error.message}`,
    )
  console.error(
    `Loaded the workspace without ${omitted.length} unreadable ${omitted.length === 1 ? 'entry' : 'entries'} (${omitted.join(', ')}). The original is kept as ${backupId}.`,
  )
  return hydrate(recovered.data)
}
export class WorkspaceStore {
  private readonly secrets: McpSecrets
  private workspace: Workspace
  private readonly conversations: Conversations
  private seedHistory = true
  readonly providerActions: ProviderActions
  readonly usage: UsageHistory
  readonly usagePricing: UsagePricing
  readonly usageTranscripts = new UsageTranscripts()
  private revision = 0
  private projected?: { revision: number; workspace: Workspace }
  constructor(
    private readonly db: Database.Database,
    private onUpdate?: (before: Workspace, after: Workspace) => void,
  ) {
    this.conversations = new Conversations(db)
    this.providerActions = new ProviderActions(db)
    this.providerActions.recover()
    this.usage = new UsageHistory(db)
    this.usagePricing = new UsagePricing(db)
    const keyRow = db.prepare('SELECT value FROM documents WHERE id = ?').get('mcp-projection-key')
    const key = keyRow ? decode(rowSchema, keyRow).value : newSecret()
    if (!keyRow) db.prepare('INSERT INTO documents VALUES (?, ?)').run('mcp-projection-key', key)
    this.secrets = new McpSecrets(key)
    const row = db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')
    this.workspace = row
      ? loadStoredWorkspace(db, decode(rowSchema, row).value)
      : {
          version: 1,
          agents: [],
          repositories: [],
          tasks: [],
          automations: [],
          runtimeAddress: '',
        }
    if (row)
      this.seedHistory = !decodeResult(
        mutableStruct({ storageVersion: Schema.Literal(2) }),
        JSON.parse(decode(rowSchema, row).value),
      ).success
    this.db.transaction(() => this.usage.record(this.workspace.tasks, new Map()))()
    this.update((w) => ({
      ...w,
      tasks: w.tasks
        .filter((task) => !task.example)
        // Older branch switching wrote checkoutBranch to untouched local drafts.
        // That metadata is not a prepared checkout and must not lock the picker.
        .map((task) =>
          task.execution !== 'worktree' &&
          task.checkoutBranch &&
          canChangeTaskCheckout({ ...task, checkoutBranch: undefined })
            ? { ...task, checkoutBranch: undefined }
            : task,
        )
        .map((task) =>
          task.runPhase === 'finalizing' &&
          task.turns?.at(-1)?.finishedAt &&
          task.turns?.at(-1)?.status !== 'running'
            ? {
                ...task,
                status:
                  task.turns?.at(-1)?.status === 'completed'
                    ? 'review'
                    : task.turns?.at(-1)?.status === 'cancelled'
                      ? 'cancelled'
                      : 'failed',
                runPhase: 'finalizing',
                activeRunId: undefined,
                activity: undefined,
                queuePaused: true,
                restartRecovery: { kind: 'turn', automatic: !task.queuePaused },
                error:
                  'The agent finished before the runtime stopped. Change capture was interrupted; review the working tree before continuing.',
                turns: task.turns?.map((turn) =>
                  turn.id === task.turns?.at(-1)?.id && turn.checkpoint && !turn.checkpoint.after
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
            : task.status === 'running'
              ? {
                  ...task,
                  status: 'failed',
                  activeRunId: undefined,
                  runPhase: undefined,
                  preparation: undefined,
                  activity: undefined,
                  restartRecovery: {
                    kind:
                      task.runPhase === 'preparing' && !task.runAttempt && task.queue?.length
                        ? 'queue'
                        : 'turn',
                    automatic:
                      !(task.runPhase === 'preparing' && !task.runAttempt && task.queue?.length) &&
                      !task.queuePaused &&
                      !this.providerActions.uncertain(task.id, task.activeRunId),
                  },
                  queuePaused: true,
                  turns: task.turns?.map((turn) =>
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
                  error: this.providerActions.uncertain(task.id, task.activeRunId)
                    ? 'A provider action was not confirmed before the runtime stopped. Review the provider session before resuming.'
                    : 'Runtime stopped while this task was running. Resume to continue.',
                }
              : task.queue?.length
                ? {
                    ...task,
                    restartRecovery:
                      task.restartRecovery ??
                      (!task.queuePaused ? { kind: 'queue', automatic: false } : undefined),
                    queuePaused: true,
                  }
                : task,
        ),
    }))
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
  get() {
    return this.workspace
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
    if (this.workspace.tasks.some((task) => task.agentId === id && task.status === 'running'))
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
  publicWorkspace() {
    if (this.projected?.revision !== this.revision)
      this.projected = {
        revision: this.revision,
        workspace: this.validateWorkspace(
          this.secrets.public(this.workspace),
          this.projected?.workspace,
        ),
      }
    return this.projected.workspace
  }
  restoreSecrets(value: unknown) {
    return this.secrets.restore(value, this.workspace)
  }
  version() {
    return this.revision
  }
  private validateTasks(items: unknown, old: Task[]): Task[] {
    if (items === old) return old
    const known = new Map(old.map((task) => [task.id, task]))
    return decode(Schema.Array(Schema.Unknown), items).map((value) => {
      if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
        return decode(taskSchema, value)
      const previous = known.get(value.id)
      if (value === previous) return previous
      if (!previous) return decode(taskSchema, value)
      const candidate = decode(Schema.Record({ key: Schema.String, value: Schema.Unknown }), value)
      const keys = Object.keys(taskSchema.fields)
        .filter((key): key is keyof Task => Object.hasOwn(taskSchema.fields, key))
        .filter((key) => candidate[key] !== previous[key])
      const changed = decode(
        taskSchema.pick(...keys.filter((key) => key !== 'messages' && key !== 'turns')),
        Object.fromEntries(
          keys
            .filter((key) => key !== 'messages' && key !== 'turns')
            .map((key) => [key, candidate[key]]),
        ),
      )
      return {
        ...previous,
        ...changed,
        ...(keys.includes('messages')
          ? { messages: validatedItems(messageSchema, candidate.messages, previous.messages) }
          : {}),
        ...(keys.includes('turns')
          ? {
              turns:
                candidate.turns === undefined
                  ? undefined
                  : validatedItems(turnSchema, candidate.turns, previous.turns ?? []),
            }
          : {}),
      }
    })
  }
  /** Validate changed entities only; immutable, already validated histories remain shared. */
  private validateWorkspace(value: unknown, previous = this.workspace): Workspace {
    const candidate = decode(Schema.Record({ key: Schema.String, value: Schema.Unknown }), value)
    const collection = <S extends Schema.Schema.AnyNoContext>(
      schema: S,
      items: unknown,
      old: Schema.Schema.Type<S>[],
    ): Schema.Schema.Type<S>[] => {
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
            : decode(workspaceSchema.fields.jiraSources.from, candidate.jiraSources),
      jiraIssueLinks:
        candidate.jiraIssueLinks === previous?.jiraIssueLinks
          ? previous?.jiraIssueLinks
          : candidate.jiraIssueLinks === undefined
            ? undefined
            : decode(workspaceSchema.fields.jiraIssueLinks.from, candidate.jiraIssueLinks),
      planLimits:
        candidate.planLimits === previous?.planLimits
          ? previous?.planLimits
          : candidate.planLimits === undefined
            ? undefined
            : decode(workspaceSchema.fields.planLimits.from, candidate.planLimits),
    }
  }
  update(
    fn: (workspace: Workspace) => Workspace,
    submission?: {
      taskId: string
      id: string
      fingerprint: string
      response?: { id: string; fingerprint: string }
    },
    action?: ProviderAction,
  ) {
    const parsed = migrateJiraSources(
      this.validateWorkspace(this.restoreSecrets(fn(this.workspace))),
    )
    // A business rule for edits only: a stored harness that a newer or older build no longer
    // supports must not keep the workspace from loading at startup.
    for (const repository of parsed.repositories) {
      const harness = repository.taskDefaults?.harness
      const previous = this.workspace.repositories.find((item) => item.id === repository.id)
      if (harness && !isDeepStrictEqual(previous?.taskDefaults?.harness, harness))
        validateDefaultHarness(harness)
    }
    const previousTasks = new Map(this.workspace.tasks.map((task) => [task.id, task]))
    const next = {
      ...parsed,
      tasks: parsed.tasks
        .filter((task) => !task.example)
        .map((task) => {
          const previous = previousTasks.get(task.id)
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
                    agent.status === 'working'
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
    const nextTaskIds = new Set(next.tasks.map((task) => task.id))
    this.db.transaction(() => {
      if (this.seedHistory) {
        const old = this.db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')
        if (old)
          this.db
            .prepare('INSERT OR IGNORE INTO documents VALUES (?, ?)')
            .run('workspace-before-history-v2', decode(rowSchema, old).value)
      }
      this.conversations.record(next.tasks, previousTasks, this.seedHistory)
      if (action) this.providerActions.record(action)
      this.usage.record(next.tasks, previousTasks)
      if (submission)
        this.db
          .prepare('INSERT INTO task_submissions VALUES (?, ?, ?)')
          .run(submission.taskId, submission.id, submission.fingerprint)
      if (submission?.response)
        this.db
          .prepare('INSERT INTO question_responses VALUES (?, ?, ?)')
          .run(submission.response.id, submission.taskId, submission.response.fingerprint)
      for (const id of previousTasks.keys())
        if (!nextTaskIds.has(id)) {
          this.providerActions.remove(id)
          this.db.prepare('DELETE FROM task_submissions WHERE task_id = ?').run(id)
          this.db.prepare('DELETE FROM question_responses WHERE task_id = ?').run(id)
        }
      this.db
        .prepare(
          'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
        )
        .run('workspace', this.serialize(next))
      this.onUpdate?.(this.workspace, next)
    })()
    this.seedHistory = false
    this.workspace = next
    this.revision++
    return next
  }
  private readonly serializedTasks = new WeakMap<Task, string>()
  private serialize(workspace: Workspace) {
    const tasks = workspace.tasks
      .map((task) => {
        let value = this.serializedTasks.get(task)
        if (value === undefined) {
          value = JSON.stringify({
            ...task,
            messages: [],
            ...(task.turns !== undefined ? { turns: [] } : {}),
          })
          this.serializedTasks.set(task, value)
        }
        return value
      })
      .join(',')
    const shell = JSON.stringify({ ...workspace, tasks: undefined })
    const counts = JSON.stringify(
      Object.fromEntries(
        workspace.tasks.map((task) => [
          task.id,
          { messages: task.messages.length, turns: task.turns?.length ?? 0 },
        ]),
      ),
    )
    return `{"storageVersion":2,"historyCounts":${counts},"workspace":${shell.slice(0, -1)},"tasks":[${tasks}]}}`
  }
  taskDefaults(repositoryId?: string) {
    return resolveTaskDefaults(
      new RuntimeDefaults(this.db).get(),
      this.workspace.repositories.find((repo) => repo.id === repositoryId),
    )
  }
  task(id: string) {
    const task = this.workspace.tasks.find((t) => t.id === id)
    if (!task) throw new HttpError(404, 'Task not found')
    return task
  }
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
  updateTask(
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
      (w) => ({
        ...w,
        tasks: w.tasks.map((t) =>
          t.id === id
            ? {
                ...fn(t),
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      }),
      submission ? { ...submission, taskId: id } : undefined,
      action,
    )
  }
  markTaskViewed(id: string, turnId: string, expectedRevision: number, viewed = true) {
    const task = this.task(id)
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
  private validateProjectTask(task: Task) {
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
    patch = decode(patchSchema, {
      ...patch,
      create: this.restoreSecrets(patch.create),
      changes: Object.fromEntries(
        Object.entries(patch.changes).map(([key, change]) => [
          key,
          {
            // A lost-response retry may refer to a secret that was already replaced.
            // Keep missing before references for conflict checking; never persist them.
            before: this.secrets.restore(change.before, this.workspace, true),
            after: this.restoreSecrets(change.after),
          },
        ]),
      ),
    })
    const list = this.workspace[patch.collection]
    const entity = list.find((item) => item.id === patch.id)
    if (patch.create !== undefined) {
      const record = decode(
        Schema.Struct(
          mutableStruct({
            id: Schema.String,
          }).fields,
          {
            key: Schema.String,
            value: Schema.Unknown,
          },
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
          record.lastViewedTurnId !== undefined ||
          record.viewedRevision !== undefined ||
          record.turns !== undefined ||
          record.subagents !== undefined ||
          record.archivedAt !== undefined ||
          record.queue !== undefined ||
          record.runPhase !== undefined ||
          record.activeRunId !== undefined ||
          record.historyBefore !== undefined ||
          record.historyTotals !== undefined ||
          record.runAttempt !== undefined ||
          record.preparation !== undefined ||
          record.pullStatus !== undefined ||
          record.contextUsage !== undefined ||
          record.sideChats !== undefined ||
          record.forkedFrom !== undefined ||
          record.consumedMessageIds !== undefined)
      )
        throw new HttpError(400, 'New tasks must be drafts')
      const parsed = decode(workspaceSchema.fields[patch.collection].value, record)
      if (patch.collection === 'tasks') this.validateProjectTask(decode(taskSchema, parsed))
      if (patch.collection === 'repositories' && 'kind' in record && record.kind === 'scratch')
        throw new HttpError(400, 'The scratch workspace is managed by Dovo')
      if (entity) {
        if (isDeepStrictEqual(entity, parsed)) return
        throw new HttpError(409, 'This item already exists. Refresh to load the latest version.')
      }
      this.update((w) => ({
        ...w,
        [patch.collection]: [...list, parsed],
      }))
      return
    }
    if (!entity) throw new HttpError(404, 'Item not found')
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
    const current = decode(
      Schema.mutable(
        Schema.Record({
          key: Schema.String,
          value: Schema.Unknown,
        }),
      ),
      entity,
    )
    if (patch.collection === 'repositories' && (patch.changes.kind || current.kind === 'scratch'))
      throw new HttpError(400, 'Cannot edit the managed project kind')
    const allowed =
      patch.collection === 'tasks'
        ? new Set([
            'title',
            'agentId',
            'repositoryId',
            'draft',
            'messages',
            'files',
            'pinned',
            'archived',
            'snoozedUntil',
            'linkedPullRequests',
            'ignoredPullRequestUrls',
            'agentOverrides',
            'harness',
            'execution',
            'existingWorktreePath',
            'worktreeBaseBranch',
            'worktreeFromOrigin',
            'setupCommand',
          ])
        : null
    let changed = false
    for (const [key, change] of Object.entries(patch.changes)) {
      if (key === 'id' || (allowed && !allowed.has(key)))
        throw new HttpError(400, `Cannot edit ${key}`)
      // A response can be lost after committing. Retrying that value is a no-op;
      // divergent values still need to satisfy the original optimistic precondition.
      if (isDeepStrictEqual(current[key] ?? null, change.after ?? null)) continue
      if (
        patch.collection === 'tasks' &&
        (key === 'execution' ||
          key === 'existingWorktreePath' ||
          key === 'repositoryId' ||
          key === 'worktreeBaseBranch' ||
          key === 'worktreeFromOrigin' ||
          key === 'setupCommand') &&
        'messages' in entity &&
        !canChangeTaskCheckout(entity)
      )
        throw new HttpError(409, 'Choose the working directory before sending the first message')
      if (
        patch.collection === 'tasks' &&
        current.status === 'running' &&
        ['agentId', 'agentOverrides', 'harness', 'repositoryId', 'archived'].includes(key)
      )
        throw new HttpError(409, 'Stop the active turn before changing task settings')
      // Sending consumes the draft outside workspace PATCH. A client may type its next
      // message before that clear reaches its snapshot; this is not a competing edit.
      const task =
        patch.collection === 'tasks'
          ? this.workspace.tasks.find((t) => t.id === patch.id)
          : undefined
      const previousDraft = typeof change.before === 'string' ? change.before.trim() : ''
      const consumedDraft =
        key === 'draft' &&
        current.draft === '' &&
        previousDraft !== '' &&
        !!task &&
        [
          [...task.messages].reverse().find((message) => message.role === 'user'),
          task.queue?.at(-1),
        ].some((message) => message?.text.trim() === previousDraft)
      if (!consumedDraft && !isDeepStrictEqual(current[key] ?? null, change.before ?? null))
        throw new HttpError(
          409,
          `Another client changed ${key}. Reconnect to load the latest version.`,
        )
      if (patch.collection === 'tasks' && key === 'messages') {
        const old = decode(mutableArray(Schema.Unknown), current.messages),
          next = decode(
            mutableArray(
              Schema.Struct(
                mutableStruct({
                  role: Schema.String,
                }).fields,
                {
                  key: Schema.String,
                  value: Schema.Unknown,
                },
              ),
            ),
            change.after,
          )
        if (
          next.length < old.length ||
          !isDeepStrictEqual(next.slice(0, old.length), old) ||
          next.slice(old.length).some((message) => message.role !== 'user')
        )
          throw new HttpError(400, 'Only new user messages may be appended')
      }
      current[key] = change.after ?? undefined
      changed = true
    }
    if (
      patch.collection === 'tasks' &&
      changed &&
      ['execution', 'existingWorktreePath', 'repositoryId'].some((key) => patch.changes[key])
    ) {
      // Reusing an existing checkout does not run new-worktree setup. Switching
      // away resets the runtime-owned setup marker for the next created checkout.
      current.worktreeSetupComplete =
        current.execution === 'worktree' && current.existingWorktreePath ? true : undefined
    }
    if (patch.collection === 'tasks' && current.archived === false) current.archivedAt = undefined
    if (!changed) return
    if (patch.collection === 'tasks') this.validateProjectTask(decode(taskSchema, current))
    this.update((w) => ({
      ...w,
      [patch.collection]: list.map((item) => (item.id === patch.id ? current : item)),
    }))
  }
}
