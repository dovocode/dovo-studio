import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  DO_LIMITS,
  decode,
  mutableArray,
  mutableStruct,
  taskFamilyRunToken,
  type DoItemResult,
  type DoRemoteDispatchRequest,
  type DoThreadObservation,
  type Task,
  type TaskSummary,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'

const rowSchema = Schema.UndefinedOr(
  mutableStruct({
    owner: Schema.String,
    task_id: Schema.NullOr(Schema.String),
    message_id: Schema.NullOr(Schema.String),
    stopped_message_id: Schema.NullOr(Schema.String),
    dispatched_message_id: Schema.NullOr(Schema.String),
  }),
)
const columnsSchema = mutableArray(mutableStruct({ name: Schema.String }))
type Row = NonNullable<typeof rowSchema.Type>
type ThreadServices = Pick<Services, 'store' | 'tasks' | 'approvals' | 'questions' | 'activity'>

/** Tail of the final agent message: conclusions come last. Never synthesized. */
function doResult(task: Task, after: number): DoItemResult | undefined {
  const message = task.messages
    .slice(after + 1)
    .reverse()
    .find((item) => item.role === 'assistant')
  const branch = task.turns?.at(-1)?.branch ?? task.checkoutBranch
  if (!message?.text.trim()) return undefined
  const text = message.text.trim()
  return {
    summary: text.length > DO_LIMITS.summary ? text.slice(-DO_LIMITS.summary) : text,
    source: 'agent-message',
    truncated: text.length > DO_LIMITS.summary,
    branch: branch ? branch.slice(0, 300) : undefined,
  }
}

/**
 * Threads created for Do work items, keyed by origin runtime, run and item. Local items use the
 * `local` owner; paired origins are namespaced by their runtime ID. A key owns at most one live
 * thread, and thread creation commits atomically with the key and the dispatching attempt, so
 * retrying a dispatch never duplicates the thread.
 */
