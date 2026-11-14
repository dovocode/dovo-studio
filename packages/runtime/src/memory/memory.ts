import { permissionPolicyReadOnly } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  botContextMessages,
  searchTaskMessages,
  decode,
  memoryEntrySchema,
  memoryEvidenceSchema,
  type MemoryEvidence,
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
  expiresAt: Schema.NullOr(Schema.String),
  repositoryId: Schema.String,
})
const countSchema = mutableStruct({ total: Schema.Number })
const columns =
  'scope, repository_id AS repositoryId, key, content, revision, created_at AS createdAt, updated_at AS updatedAt, (SELECT expires_at FROM memory_retention WHERE scope=memories.scope AND repository_id=memories.repository_id AND key=memories.key) AS expiresAt'

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
    );
    CREATE TABLE IF NOT EXISTS bot_memory_evidence (bot_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(bot_id,key));
    CREATE TABLE IF NOT EXISTS bot_memory_forgotten (bot_id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(bot_id,key));`)
    db.exec(`CREATE TABLE IF NOT EXISTS memory_retention (
      scope TEXT NOT NULL, repository_id TEXT NOT NULL, key TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(scope, repository_id, key));
      CREATE TABLE IF NOT EXISTS memory_versions (
      scope TEXT NOT NULL, repository_id TEXT NOT NULL, key TEXT NOT NULL, revision TEXT NOT NULL,
      saved_at TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope, repository_id, key, revision));`)
  }
  settings(): MemorySettings {
    return this.preferences.get().memory
  }
  /** Only the coordinator can recall its own retained context. Reset ranges stay excluded. */
  searchBotHistory(taskId: string, query: string) {
    this.agentScope(taskId, 'bot')
    const task = this.store.task(taskId)
    return searchTaskMessages(
      [{ ...task, messages: botContextMessages(task.messages, task.bot) }],
      query,
      20,
    )
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
  /** Owner column: project id, Bot thread id, or empty for system/projectless notes. */
  private repository(input: MemoryScopeRequest, requireRegistered = false) {
    if (input.scope !== 'bot' && input.botId)
      throw new HttpError(400, 'Only bot memory accepts a Bot')
    if (input.scope === 'bot') {
      if (input.repositoryId) throw new HttpError(400, 'Bot memory does not accept a project')
      if (!input.botId) throw new HttpError(400, 'Choose a Bot')
      if (
        requireRegistered &&
        !this.store.get().tasks.some((task) => task.id === input.botId && task.bot)
      )
        throw new HttpError(404, 'Bot not found')
      return input.botId
    }
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
    if (input.scope === 'bot')
      throw new HttpError(400, 'Bot memory is always available to its Bot and has no switch')
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
    const { repositoryId, ...row } = decode(rowSchema, raw)
    const evidence =
      row.scope === 'bot'
        ? this.db
            .prepare('SELECT value FROM bot_memory_evidence WHERE bot_id=? AND key=?')
            .pluck()
            .get(repositoryId, row.key)
        : undefined
    return decode(memoryEntrySchema, {
      ...row,
      expiresAt: row.expiresAt ?? undefined,
      evidence:
        typeof evidence === 'string'
          ? decode(memoryEvidenceSchema, JSON.parse(evidence))
          : undefined,
      ...(row.scope === 'bot'
        ? { botId: repositoryId }
        : { repositoryId: repositoryId || undefined }),
    })
  }
  list(input: MemoryListRequest, activeOnly = false) {
    const repositoryId = this.repository(input)
    const query = input.query?.trim() ?? ''
    const where =
      'scope=? AND repository_id=? AND (instr(lower(key),lower(?))>0 OR instr(lower(content),lower(?))>0)' +
      (activeOnly
        ? ' AND NOT EXISTS (SELECT 1 FROM memory_retention r WHERE r.scope=memories.scope AND r.repository_id=memories.repository_id AND r.key=memories.key AND r.expires_at<=?)'
        : '')
    const params = [input.scope, repositoryId, query, query]
    if (activeOnly) params.push(new Date().toISOString())
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
    if (typeof input.expiresAt === 'string' && !Number.isFinite(Date.parse(input.expiresAt)))
      throw new HttpError(400, 'Enter a valid expiry date.')
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
      if (previous) {
        this.db
          .prepare('INSERT INTO memory_versions VALUES (?,?,?,?,?,?)')
          .run(input.scope, repositoryId, key, previous.revision, now, JSON.stringify(previous))
        this.db
          .prepare(`DELETE FROM memory_versions WHERE scope=? AND repository_id=? AND key=? AND revision NOT IN
          (SELECT revision FROM memory_versions WHERE scope=? AND repository_id=? AND key=? ORDER BY saved_at DESC, rowid DESC LIMIT 10)`)
          .run(input.scope, repositoryId, key, input.scope, repositoryId, key)
      }
      const expiresAt =
        input.expiresAt === undefined ? previous?.expiresAt : (input.expiresAt ?? undefined)
      const entry = decode(memoryEntrySchema, {
        ...input,
        key,
        repositoryId: input.scope === 'project' ? repositoryId : undefined,
        botId: input.scope === 'bot' ? repositoryId : undefined,
        evidence: undefined,
        expiresAt,
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
      if (input.scope === 'bot') {
        this.db
          .prepare('DELETE FROM bot_memory_evidence WHERE bot_id=? AND key=?')
          .run(repositoryId, key)
      }
      if (expiresAt)
        this.db
          .prepare('INSERT OR REPLACE INTO memory_retention VALUES (?,?,?,?)')
          .run(input.scope, repositoryId, key, expiresAt)
      else
        this.db
          .prepare('DELETE FROM memory_retention WHERE scope=? AND repository_id=? AND key=?')
          .run(input.scope, repositoryId, key)
      return entry
    })()
  }
  remove(input: MemoryDelete) {
    const repositoryId = this.repository(input)
    return this.db.transaction(() => {
      const result = this.db
        .prepare('DELETE FROM memories WHERE scope=? AND repository_id=? AND key=? AND revision=?')
        .run(input.scope, repositoryId, input.key.trim(), input.expectedRevision)
      if (!result.changes)
        throw new HttpError(409, 'Memory changed or was removed. Refresh before deleting it.')
      for (const table of ['memory_versions', 'memory_retention'])
        this.db
          .prepare(`DELETE FROM ${table} WHERE scope=? AND repository_id=? AND key=?`)
          .run(input.scope, repositoryId, input.key.trim())
      if (input.scope === 'bot') {
        this.db
          .prepare('DELETE FROM bot_memory_evidence WHERE bot_id=? AND key=?')
          .run(repositoryId, input.key.trim())
        this.db
          .prepare('INSERT OR IGNORE INTO bot_memory_forgotten VALUES (?,?)')
          .run(repositoryId, input.key.trim())
      }
      return { ok: true }
    })()
  }
  /** Complete bounded Bot snapshot for atomic reviews; ordinary lists remain paginated. */
  botNotes(botId: string) {
    return this.db
      .prepare(`SELECT ${columns} FROM memories WHERE scope='bot' AND repository_id=? ORDER BY key`)
      .all(botId)
      .map((row) => this.decodeRow(row))
      .filter((note) => !note.expiresAt || Date.parse(note.expiresAt) > Date.now())
  }
  versions(input: MemoryScopeRequest & { key: string }) {
    const repositoryId = this.repository(input)
    this.read(input)
    const rows = this.db
      .prepare(
        'SELECT value FROM memory_versions WHERE scope=? AND repository_id=? AND key=? ORDER BY saved_at DESC, rowid DESC LIMIT 10',
      )
      .pluck()
      .all(input.scope, repositoryId, input.key.trim())
    return {
      entries: rows.map((value) =>
        decode(memoryEntrySchema, JSON.parse(decode(Schema.String, value))),
      ),
    }
  }
  forgotten(botId: string, key: string) {
    return !!this.db
      .prepare('SELECT 1 FROM bot_memory_forgotten WHERE bot_id=? AND key=?')
      .get(botId, key)
  }
  saveEvidence(botId: string, key: string, evidence: MemoryEvidence) {
    this.db
      .prepare('INSERT OR REPLACE INTO bot_memory_evidence VALUES (?,?,?)')
      .run(botId, key, JSON.stringify(decode(memoryEvidenceSchema, evidence)))
  }
  clearBot(botId: string) {
    this.repository({ scope: 'bot', botId }, true)
    for (const raw of this.db
      .prepare("SELECT key FROM memories WHERE scope='bot' AND repository_id=?")
      .all(botId)) {
      const note = decode(mutableStruct({ key: Schema.String }), raw)
      this.db
        .prepare('INSERT OR IGNORE INTO bot_memory_forgotten VALUES (?,?)')
        .run(botId, note.key)
    }
    this.db.prepare("DELETE FROM memories WHERE scope='bot' AND repository_id=?").run(botId)
    this.db.prepare('DELETE FROM bot_memory_evidence WHERE bot_id=?').run(botId)
    for (const table of ['memory_versions', 'memory_retention'])
      this.db.prepare(`DELETE FROM ${table} WHERE scope='bot' AND repository_id=?`).run(botId)
  }
  private projectForTask(taskId: string) {
    let task = this.store.taskSummary(taskId)
    const visited = new Set<string>()
    while (task.delegation) {
      if (visited.has(task.id)) throw new HttpError(400, 'Invalid child agent ancestry')
      visited.add(task.id)
      if (task.delegation.checkoutId) break
      task = this.store.taskSummary(task.delegation.parentTaskId)
    }
    if (!task.repositoryId && !task.delegation) return undefined
    const repository = this.checkouts.executionRepository(taskId)
    return repository.kind === 'scratch' ? undefined : repository
  }
  /** Deleting a Bot removes its private notes with it. */
  removeBot(botId: string) {
    this.db
      .prepare('DELETE FROM documents WHERE id>=? AND id<?')
      .run(`bot-routine-finding:${botId}:`, `bot-routine-finding:${botId};`)
    for (const table of ['memory_versions', 'memory_retention'])
      this.db.prepare(`DELETE FROM ${table} WHERE scope='bot' AND repository_id=?`).run(botId)
    this.db
      .prepare('DELETE FROM documents WHERE id >= ? AND id < ?')
      .run('bot-skill-proposal:' + botId + ':', 'bot-skill-proposal:' + botId + ';')
    this.db.prepare("DELETE FROM memories WHERE scope='bot' AND repository_id=?").run(botId)
    this.db.prepare('DELETE FROM bot_memory_evidence WHERE bot_id=?').run(botId)
    this.db.prepare('DELETE FROM bot_memory_forgotten WHERE bot_id=?').run(botId)
    this.db.prepare('DELETE FROM documents WHERE id=?').run(`bot-memory-review:${botId}`)
  }
  availableScopes(taskId: string): MemoryScope[] {
    const settings = this.settings()
    // Private Bot memory belongs to the coordinator thread only, never to its children.
    const bot = this.store.taskSummary(taskId).bot ? (['bot'] as const) : []
    if (
      !settings.systemEnabled &&
      !settings.projectlessEnabled &&
      !settings.projectRepositoryIds.length
    )
      return [...bot]
    const project = this.projectForTask(taskId)
    return [
      ...bot,
      ...(settings.systemEnabled ? ['system' as const] : []),
      ...(project && settings.projectRepositoryIds.includes(project.id)
        ? ['project' as const]
        : []),
      ...(!project && settings.projectlessEnabled ? ['projectless' as const] : []),
    ]
  }
  /** Agents can access enabled scopes of their execution project only; management UI can inspect disabled notes. */
  agentScope(taskId: string, scope: MemoryScope, write = false): MemoryScopeRequest {
    const task = this.store.taskSummary(taskId)
    if (!this.availableScopes(taskId).includes(scope))
      throw new HttpError(403, 'This memory scope is disabled or unavailable for this thread')
    if (write && permissionPolicyReadOnly(resolveTaskAgent(task, this.store.get().agents)))
      throw new HttpError(403, 'Read-only agents cannot change memory')
    return {
      scope,
      ...(scope === 'project' ? { repositoryId: this.projectForTask(taskId)?.id } : {}),
      ...(scope === 'bot' ? { botId: taskId } : {}),
    }
  }
}
