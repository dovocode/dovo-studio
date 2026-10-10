import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  decode,
  memoryEntrySchema,
  memoryPageSize,
  mutableStruct,
  resolveTaskAgent,
  type MemoryScope,
  type MemoryScopeRequest,
  type MemoryWrite,
  type MemoryDelete,
  type MemoryListRequest,
  type MemorySettings,
} from '@dovo/protocol'
import { Schema } from 'effect'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { RuntimePreferences } from '../storage/runtime-preferences.js'
import type { TaskCheckout } from '../scm/tasks/task-checkout.js'
import { HttpError } from '../errors.js'

const rowSchema = mutableStruct({
  ...memoryEntrySchema.fields,
  repositoryId: Schema.String,
})
const countSchema = mutableStruct({ total: Schema.Number })
const columns =
  'scope, repository_id AS repositoryId, key, content, revision, created_at AS createdAt, updated_at AS updatedAt'

/** Local, explicitly saved notes. Project identity comes from the registered project, never a worktree path. */
export class Memory {
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private preferences: RuntimePreferences,
    private checkouts: TaskCheckout,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS memories (
      scope TEXT NOT NULL, repository_id TEXT NOT NULL, key TEXT NOT NULL,
      content TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(scope, repository_id, key)
    )`)
  }
  settings(): MemorySettings {
    return this.preferences.get().memory
  }
  projects() {
    const projects = this.store
      .get()
      .repositories.filter((project) => project.kind !== 'scratch')
      .map((project) => ({ id: project.id, name: project.name, registered: true }))
    const removedIds = new Set(this.settings().projectRepositoryIds)
    for (const raw of this.db
      .prepare("SELECT DISTINCT repository_id AS id FROM memories WHERE scope='project'")
      .all()) {
      const { id } = decode(mutableStruct({ id: Schema.String }), raw)
      removedIds.add(id)
    }
    for (const id of removedIds) {
      if (!projects.some((project) => project.id === id))
        projects.push({ id, name: `Removed project (${id})`, registered: false })
    }
    return { projects }
  }
  private repository(input: MemoryScopeRequest, requireRegistered = false) {
    if (input.scope !== 'project') {
      if (input.repositoryId) throw new HttpError(400, 'Only project memory accepts a project')
      return ''
    }
    if (!input.repositoryId) throw new HttpError(400, 'Choose a project')
    const project = this.store.get().repositories.find((item) => item.id === input.repositoryId)
    if (project?.kind === 'scratch' || (requireRegistered && !project))
      throw new HttpError(400, 'Choose a registered project')
    return input.repositoryId
  }
  configure(input: MemoryScopeRequest & { enabled: boolean }) {
    const repositoryId = this.repository(input, input.enabled)
    const current = this.settings()
    const next =
      input.scope === 'project'
        ? {
            ...current,
            projectRepositoryIds: [
              ...new Set(
                input.enabled
                  ? [...current.projectRepositoryIds, repositoryId]
                  : current.projectRepositoryIds.filter((id) => id !== repositoryId),
              ),
            ],
          }
        : {
            ...current,
            [input.scope === 'system' ? 'systemEnabled' : 'projectlessEnabled']: input.enabled,
          }
    return this.preferences.save({ memory: next }).memory
  }
  private decodeRow(raw: unknown) {
    const row = decode(rowSchema, raw)
    return decode(memoryEntrySchema, { ...row, repositoryId: row.repositoryId || undefined })
  }
  list(input: MemoryListRequest) {
    const repositoryId = this.repository(input)
    const query = input.query?.trim() ?? ''
    const where =
      'scope=? AND repository_id=? AND (instr(lower(key),lower(?))>0 OR instr(lower(content),lower(?))>0)'
    const params = [input.scope, repositoryId, query, query]
    return {
      entries: this.db
        .prepare(`SELECT ${columns} FROM memories WHERE ${where} ORDER BY key LIMIT ? OFFSET ?`)
        .all(...params, memoryPageSize, input.offset ?? 0)
        .map((row) => this.decodeRow(row)),
      total: decode(
        countSchema,
        this.db.prepare(`SELECT count(*) AS total FROM memories WHERE ${where}`).get(...params),
      ).total,
    }
  }
  read(input: MemoryScopeRequest & { key: string }) {
    const repositoryId = this.repository(input)
    const row = this.db
      .prepare(`SELECT ${columns} FROM memories WHERE scope=? AND repository_id=? AND key=?`)
      .get(input.scope, repositoryId, input.key.trim())
    if (!row) throw new HttpError(404, 'Memory not found')
    return this.decodeRow(row)
  }
  write(input: MemoryWrite) {
    const repositoryId = this.repository(input)
    return this.db.transaction(() => {
      const key = input.key.trim()
      const row = this.db
        .prepare(`SELECT ${columns} FROM memories WHERE scope=? AND repository_id=? AND key=?`)
        .get(input.scope, repositoryId, key)
      const previous = row ? this.decodeRow(row) : undefined
      if (!previous) this.repository(input, true)
      if (previous && input.expectedRevision === undefined)
        throw new HttpError(409, 'A note with this key already exists. Open it to edit.')
      if (previous?.revision !== input.expectedRevision)
        throw new HttpError(409, 'Memory changed. Read its current revision before saving.')
      const now = new Date().toISOString()
      const entry = decode(memoryEntrySchema, {
        ...input,
        key,
        repositoryId: repositoryId || undefined,
        revision: randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      })
      this.db
        .prepare(`INSERT INTO memories VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(scope, repository_id, key) DO UPDATE SET content=excluded.content, revision=excluded.revision, updated_at=excluded.updated_at`)
        .run(
          entry.scope,
          repositoryId,
          key,
          entry.content,
          entry.revision,
          entry.createdAt,
          entry.updatedAt,
        )
      return entry
    })()
  }
  remove(input: MemoryDelete) {
    const repositoryId = this.repository(input)
    const result = this.db
      .prepare('DELETE FROM memories WHERE scope=? AND repository_id=? AND key=? AND revision=?')
      .run(input.scope, repositoryId, input.key.trim(), input.expectedRevision)
    if (!result.changes)
      throw new HttpError(409, 'Memory changed or was removed. Refresh before deleting it.')
    return { ok: true }
  }
  private projectForTask(taskId: string) {
    let task = this.store.task(taskId)
    const visited = new Set<string>()
    while (task.delegation) {
      if (visited.has(task.id)) throw new HttpError(400, 'Invalid child agent ancestry')
      visited.add(task.id)
      if (task.delegation.checkoutId) break
      task = this.store.task(task.delegation.parentTaskId)
    }
    if (!task.repositoryId && !task.delegation) return undefined
    const repository = this.checkouts.executionRepository(taskId)
    return repository.kind === 'scratch' ? undefined : repository
  }
  availableScopes(taskId: string): MemoryScope[] {
    const settings = this.settings()
    if (
      !settings.systemEnabled &&
      !settings.projectlessEnabled &&
      !settings.projectRepositoryIds.length
    )
      return []
    const project = this.projectForTask(taskId)
    return [
      ...(settings.systemEnabled ? ['system' as const] : []),
      ...(project && settings.projectRepositoryIds.includes(project.id)
        ? ['project' as const]
        : []),
      ...(!project && settings.projectlessEnabled ? ['projectless' as const] : []),
    ]
  }
  /** Agents can access enabled scopes of their execution project only; management UI can inspect disabled notes. */
  agentScope(taskId: string, scope: MemoryScope, write = false): MemoryScopeRequest {
    const task = this.store.task(taskId)
    if (!this.availableScopes(taskId).includes(scope))
      throw new HttpError(403, 'This memory scope is disabled or unavailable for this thread')
    if (write && resolveTaskAgent(task, this.store.get().agents)?.permission === 'read-only')
      throw new HttpError(403, 'Read-only agents cannot change memory')
    return {
      scope,
      ...(scope === 'project' ? { repositoryId: this.projectForTask(taskId)?.id } : {}),
    }
  }
}
