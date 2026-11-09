import type Database from 'better-sqlite3'
import { hostname } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { Schema } from 'effect'
import { compareVersions, nextRevision, type StateStorage } from '@dovo/durable-connections'
import {
  decode,
  mutableStruct,
  mutableArray,
  threadRecordSchema,
  messageSchema,
  threadRecordKey,
  threadReplicationChannel,
  validateThreadVersion,
  recoverThreadParentVersion,
  replicatedThreadList,
  replicatedThread,
  ThreadHistoryChangedError,
  taskSearchNeedle,
  taskSearchTerms,
  taskSearchText,
  taskSearchHit,
  taskSearchOrder,
  type TaskSearchResult,
  type ThreadRecord,
  type ThreadVersion,
  type Task,
  type TaskSummary,
  type WorkspaceSummary,
} from '@dovo/protocol'
import type { WorkspaceChange, WorkspaceStore } from './workspace.js'
import { replicationIdentity } from './replication-identity.js'

const versionSchema = mutableStruct({
  key: Schema.String,
  updatedAt: Schema.Int,
  changeId: Schema.String,
  deleted: Schema.Literal(false),
  value: threadRecordSchema,
})
const rowSchema = Schema.UndefinedOr(mutableStruct({ value: Schema.String }))
const rowsSchema = mutableArray(mutableStruct({ sequence: Schema.Int, value: Schema.String }))
const snapshotSchema = mutableStruct({
  protocol: Schema.Literal(1),
  channel: Schema.Literal(threadReplicationChannel),
  replicaId: Schema.String,
  journal: mutableArray(mutableStruct({ sequence: Schema.Int, version: versionSchema })),
  checkpoints: Schema.Record(Schema.String, Schema.Int),
  sources: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

/** Domain changes enter this archive in the workspace transaction. The generic replica imports
 * this immutable outbox after commit; it can never miss edits accepted before a restart. */
export class ThreadReplicationJournal {
  readonly generation?: string
  readonly replicaId: string
  private summaries?: { revision: number; tasks: Task[] }
  private disabled = false
  private initializationFailed = false
  disable() {
    this.disabled = true
  }
  constructor(
    private db: Database.Database,
    readonly runtimeId: string,
  ) {
    this.replicaId = runtimeId
    try {
      const identity = replicationIdentity(db, runtimeId)
      this.generation = identity.generation
      this.replicaId = identity.source
      db.exec(`CREATE TABLE IF NOT EXISTS thread_versions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL UNIQUE, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_registers (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_state_log (sequence INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_state_sequences ON thread_state_log(sequence);
      CREATE INDEX IF NOT EXISTS thread_versions_clock ON thread_versions(json_extract(value,'$.updatedAt'));
      CREATE INDEX IF NOT EXISTS thread_versions_metadata_revision ON thread_versions(sequence)
        WHERE json_extract(value,'$.value.kind')!='message';
      CREATE INDEX IF NOT EXISTS thread_registers_thread ON thread_registers(
        json_extract(value,'$.value.ownerRuntimeId'),json_extract(value,'$.value.threadId'),json_extract(value,'$.value.kind'));
      CREATE INDEX IF NOT EXISTS thread_registers_history ON thread_registers(
        json_extract(value,'$.value.ownerRuntimeId'),json_extract(value,'$.value.threadId'),
        json_extract(value,'$.value.kind'),json_extract(value,'$.value.position'),json_extract(value,'$.value.messageId'));
      CREATE INDEX IF NOT EXISTS thread_registers_metadata ON thread_registers(
        json_extract(value,'$.value.ownerRuntimeId'),json_extract(value,'$.value.threadId'))
        WHERE json_extract(value,'$.value.kind')!='message';
      CREATE TABLE IF NOT EXISTS thread_search (key TEXT PRIMARY KEY, search_text TEXT NOT NULL)`)
      if (!db.prepare("SELECT 1 FROM documents WHERE id='thread-search:v1'").get()) {
        db.transaction(() => {
          db.prepare('DELETE FROM thread_search').run()
          for (const version of this.rows(
            "SELECT value FROM thread_registers WHERE json_extract(value,'$.value.kind')='message'",
          ))
            this.indexMessage(version)
          db.prepare("INSERT INTO documents VALUES ('thread-search:v1','true')").run()
        })()
      }
    } catch {
      // Index creation can encounter unreadable legacy records before start() runs.
      // Keep their tables intact and let the channel report its startup failure.
      this.initializationFailed = true
      this.disabled = true
    }
  }
  private identity(version: ThreadVersion) {
    return JSON.stringify([version.key, version.updatedAt, version.changeId])
  }
  private rows(query: string, ...params: string[]): ThreadVersion[] {
    return decode(
      mutableArray(mutableStruct({ value: Schema.String })),
      this.db.prepare(query).all(...params),
    ).map((row) => decode(versionSchema, JSON.parse(row.value)))
  }
  current(): ThreadVersion[] {
    return this.rows('SELECT value FROM thread_registers ORDER BY key')
  }
  thread(owner: string, id: string) {
    return this.rows(
      "SELECT value FROM thread_registers WHERE json_extract(value,'$.value.ownerRuntimeId')=? AND json_extract(value,'$.value.threadId')=? ORDER BY key",
      owner,
      id,
    )
  }
  private get(key: string) {
    const row = decode(
      rowSchema,
      this.db.prepare('SELECT value FROM thread_registers WHERE key=?').get(key),
    )
    return row ? decode(versionSchema, JSON.parse(row.value)) : undefined
  }
  private indexMessage(version: ThreadVersion) {
    if (version.deleted || version.value.kind !== 'message') return
    if (version.value.message)
      this.db
        .prepare(
          'INSERT INTO thread_search VALUES (?,?) ON CONFLICT(key) DO UPDATE SET search_text=excluded.search_text',
        )
        .run(version.key, taskSearchText(version.value.message.text))
    else this.db.prepare('DELETE FROM thread_search WHERE key=?').run(version.key)
  }
  private merge(version: ThreadVersion) {
    validateThreadVersion(version)
    const encoded = JSON.stringify(version)
    const existing = decode(
      rowSchema,
      this.db
        .prepare('SELECT value FROM thread_versions WHERE identity=?')
        .get(this.identity(version)),
    )
    if (existing && existing.value !== encoded)
      throw new Error('A replicated thread revision was reused')
    this.db
      .prepare('INSERT OR IGNORE INTO thread_versions(identity,value) VALUES (?,?)')
      .run(this.identity(version), encoded)
    const previous = this.get(version.key)
    if (!previous || compareVersions(version, previous) > 0) {
      this.indexMessage(version)
      this.db
        .prepare(
          'INSERT INTO thread_registers VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        )
        .run(version.key, encoded)
    }
  }
  record(value: ThreadRecord) {
    const normalized = decode(threadRecordSchema, value)
    const key = threadRecordKey(normalized)
    const previous = this.get(key)
    if (
      previous &&
      !previous.deleted &&
      JSON.stringify(previous.value) === JSON.stringify(normalized)
    )
      return
    const latest = this.db
      .prepare("SELECT MAX(json_extract(value,'$.updatedAt')) FROM thread_versions")
      .pluck()
      .get()
    const updatedAt = nextRevision(
      previous ? [previous] : [],
      Math.max(Date.now(), typeof latest === 'number' ? latest + 1 : 0),
    )
    this.merge({
      key,
      updatedAt,
      changeId: `${this.replicaId}:${updatedAt}`,
      deleted: false,
      value: normalized,
    })
  }
  private descriptorRevision(threadId: string) {
    const entry = this.get(JSON.stringify([this.runtimeId, threadId, 'thread']))
    return entry && !entry.deleted && entry.value.kind === 'thread'
      ? entry.value.historyRevision
      : 0
  }
  private descriptor(
    task: TaskSummary | Task,
    workspace: WorkspaceSummary,
    removed: boolean,
  ): ThreadRecord {
    return {
      ownerRuntimeId: this.runtimeId,
      threadId: task.id,
      kind: 'thread',
      ownerName: hostname().slice(0, 200),
      projectName: (
        workspace.repositories.find((repo) => repo.id === task.repositoryId)?.name ?? 'General'
      ).slice(0, 400),
      createdAt: task.createdAt,
      status: task.status,
      archived: task.archived ?? false,
      ...(task.archivedAt ? { archivedAt: task.archivedAt } : {}),
      historyRevision: Math.max(task.historyRevision ?? 0, this.descriptorRevision(task.id)),
      removed,
      ...(task.delegation
        ? { parent: { runtimeId: this.runtimeId, threadId: task.delegation.parentTaskId } }
        : task.spawnParent
          ? {
              parent: {
                runtimeId: task.spawnParent.runtimeId,
                threadId: task.spawnParent.threadId,
              },
            }
          : {}),
    }
  }
  private metadata(task: TaskSummary | Task, previous?: TaskSummary | Task) {
    const identity = { ownerRuntimeId: this.runtimeId, threadId: task.id }
    if (!previous || previous.title !== task.title)
      this.record({ ...identity, kind: 'title', value: task.title.slice(0, 2000) })
    if (!previous || previous.pinned !== task.pinned)
      this.record({ ...identity, kind: 'pinned', value: task.pinned ?? false })
    if (!previous || previous.snoozedUntil !== task.snoozedUntil)
      this.record({ ...identity, kind: 'snoozedUntil', value: task.snoozedUntil ?? null })
  }
  private history(task: Task, previous?: Task) {
    const identity = { ownerRuntimeId: this.runtimeId, threadId: task.id }
    let reset = false
    const recordMessage = (value: Extract<ThreadRecord, { kind: 'message' }>) => {
      const existing = this.get(threadRecordKey(value))
      if (
        existing &&
        !existing.deleted &&
        existing.value.kind === 'message' &&
        existing.value.message &&
        JSON.stringify(existing.value) !== JSON.stringify(value)
      )
        reset = true
      this.record(value)
    }
    const retained = new Set(task.messages.map((message) => message.id))
    const old = new Map(
      previous?.messages.map((message, position) => [message.id, { message, position }]),
    )
    task.messages.forEach((message, position) => {
      // Streaming stays on the existing live stream. Archive a completed message once, rather
      // than retaining a complete copy for every token. User input is durable immediately.
      const running =
        message.turnId &&
        task.turns?.some((turn) => turn.id === message.turnId && turn.status === 'running')
      if (
        message.role === 'assistant' &&
        task.status === 'running' &&
        (running || position === task.messages.length - 1)
      )
        return
      const prior = old.get(message.id)
      if (
        prior?.message === message &&
        prior.position === position &&
        !(
          message.role === 'assistant' &&
          previous?.status === 'running' &&
          (task.status !== 'running' || prior.position === previous.messages.length - 1)
        )
      )
        return
      recordMessage({
        ...identity,
        kind: 'message',
        messageId: message.id,
        position,
        message: {
          id: message.id,
          role: message.role,
          text:
            message.text.length <= 1024 * 1024
              ? message.text
              : message.text.slice(0, 1024 * 1024) +
                '\n[Shared copy shortened; the full message is on the owning runtime.]',
          ...(message.createdAt ? { createdAt: message.createdAt } : {}),
        },
      })
    })
    previous?.messages.forEach((message, position) => {
      if (!retained.has(message.id))
        recordMessage({
          ...identity,
          kind: 'message',
          messageId: message.id,
          position,
          message: null,
        })
    })
    if (reset) {
      const descriptor = this.get(JSON.stringify([this.runtimeId, task.id, 'thread']))
      if (descriptor && !descriptor.deleted && descriptor.value.kind === 'thread')
        this.record({ ...descriptor.value, historyRevision: descriptor.value.historyRevision + 1 })
    }
  }
  capture(change: WorkspaceChange) {
    if (this.disabled) return
    const before = new Map(change.before.tasks.map((task) => [task.id, task]))
    for (const task of change.after.tasks) {
      if (task.example || task.replica) continue
      const previous = before.get(task.id)
      if (previous === task && change.before.repositories === change.after.repositories) continue
      if (
        !previous ||
        JSON.stringify(this.descriptor(previous, change.before, false)) !==
          JSON.stringify(this.descriptor(task, change.after, false))
      ) {
        this.record(this.descriptor(task, change.after, false))
      }
      this.metadata(task, previous)
      const history = change.histories.get(task.id)
      if (history) this.history(history.after, history.before)
      else if (previous?.status === 'running' && task.status !== 'running') {
        // A completion may update metadata only. History is already committed in this same
        // transaction; read it once at finalization, never on a token or ordinary title edit.
        const messages = decode(
          mutableArray(mutableStruct({ value: Schema.String })),
          this.db
            .prepare(
              "SELECT value FROM conversation_items WHERE task_id=? AND kind='message' ORDER BY ordinal",
            )
            .all(task.id),
        ).map((row) => decode(messageSchema, JSON.parse(row.value)))
        this.history({ ...task, messages })
      }
    }
    const retained = new Set(change.after.tasks.map((task) => task.id))
    for (const task of change.before.tasks)
      if (!task.example && !task.replica && !retained.has(task.id))
        this.record(this.descriptor(task, change.before, true))
  }
  seed(store: WorkspaceStore) {
    if (this.initializationFailed)
      throw new Error('Thread replication storage could not initialize')
    const seeded = !!this.db
      .prepare("SELECT 1 FROM documents WHERE id='thread-replication-seeded:v1'")
      .get()
    if (
      seeded &&
      this.db.prepare("SELECT 1 FROM documents WHERE id='thread-replication-parents:v1'").get()
    )
      return
    store.transaction(() => {
      const workspace = store.get()
      for (const task of workspace.tasks) {
        if (task.example || task.replica) continue
        this.record(this.descriptor(task, workspace, false))
        if (!seeded) {
          this.metadata(task)
          this.history(store.task(task.id))
        }
      }
      this.db
        .prepare("INSERT OR IGNORE INTO documents VALUES ('thread-replication-seeded:v1','true')")
        .run()
      this.db
        .prepare("INSERT OR IGNORE INTO documents VALUES ('thread-replication-parents:v1','true')")
        .run()
    })
  }
  versions(after: number) {
    return decode(
      rowsSchema,
      this.db
        .prepare('SELECT sequence,value FROM thread_versions WHERE sequence>? ORDER BY sequence')
        .all(after),
    ).map((row) => ({
      sequence: row.sequence,
      version: decode(versionSchema, JSON.parse(row.value)),
    }))
  }
  version() {
    const value = this.db
      .prepare('SELECT COALESCE(MAX(sequence),0) FROM thread_versions')
      .pluck()
      .get()
    if (typeof value !== 'number') throw new Error('Invalid thread journal revision')
    return value
  }
  has(version: ThreadVersion) {
    const row = decode(
      rowSchema,
      this.db
        .prepare('SELECT value FROM thread_versions WHERE identity=?')
        .get(this.identity(version)),
    )
    if (!row) return false
    const previous = decode(versionSchema, JSON.parse(row.value))
    return isDeepStrictEqual(previous, version) || !!recoverThreadParentVersion(previous, version)
  }
  storage(store: WorkspaceStore): StateStorage {
    const append: NonNullable<StateStorage['append']> = (
      after,
      rawChanges,
      checkpoints,
      sources,
      repairs = [],
    ) => {
      const changes = decode(snapshotSchema.fields.journal, rawChanges)
      store.transaction(() => {
        const count = this.db.prepare('SELECT COUNT(*) FROM thread_state_log').pluck().get()
        if (count !== after) throw new Error('Thread journal history changed')
        if (changes.some((change, index) => change.sequence !== after + index + 1))
          throw new Error('Invalid thread journal sequence')
        const changed = new Map<string, ThreadVersion>()
        for (const repair of repairs) {
          const previous = decode(versionSchema, repair.previous)
          const version = decode(versionSchema, repair.version)
          if (!isDeepStrictEqual(recoverThreadParentVersion(previous, version), version))
            throw new Error('Invalid thread parent recovery')
          const identity = this.identity(version)
          const stored = decode(
            rowSchema,
            this.db.prepare('SELECT value FROM thread_versions WHERE identity=?').get(identity),
          )
          if (!stored || !isDeepStrictEqual(JSON.parse(stored.value), previous))
            throw new Error('Thread recovery history changed')
          const encoded = JSON.stringify(version)
          this.db
            .prepare('UPDATE thread_versions SET value=? WHERE identity=?')
            .run(encoded, identity)
          this.db
            .prepare(
              "UPDATE thread_state_log SET value=? WHERE json_extract(value,'$.key')=? AND json_extract(value,'$.updatedAt')=? AND json_extract(value,'$.changeId')=?",
            )
            .run(encoded, version.key, version.updatedAt, version.changeId)
          const current = this.get(version.key)
          if (current && this.identity(current) === identity)
            this.db
              .prepare('UPDATE thread_registers SET value=? WHERE key=?')
              .run(encoded, version.key)
          this.summaries = undefined
        }
        const insert = this.db.prepare('INSERT INTO thread_state_log VALUES (?,?)')
        for (const change of changes) {
          insert.run(change.sequence, JSON.stringify(change.version))
          const previous = this.get(change.version.key)
          if (!previous || compareVersions(change.version, previous) > 0)
            changed.set(change.version.key, change.version)
          this.merge(change.version)
        }
        this.db
          .prepare(
            "INSERT INTO documents VALUES ('thread-state-checkpoints:v1',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify(checkpoints))
        this.db
          .prepare(
            "INSERT INTO documents VALUES ('thread-state-sources:v1',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify(sources ?? {}))
        const local = new Map(store.get().tasks.map((task) => [task.id, task]))
        // Locally captured records are already authoritative. Apply only newly winning
        // edits, never normalize the owner back from its bounded shared projection.
        for (const version of changed.values()) {
          if (version.deleted || version.value.ownerRuntimeId !== this.runtimeId) continue
          const value = version.value,
            task = local.get(value.threadId)
          if (!task || task.replica) continue
          if (value.kind === 'title' && task.title !== value.value)
            local.set(task.id, { ...task, title: value.value })
          if (value.kind === 'pinned' && (task.pinned ?? false) !== value.value)
            local.set(task.id, { ...task, pinned: value.value })
          if (value.kind === 'snoozedUntil' && (task.snoozedUntil ?? null) !== value.value)
            local.set(task.id, { ...task, snoozedUntil: value.value })
        }
        if (store.get().tasks.some((task) => local.get(task.id) !== task))
          store.update((workspace) => ({
            ...workspace,
            tasks: workspace.tasks.map((task) => local.get(task.id) ?? task),
          }))
      })
    }
    const read = (after: number) => {
      const count = this.db.prepare('SELECT COUNT(*) FROM thread_state_log').pluck().get()
      if (typeof count !== 'number' || count < after)
        throw new Error('Thread journal history changed')
      const checkpoints = decode(
        rowSchema,
        this.db.prepare("SELECT value FROM documents WHERE id='thread-state-checkpoints:v1'").get(),
      )
      const rows = decode(
        rowsSchema,
        this.db
          .prepare('SELECT sequence,value FROM thread_state_log WHERE sequence>? ORDER BY sequence')
          .all(after),
      )
      const sources = decode(
        rowSchema,
        this.db.prepare("SELECT value FROM documents WHERE id='thread-state-sources:v1'").get(),
      )
      if (rows.length !== count - after) throw new Error('Thread journal history changed')
      return {
        protocol: 1,
        channel: threadReplicationChannel,
        replicaId: this.replicaId,
        after,
        journal: rows.map((row) => ({ sequence: row.sequence, version: JSON.parse(row.value) })),
        checkpoints: checkpoints ? JSON.parse(checkpoints.value) : {},
        ...(sources ? { sources: JSON.parse(sources.value) } : {}),
      }
    }
    return {
      load: () => read(0),
      readChanges: read,
      append,
      save: (raw) => {
        const snapshot = decode(snapshotSchema, raw)
        const count = this.db.prepare('SELECT COUNT(*) FROM thread_state_log').pluck().get()
        if (typeof count !== 'number' || count > snapshot.journal.length)
          throw new Error('Thread journal history changed')
        return append(count, snapshot.journal.slice(count), snapshot.checkpoints, snapshot.sources)
      },
    }
  }
  page(owner: string, id: string, before?: string) {
    const metadata = this.rows(
      "SELECT value FROM thread_registers WHERE json_extract(value,'$.value.ownerRuntimeId')=? AND json_extract(value,'$.value.threadId')=? AND json_extract(value,'$.value.kind')!='message'",
      owner,
      id,
    )
    const cursor =
      before === undefined ? undefined : this.get(JSON.stringify([owner, id, 'message', before]))
    if (
      before !== undefined &&
      (!cursor || cursor.deleted || cursor.value.kind !== 'message' || !cursor.value.message)
    )
      throw new ThreadHistoryChangedError(
        'This conversation changed. Reload before loading older messages.',
      )
    const position =
      cursor && !cursor.deleted && cursor.value.kind === 'message'
        ? cursor.value.position
        : undefined
    const query = `SELECT value FROM thread_registers
      WHERE json_extract(value,'$.value.ownerRuntimeId')=? AND json_extract(value,'$.value.threadId')=?
        AND json_extract(value,'$.value.kind')='message'
        AND json_extract(value,'$.value.message') IS NOT NULL
        ${before === undefined ? '' : "AND (json_extract(value,'$.value.position'),json_extract(value,'$.value.messageId')) < (?,?)"}
      ORDER BY json_extract(value,'$.value.position') DESC,json_extract(value,'$.value.messageId') DESC LIMIT 41`
    const messages = decode(
      mutableArray(mutableStruct({ value: Schema.String })),
      this.db
        .prepare(query)
        .all(...(before === undefined ? [owner, id] : [owner, id, position, before])),
    ).map((row) => decode(versionSchema, JSON.parse(row.value)))
    return replicatedThread([...metadata, ...messages], owner, id)
  }
  summary(owner: string, id: string) {
    return replicatedThread(
      this.rows(
        "SELECT value FROM thread_registers WHERE json_extract(value,'$.value.ownerRuntimeId')=? AND json_extract(value,'$.value.threadId')=? AND json_extract(value,'$.value.kind')!='message'",
        owner,
        id,
      ),
      owner,
      id,
      undefined,
      false,
    )
  }
  private replicaSummaries() {
    // Message streaming does not change summaries. The partial index keeps this lookup bounded
    // while SQLite owns the revision, including transaction rollback and imported records.
    const revision = this.db
      .prepare(
        "SELECT COALESCE(MAX(sequence),0) FROM thread_versions WHERE json_extract(value,'$.value.kind')!='message'",
      )
      .pluck()
      .get()
    if (typeof revision !== 'number') throw new Error('Invalid thread metadata revision')
    // Do not retain projections of uncommitted data. Rolled-back sequence numbers can be reused.
    if (!this.db.inTransaction && this.summaries?.revision === revision) return this.summaries.tasks
    const metadata = this.rows(
      "SELECT value FROM thread_registers WHERE json_extract(value,'$.value.kind')!='message'",
    )
    const previous = new Map(this.summaries?.tasks.map((task) => [task.id, task]))
    let tasks = replicatedThreadList(metadata, this.runtimeId, []).map((task) => {
      const before = previous.get(task.id)
      return before && JSON.stringify(before) === JSON.stringify(task) ? before : task
    })
    if (
      this.summaries &&
      tasks.length === this.summaries.tasks.length &&
      tasks.every((task, index) => task === this.summaries?.tasks[index])
    )
      tasks = this.summaries.tasks
    if (!this.db.inTransaction) this.summaries = { revision, tasks }
    return tasks
  }
  search(query: string, id?: string, before?: string): TaskSearchResult {
    const needle = taskSearchNeedle(query)
    const terms = taskSearchTerms(needle)
    const result: TaskSearchResult = { taskIds: [], hits: [] }
    if (!terms.length) return result
    const tasks = taskSearchOrder(
      this.replicaSummaries().filter((task) => id === undefined || task.id === id),
    )
    const originalText =
      /[\ud800-\udfff]/u.test(needle) || needle.includes('\ufffd') || needle.includes('\0')
    for (const task of tasks) {
      if (!task.replica) continue
      const { ownerRuntimeId, threadId } = task.replica
      const cursor =
        before === undefined
          ? undefined
          : this.get(JSON.stringify([ownerRuntimeId, threadId, 'message', before]))
      if (
        before !== undefined &&
        (!cursor || cursor.value.kind !== 'message' || !cursor.value.message)
      )
        throw new ThreadHistoryChangedError('The search cursor no longer exists. Search again.')
      const position =
        cursor?.value.kind === 'message' ? cursor.value.position : Number.MAX_SAFE_INTEGER
      const limit = id ? 51 : Math.max(1, 50 - result.hits.length)
      const rows = this.db
        .prepare(`SELECT entry.value FROM thread_registers AS entry
        JOIN thread_search AS search USING (key)
        WHERE json_extract(entry.value,'$.value.ownerRuntimeId')=? AND json_extract(entry.value,'$.value.threadId')=?
          AND json_extract(entry.value,'$.value.kind')='message'
          AND (json_extract(entry.value,'$.value.position'),json_extract(entry.value,'$.value.messageId')) < (?,?)
          ${originalText ? '' : 'AND NOT EXISTS (SELECT 1 FROM json_each(?) AS term WHERE instr(search.search_text, term.value)=0)'}
        ORDER BY json_extract(entry.value,'$.value.position') DESC,json_extract(entry.value,'$.value.messageId') DESC
        ${originalText ? '' : 'LIMIT ?'}`)
        .iterate(
          ownerRuntimeId,
          threadId,
          position,
          before ?? '',
          ...(originalText ? [] : [JSON.stringify(terms), limit]),
        )
      let matched = false
      for (const row of rows) {
        const { value } = decode(mutableStruct({ value: Schema.String }), row)
        const version = decode(versionSchema, JSON.parse(value))
        if (version.value.kind !== 'message' || !version.value.message) continue
        const hit = taskSearchHit(task.id, version.value.message, needle)
        if (!hit) continue
        matched = true
        if (result.hits.length < (id ? 51 : 50)) result.hits.push(hit)
        if (originalText && result.hits.length >= (id ? 51 : 50)) break
      }
      if (matched) result.taskIds.push(task.id)
    }
    if (id && result.hits.length > 50) {
      result.hits = result.hits.slice(0, 50)
      result.nextBefore = result.hits.at(-1)?.messageId
    }
    return result
  }
  replicas(detailIds?: readonly string[]) {
    const summaries = this.replicaSummaries()
    if (detailIds?.length === 0) return summaries
    const wanted = detailIds === undefined ? undefined : new Set(detailIds)
    return summaries.map((task) => {
      if (!task.replica || (wanted && !wanted.has(task.id))) return task
      return this.page(task.replica.ownerRuntimeId, task.replica.threadId) ?? task
    })
  }
}
