import { migrateJiraSources } from './jira-migration.js'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import {
  canChangeTaskCheckout,
  latestCompletedTaskTurn,
  lockedTaskProvider,
  resolveTaskAgent,
  workspaceSchema,
  type Workspace,
  type WorkspacePatch,
  type Task,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { isDeepStrictEqual } from 'node:util'
const rowSchema = z.object({ value: z.string() })
export class WorkspaceStore {
  private workspace: Workspace
  private revision = 0
  constructor(
    private readonly db: Database.Database,
    private onUpdate?: (before: Workspace, after: Workspace) => void,
  ) {
    const row = db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')
    this.workspace = row
      ? workspaceSchema.parse(JSON.parse(rowSchema.parse(row).value))
      : { version: 1, agents: [], repositories: [], tasks: [], automations: [], runtimeAddress: '' }
    this.update((w) => ({
      ...w,
      tasks: w.tasks
        .filter((task) => !task.example)
        .map((task) =>
          task.status === 'running'
            ? {
                ...task,
                status: 'failed',
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
                error: 'Runtime stopped while this task was running. Resume to continue.',
              }
            : task.queue?.length
              ? { ...task, queuePaused: true }
              : task,
        ),
    }))
  }
  get() {
    return this.workspace
  }
  version() {
    return this.revision
  }
  update(fn: (workspace: Workspace) => Workspace) {
    const parsed = migrateJiraSources(workspaceSchema.parse(fn(this.workspace)))
    const previousTasks = new Map(this.workspace.tasks.map((task) => [task.id, task]))
    const next = {
      ...parsed,
      tasks: parsed.tasks
        .filter((task) => !task.example)
        .map((task) => {
          const previous = previousTasks.get(task.id)
          const locked = previous ? lockedTaskProvider(previous, this.workspace.agents) : undefined
          const provider = resolveTaskAgent(task, parsed.agents)?.provider
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
          const providerLock = locked ?? lockedTaskProvider(task, parsed.agents)
          const updated =
            previous?.status === 'running' && task.status !== 'running'
              ? {
                  ...task,
                  subagents: task.subagents?.map((agent) =>
                    agent.status === 'working' ? { ...agent, status: 'unknown' as const } : agent,
                  ),
                }
              : task
          return providerLock ? { ...updated, providerLock } : updated
        }),
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
        )
        .run('workspace', JSON.stringify(next))
      this.onUpdate?.(this.workspace, next)
    })()
    this.workspace = next
    this.revision++
    return next
  }
  task(id: string) {
    const task = this.workspace.tasks.find((t) => t.id === id)
    if (!task) throw new HttpError(404, 'Task not found')
    return task
  }
  updateTask(id: string, fn: (task: Task) => Task) {
    this.update((w) => ({
      ...w,
      tasks: w.tasks.map((t) =>
        t.id === id ? { ...fn(t), updatedAt: new Date().toISOString() } : t,
      ),
    }))
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
  patch(patch: WorkspacePatch) {
    const list = this.workspace[patch.collection]
    const entity = list.find((item) => item.id === patch.id)
    if (patch.create !== undefined) {
      const record = z.object({ id: z.string() }).passthrough().parse(patch.create)
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
          record.lastViewedTurnId !== undefined ||
          record.viewedRevision !== undefined ||
          record.turns !== undefined ||
          record.subagents !== undefined ||
          record.archivedAt !== undefined ||
          record.queue !== undefined ||
          record.consumedMessageIds !== undefined)
      )
        throw new HttpError(400, 'New tasks must be drafts')
      const parsed = workspaceSchema.shape[patch.collection].element.parse(record)
      if (entity) {
        if (isDeepStrictEqual(entity, parsed)) return
        throw new HttpError(409, 'This item already exists. Refresh to load the latest version.')
      }
      this.update((w) => ({ ...w, [patch.collection]: [...list, parsed] }))
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
    const current = z.record(z.string(), z.unknown()).parse(entity)
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
            'agentOverrides',
            'harness',
            'execution',
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
        (key === 'execution' || key === 'repositoryId') &&
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
      if (!isDeepStrictEqual(current[key] ?? null, change.before ?? null))
        throw new HttpError(
          409,
          `Another client changed ${key}. Reconnect to load the latest version.`,
        )
      if (patch.collection === 'tasks' && key === 'messages') {
        const old = z.array(z.unknown()).parse(current.messages),
          next = z.array(z.object({ role: z.string() }).passthrough()).parse(change.after)
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
    if (patch.collection === 'tasks' && current.archived === false) current.archivedAt = undefined
    if (!changed) return
    this.update((w) => ({
      ...w,
      [patch.collection]: list.map((item) => (item.id === patch.id ? current : item)),
    }))
  }
}