export class DoThreads {
  private dispatching = new Set<string>()
  constructor(
    private db: Database.Database,
    private s: ThreadServices,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS do_threads (key TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT, message_id TEXT, stopped_message_id TEXT, dispatched_message_id TEXT, created_at TEXT NOT NULL)',
    )
    if (
      !decode(columnsSchema, db.prepare('PRAGMA table_info(do_threads)').all()).some(
        (column) => column.name === 'dispatched_message_id',
      )
    )
      db.exec('ALTER TABLE do_threads ADD COLUMN dispatched_message_id TEXT')
    db.exec('CREATE INDEX IF NOT EXISTS do_threads_task ON do_threads (task_id)')
  }
  /** Do reconciles its threads itself; generic restart continuation must leave them alone. */
  ownsTask(id: string) {
    return this.db.prepare('SELECT 1 FROM do_threads WHERE task_id=?').get(id) !== undefined
  }
  private row(owner: string, key: string) {
    const row = decode(
      rowSchema,
      this.db
        .prepare(
          'SELECT owner, task_id, message_id, stopped_message_id, dispatched_message_id FROM do_threads WHERE key=?',
        )
        .get(key),
    )
    if (row && row.owner !== owner)
      throw new HttpError(403, 'This Do work item belongs to another runtime')
    return row
  }
  private thread(row: Row | undefined) {
    return row?.task_id
      ? this.s.store.get().tasks.find((task) => task.id === row.task_id)
      : undefined
  }
  async dispatch(owner: string, input: DoRemoteDispatchRequest) {
    if (this.dispatching.has(input.key))
      throw new HttpError(409, 'This Do work item is already being dispatched')
    this.dispatching.add(input.key)
    try {
      return await this.dispatchItem(owner, input)
    } finally {
      this.dispatching.delete(input.key)
    }
  }
  private async dispatchItem(owner: string, input: DoRemoteDispatchRequest) {
    const row = this.row(owner, input.key)
    if (row?.stopped_message_id === input.messageId)
      throw new HttpError(409, 'This Do attempt was cancelled')
    const existing = this.thread(row)
    const execution =
      existing?.execution ??
      input.execution ??
      this.s.store.taskDefaults(input.repositoryId).execution
    if (execution !== 'worktree') {
      const others = decode(
        mutableArray(mutableStruct({ key: Schema.String, task_id: Schema.NullOr(Schema.String) })),
        this.db.prepare('SELECT key, task_id FROM do_threads WHERE key<>?').all(input.key),
      )
      const busy = others.some(({ key, task_id }) => {
        const task = this.s.store.get().tasks.find((candidate) => candidate.id === task_id)
        return (
          task &&
          task.repositoryId === input.repositoryId &&
          task.execution !== 'worktree' &&
          (this.dispatching.has(key) ||
            task.status === 'running' ||
            !!task.queue?.length ||
            this.s.tasks.hasWorkingFamily(task.id))
        )
      })
      if (busy) throw new HttpError(409, 'Another Do work item is using this project checkout')
    }
    // A thread deleted during this attempt stays deleted: re-sending the same attempt after a
    // lost reply or restart must not recreate it. Only a new attempt (a human retry) replaces it.
    if (row?.task_id && !existing && row.dispatched_message_id === input.messageId)
      return {
        created: false,
        observation: {
          key: input.key,
          status: 'failed' as const,
          taskId: row.task_id,
          messageId: input.messageId,
          error: 'The work item thread was deleted. Retry the item to start a new thread.',
        },
      }
    let taskId = existing?.id
    if (taskId)
      this.db
        .prepare('UPDATE do_threads SET dispatched_message_id=? WHERE key=?')
        .run(input.messageId, input.key)
    else {
      if (!this.s.store.get().repositories.some((repo) => repo.id === input.repositoryId))
        throw new HttpError(404, 'Project not found on this computer')
      if (
        input.agentId &&
        !this.s.store.agentsFor(input.repositoryId).some((agent) => agent.id === input.agentId)
      )
        throw new HttpError(404, 'Configured agent not found for this project')
      taskId = this.s.store.transaction(() => {
        const next = this.s.tasks.create({
          title: input.title,
          repositoryId: input.repositoryId,
          agentId: input.agentId ?? '',
          execution: input.execution,
          linkedCheckouts: input.linkedCheckouts,
          objective: '',
          origin: 'do',
        })
        this.db
          .prepare(
            'INSERT INTO do_threads (key, owner, task_id, message_id, stopped_message_id, dispatched_message_id, created_at) VALUES (?,?,?,NULL,NULL,?,?) ON CONFLICT(key) DO UPDATE SET task_id=excluded.task_id, message_id=NULL, dispatched_message_id=excluded.dispatched_message_id',
          )
          .run(input.key, owner, next.id, input.messageId, new Date().toISOString())
        return next.id
      })
    }
    // Message receipts make delivery idempotent, including after a restart.
    if (!this.s.tasks.queue.accepted(taskId, input.messageId, input.text))
      await runClientEffect(
        this.s.tasks.sendEffect(
          taskId,
          input.messageId,
          input.text,
          [],
          false,
          true,
          () => this.row(owner, input.key)?.stopped_message_id !== input.messageId,
        ),
      )
    this.db
      .prepare('UPDATE do_threads SET message_id=? WHERE key=?')
      .run(input.messageId, input.key)
    const created = !existing
    this.s.activity.add(
      'task',
      taskId,
      created ? 'Do work item started' : 'Do work item continued',
      { key: input.key, messageId: input.messageId },
    )
    return { created, observation: this.observe(owner, input.key) }
  }
  private attention(summary: TaskSummary) {
    if (this.s.approvals.list().some((item) => item.taskId === summary.id)) return 'approval'
    if (this.s.questions.list().some((item) => item.taskId === summary.id)) return 'question'
    return undefined
  }
  observe(owner: string, key: string): DoThreadObservation {
    const row = this.row(owner, key)
    const summary = this.thread(row)
    if (!row?.message_id || !summary) return { key, status: 'missing', taskId: summary?.id }
    const base = { key, taskId: summary.id, messageId: row.message_id }
    const attention = this.attention(summary)
    if (summary.status === 'running' || this.s.tasks.hasWorkingFamily(summary.id))
      return attention ? { ...base, status: 'waiting', attention } : { ...base, status: 'working' }
    if (attention) return { ...base, status: 'waiting', attention }
    if (summary.queue?.some((message) => message.id === row.message_id))
      return summary.queuePaused || summary.restartRecovery
        ? {
            ...base,
            status: 'waiting',
            attention: 'paused',
            error: summary.error?.slice(0, DO_LIMITS.reason),
          }
        : { ...base, status: 'queued' }
    if (summary.restartRecovery) return { ...base, status: 'waiting', attention: 'paused' }
    const task = this.s.store.task(summary.id)
    const index = task.messages.findIndex((message) => message.id === row.message_id)
    if (index < 0)
      return {
        ...base,
        status: 'failed',
        error: 'The Do message was removed before the agent received it',
      }
    const result = doResult(task, index)
    const turn = task.turns?.at(-1)
    const stopped = summary.status === 'cancelled' || turn?.status === 'cancelled'
    const error =
      summary.error ??
      turn?.error ??
      (stopped
        ? 'The thread was stopped before it finished'
        : summary.status === 'failed' || turn?.status === 'failed'
          ? 'The thread failed'
          : undefined)
    return error
      ? { ...base, status: 'failed', error: error.slice(0, DO_LIMITS.reason), result }
      : { ...base, status: 'finished', result }
  }
  /** Records the stopped attempt first, so a dispatch of it still in flight cannot start later. */
  stop(owner: string, key: string, messageId: string): 'confirmed' | 'requested' {
    const row = this.row(owner, key)
    this.db
      .prepare(
        'INSERT INTO do_threads (key, owner, task_id, message_id, stopped_message_id, dispatched_message_id, created_at) VALUES (?,?,NULL,NULL,?,NULL,?) ON CONFLICT(key) DO UPDATE SET stopped_message_id=excluded.stopped_message_id',
      )
      .run(key, owner, messageId, new Date().toISOString())
    const summary = this.thread(row)
    if (!summary) return this.dispatching.has(key) ? 'requested' : 'confirmed'
    if (summary.queue?.some((message) => message.id === messageId))
      this.s.tasks.queue.change(summary.id, 'remove', messageId)
    if (summary.status !== 'running' && !this.s.tasks.hasWorkingFamily(summary.id))
      return this.dispatching.has(key) ? 'requested' : 'confirmed'
    try {
      // Stopping a running turn also stops its children. An idle root can still have working
      // children; stop them as a family, as an automation step does.
      if (summary.activeRunId || summary.status === 'running')
        this.s.tasks.cancel(summary.id, summary.activeRunId)
      else {
        void this.s.tasks
          .stopAgents(summary.id, taskFamilyRunToken(this.s.store.get().tasks, summary.id))
          .catch((error: unknown) => console.error('Could not stop Do work item agents:', error))
        if (summary.status !== 'cancelled')
          this.s.store.updateTask(summary.id, (task) => ({
            ...task,
            status: 'cancelled',
            queuePaused: true,
            error: 'Do run cancelled while delegated work was unfinished',
          }))
      }
    } catch (error) {
      // 409: the turn or family changed while stopping. The stop stays requested, and the next
      // scheduler tick stops whatever is still working.
      if (!(error instanceof HttpError && error.status === 409)) throw error
    }
    // Stops repeat on every scheduler tick until confirmed; record only the first request.
    if (row?.stopped_message_id !== messageId)
      this.s.activity.add('task', summary.id, 'Do work item stop requested', { key })
    return 'requested'
  }
}
