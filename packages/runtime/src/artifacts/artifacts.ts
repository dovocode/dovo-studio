import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import {
  ARTIFACT_MAX_BYTES,
  decode,
  mutableStruct,
  artifactSchema,
  artifactMetadataSchema,
  resolveTaskAgent,
  type ArtifactCreate,
  type ArtifactUpdate,
  type Task,
  type ArtifactLibraryEntry,
  runtimePreferencesSchema,
  artifactDeletionAt,
  externalArtifactLinks,
} from '@dovo/protocol'
import type { WorkspaceChange, WorkspaceStore } from '../storage/workspace.js'
import type { Activity } from '../storage/activity.js'
import { HttpError } from '../errors.js'

const stored = mutableStruct({ value: Schema.String })
const lifecycle = mutableStruct({
  taskId: Schema.String,
  state: Schema.Literals(['settled', 'archived']),
  since: Schema.String,
})
const stateOf = (task: Pick<Task, 'archived' | 'archivedAt'>) =>
  task.archivedAt
    ? ('archived' as const)
    : task.archived
      ? ('settled' as const)
      : ('active' as const)
export class Artifacts {
  private snapshots = new Map<string, Promise<{ image?: string; excerpt: string }>>()
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private activity: Activity,
    private preferences: () => Pick<
      typeof runtimePreferencesSchema.Type,
      'enableArtifacts' | 'settledArtifactRetention' | 'archivedArtifactRetention'
    >,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS artifacts (id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL, metadata TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id, revision)); CREATE INDEX IF NOT EXISTS artifacts_task ON artifacts(task_id, id, revision)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS artifact_states (task_id TEXT PRIMARY KEY, state TEXT NOT NULL, since TEXT NOT NULL)',
    )
    // Older versions may have expired artifact bodies while leaving their activity tiles.
    const removed = db
      .prepare(
        "DELETE FROM activity WHERE kind='tool' AND id GLOB 'artifact:*' AND id NOT IN (SELECT 'artifact:' || id || ':' || revision FROM artifacts)",
      )
      .run().changes
    if (removed) activity.revision++
    const tasks = new Map(store.get().tasks.map((task) => [task.id, task]))
    for (const row of db.prepare('SELECT DISTINCT task_id AS value FROM artifacts').all()) {
      const id = decode(stored, row).value
      const task = tasks.get(id)
      if (task) this.recordState(task)
      else {
        this.remove(id)
        db.prepare('DELETE FROM artifact_states WHERE task_id=?').run(id)
      }
    }
  }
  private remove(taskId: string) {
    const changes = this.db.prepare('DELETE FROM artifacts WHERE task_id=?').run(taskId).changes
    this.activity.removeArtifacts(taskId)
    for (const key of this.snapshots.keys())
      if (key.startsWith(`${taskId}:`)) this.snapshots.delete(key)
    return changes
  }
  private recordState(task: Pick<Task, 'id' | 'archived' | 'archivedAt'>, now = Date.now()) {
    const state = stateOf(task)
    if (state === 'active') {
      this.db.prepare('DELETE FROM artifact_states WHERE task_id=?').run(task.id)
      return
    }
    const raw = this.db
      .prepare('SELECT task_id AS taskId,state,since FROM artifact_states WHERE task_id=?')
      .get(task.id)
    const previous = raw ? decode(lifecycle, raw) : undefined
    const since =
      state === 'archived' && task.archivedAt
        ? task.archivedAt
        : previous?.state === state
          ? previous.since
          : new Date(now).toISOString()
    this.db
      .prepare(
        'INSERT INTO artifact_states VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET state=excluded.state,since=excluded.since',
      )
      .run(task.id, state, since)
  }
  workspace({ before, after }: Pick<WorkspaceChange, 'before' | 'after'>) {
    if (
      before.tasks === after.tasks ||
      (before.tasks.length === after.tasks.length &&
        before.tasks.every(
          (task, index) =>
            task.id === after.tasks[index]?.id &&
            task.archived === after.tasks[index]?.archived &&
            task.archivedAt === after.tasks[index]?.archivedAt,
        ))
    )
      return
    const remaining = new Set(after.tasks.map((task) => task.id))
    for (const task of before.tasks)
      if (!remaining.has(task.id)) {
        this.remove(task.id)
        this.db.prepare('DELETE FROM artifact_states WHERE task_id=?').run(task.id)
      }
    const previous = new Map(before.tasks.map((task) => [task.id, task]))
    for (const task of after.tasks) {
      const old = previous.get(task.id)
      if (
        (old?.archived !== task.archived || old?.archivedAt !== task.archivedAt) &&
        this.db.prepare('SELECT 1 FROM artifacts WHERE task_id=? LIMIT 1').get(task.id)
      )
        this.recordState(task)
    }
    this.prune()
  }
  prune(now = Date.now()) {
    const settings = this.preferences()
    if (
      settings.settledArtifactRetention === 'forever' &&
      settings.archivedArtifactRetention === 'forever'
    )
      return 0
    return this.db.transaction(() => {
      let removed = 0
      for (const raw of this.db
        .prepare('SELECT task_id AS taskId,state,since FROM artifact_states')
        .all()) {
        const row = decode(lifecycle, raw)
        const deadline = artifactDeletionAt(
          row.since,
          row.state === 'archived'
            ? settings.archivedArtifactRetention
            : settings.settledArtifactRetention,
        )
        if (deadline && Date.parse(deadline) <= now) removed += this.remove(row.taskId)
      }
      return removed
    })()
  }
  library(): ArtifactLibraryEntry[] {
    const tasks = new Map(this.store.get().tasks.map((task) => [task.id, task]))
    const settings = this.preferences()
    const states = new Map(
      this.db
        .prepare('SELECT task_id AS taskId,state,since FROM artifact_states')
        .all()
        .map((raw) => {
          const row = decode(lifecycle, raw)
          return [row.taskId, row]
        }),
    )
    return this.db
      .prepare(
        'SELECT metadata AS value FROM artifacts WHERE revision=(SELECT MAX(a.revision) FROM artifacts a WHERE a.id=artifacts.id) ORDER BY rowid DESC',
      )
      .all()
      .flatMap((raw) => {
        const item = decode(artifactMetadataSchema, JSON.parse(decode(stored, raw).value))
        const task = tasks.get(item.taskId)
        if (!task) return []
        const saved = states.get(task.id)
        return [
          {
            ...item,
            threadTitle: task.title,
            threadState: stateOf(task),
            deleteAt: saved
              ? artifactDeletionAt(
                  saved.since,
                  saved.state === 'archived'
                    ? settings.archivedArtifactRetention
                    : settings.settledArtifactRetention,
                )
              : undefined,
          },
        ]
      })
  }
  list(taskId: string) {
    this.store.taskSummary(taskId)
    return this.db
      .prepare(
        'SELECT metadata AS value FROM artifacts WHERE task_id=? AND revision=(SELECT MAX(a.revision) FROM artifacts a WHERE a.id=artifacts.id) ORDER BY rowid DESC',
      )
      .all(taskId)
      .map((row) => decode(artifactMetadataSchema, JSON.parse(decode(stored, row).value)))
  }
  links(taskId: string) {
    const task = this.store.task(taskId)
    const activity = this.activity
    return externalArtifactLinks(
      (function* () {
        for (const message of task.messages) yield message.text
        for (const chat of task.sideChats ?? [])
          for (const message of chat.messages) {
            yield message.question
            yield message.answer
          }
        yield* activity.toolPayloads(taskId)
      })(),
    )
  }
  read(taskId: string, id: string, revision?: number) {
    this.store.taskSummary(taskId)
    const row =
      revision === undefined
        ? this.db
            .prepare(
              'SELECT value FROM artifacts WHERE task_id=? AND id=? ORDER BY revision DESC LIMIT 1',
            )
            .get(taskId, id)
        : this.db
            .prepare('SELECT value FROM artifacts WHERE task_id=? AND id=? AND revision=?')
            .get(taskId, id, revision)
    if (!row) throw new HttpError(404, 'Artifact not found in this thread')
    return decode(artifactSchema, JSON.parse(decode(stored, row).value))
  }
  versions(taskId: string, id: string) {
    this.store.taskSummary(taskId)
    return this.db
      .prepare(
        'SELECT metadata AS value FROM artifacts WHERE task_id=? AND id=? ORDER BY revision DESC',
      )
      .all(taskId, id)
      .map((row) => decode(artifactMetadataSchema, JSON.parse(decode(stored, row).value)))
  }
  delete(taskId: string, id: string, expectedRevision: number) {
    return this.db.transaction(() => {
      const artifact = this.read(taskId, id)
      if (artifact.revision !== expectedRevision)
        throw new HttpError(409, 'Artifact changed. Refresh before deleting it.')
      this.db.prepare('DELETE FROM artifacts WHERE task_id=? AND id=?').run(taskId, id)
      this.activity.removeArtifacts(taskId, id)
      for (const key of this.snapshots.keys())
        if (key.startsWith(`${taskId}:${id}:`)) this.snapshots.delete(key)
      return { ok: true }
    })()
  }
  attach(taskId: string, id: string, targetTaskId: string, revision?: number) {
    if (taskId === targetTaskId) throw new HttpError(409, 'Artifact is already in this thread')
    const target = this.store.taskSummary(targetTaskId)
    if (target.archived || target.archivedAt)
      throw new HttpError(409, 'Reopen the destination thread before adding artifacts')
    const { title, format, content, language } = this.read(taskId, id, revision)
    return this.write({ taskId: targetTaskId, title, format, content, language }, false)
  }
  snapshot(
    taskId: string,
    id: string,
    revision: number | undefined,
    render: (content: string) => Promise<string>,
  ) {
    // Reauthorize every request, including cached snapshots after retention or deletion.
    const artifact = this.read(taskId, id, revision)
    const key = `${taskId}:${id}:${artifact.revision}`
    const cached = this.snapshots.get(key)
    if (cached) return cached
    const pending = (async () => {
      const excerpt =
        artifact.format === 'html' || artifact.format === 'svg'
          ? ''
          : artifact.content.slice(0, 1200)
      return artifact.format === 'html' || artifact.format === 'svg'
        ? { image: await render(artifact.content), excerpt }
        : { excerpt }
    })()
    this.snapshots.set(key, pending)
    // Small raster previews only; never retain artifact bodies in this cache.
    while (this.snapshots.size > 64) {
      const oldest = this.snapshots.keys().next().value
      if (oldest === undefined) break
      this.snapshots.delete(oldest)
    }
    void pending.catch(() => {
      if (this.snapshots.get(key) === pending) this.snapshots.delete(key)
    })
    return pending
  }
  write(input: ArtifactCreate | ArtifactUpdate, fromAgent = true) {
    if (!this.preferences().enableArtifacts)
      throw new HttpError(403, 'Enable Dovo Artifacts in this computer’s settings first')
    const task = this.store.task(input.taskId)
    if (resolveTaskAgent(task, this.store.get().agents)?.permission === 'read-only')
      throw new HttpError(403, 'Creating artifacts is disabled for read-only threads')
    if (Buffer.byteLength(input.content, 'utf8') > ARTIFACT_MAX_BYTES)
      throw new HttpError(413, 'Artifact exceeds the 2 MB limit')
    return this.db.transaction(() => {
      const previous = 'id' in input ? this.read(input.taskId, input.id) : undefined
      if ('expectedRevision' in input && previous?.revision !== input.expectedRevision)
        throw new HttpError(409, 'Artifact changed. Read the latest revision before updating it.')
      const now = new Date().toISOString()
      const artifact = decode(artifactSchema, {
        id: previous?.id ?? randomUUID(),
        taskId: input.taskId,
        title: input.title,
        format: input.format,
        content: input.content,
        language: input.language,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      })
      const { content: _, ...metadata } = artifact
      this.db
        .prepare('INSERT INTO artifacts VALUES (?,?,?,?,?)')
        .run(
          artifact.id,
          artifact.taskId,
          artifact.revision,
          JSON.stringify(metadata),
          JSON.stringify(artifact),
        )
      this.recordState(task)
      const turn = fromAgent ? task.turns?.at(-1) : undefined
      const message = task.messages.find((message) => message.id === turn?.assistantId)
      this.activity.add(
        'tool',
        task.id,
        `Artifact · ${artifact.title}`,
        {
          turnId: turn?.id,
          messageId: message?.id,
          toolId: `artifact:${artifact.id}:${artifact.revision}`,
          status: 'completed',
          textOffset: message?.text.length ?? 0,
          artifacts: [metadata],
        },
        `artifact:${artifact.id}:${artifact.revision}`,
      )
      return metadata
    })()
  }
}
