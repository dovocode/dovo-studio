import { expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, type Task, runtimePreferencesSchema } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { WorkspaceStore } from '../storage/workspace.js'
import { Activity } from '../storage/activity.js'
import { Artifacts } from './artifacts.js'

type Preferences = Pick<
  typeof runtimePreferencesSchema.Type,
  'enableArtifacts' | 'settledArtifactRetention' | 'archivedArtifactRetention'
>
const task: Task = {
  id: 'recoverable',
  title: 'Recoverable thread',
  repositoryId: '',
  agentId: '',
  status: 'draft',
  createdAt: '2026-10-01T00:00:00Z',
  messages: [],
  files: [],
  draft: '',
  example: false,
}
function fixture() {
  const db = openDatabase(':memory:')
  const preferences: Preferences = {
    enableArtifacts: true,
    settledArtifactRetention: 'forever',
    archivedArtifactRetention: 'forever',
  }
  const load = () => {
    let artifacts: Artifacts | undefined
    const activity = new Activity(db)
    const store = new WorkspaceStore(db, (change) => artifacts?.workspace(change))
    artifacts = new Artifacts(db, store, activity, () => preferences)
    return { store, artifacts, activity }
  }
  const initial = load()
  initial.store.update((workspace) => ({
    ...workspace,
    tasks: [task, { ...task, id: 'kept' }],
  }))
  const first = initial.artifacts.write({
    taskId: task.id,
    title: 'Saved artifact',
    format: 'markdown',
    content: 'first revision',
  })
  initial.artifacts.write({
    ...first,
    content: 'second revision',
    expectedRevision: 1,
  })
  const document = () =>
    decode(
      Schema.String,
      db.prepare("SELECT value FROM documents WHERE id='workspace'").pluck().get(),
    )
  const metadata = decode(
    Schema.String,
    db.prepare('SELECT value FROM workspace_tasks WHERE task_id=?').pluck().get(task.id),
  )
  const repair = () => {
    db.prepare('UPDATE workspace_tasks SET value=? WHERE task_id=?').run(metadata, task.id)
    const shell = decode(Schema.Record(Schema.String, Schema.Unknown), JSON.parse(document()))
    const ids = decode(Schema.Array(Schema.String), shell.taskIds)
    db.prepare("UPDATE documents SET value=? WHERE id='workspace'").run(
      JSON.stringify({ ...shell, taskIds: [...new Set([...ids, task.id])] }),
    )
    return load()
  }
  const revisions = () =>
    db
      .prepare('SELECT revision FROM artifacts WHERE task_id=? ORDER BY revision')
      .pluck()
      .all(task.id)
  return { db, preferences, load, initial, first, document, repair, revisions }
}

it.each(['{broken', JSON.stringify({ ...task, status: 'unsupported-status' })])(
  'preserves revisions and activity through invalid metadata recovery, writes, restart and repair (%s)',
  (invalid) => {
    const f = fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      f.db.prepare('UPDATE workspace_tasks SET value=? WHERE task_id=?').run(invalid, task.id)
      const recovered = f.load()
      expect(recovered.store.get().tasks.map((entry) => entry.id)).toEqual(['kept'])
      expect(recovered.artifacts.library()).toEqual([])
      expect(() => recovered.artifacts.read(task.id, f.first.id)).toThrow('Task not found')
      expect(f.revisions()).toEqual([1, 2])
      expect(recovered.activity.list('', 'task-activity', 0, task.id).events).toHaveLength(2)
      expect(
        f.db.prepare("SELECT 1 FROM documents WHERE id LIKE 'workspace-backup:%:tasks'").get(),
      ).toBeDefined()
      recovered.store.update((workspace) => ({ ...workspace, runtimeAddress: 'http://lan:4317' }))
      f.load()
      expect(f.revisions()).toEqual([1, 2])
      const repaired = f.repair()
      expect(repaired.artifacts.read(task.id, f.first.id, 1).content).toBe('first revision')
      expect(repaired.artifacts.read(task.id, f.first.id).content).toBe('second revision')
      expect(
        repaired.artifacts.versions(task.id, f.first.id).map((entry) => entry.revision),
      ).toEqual([2, 1])
      repaired.store.update((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.filter((entry) => entry.id !== task.id),
      }))
      expect(f.revisions()).toEqual([])
      expect(repaired.activity.list('', 'task-activity', 0, task.id).events).toEqual([])
      f.load()
      expect(f.revisions()).toEqual([])
    } finally {
      error.mockRestore()
      f.db.close()
    }
  },
)

it.each([1, 2])(
  'preserves artifacts while migrating unreadable version %i task metadata',
  (version) => {
    const f = fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const workspace = {
        ...f.initial.store.get(),
        tasks: [
          { ...task, status: 'unsupported-status' },
          { ...task, id: 'kept' },
        ],
      }
      const raw = JSON.stringify(
        version === 1
          ? workspace
          : {
              storageVersion: 2,
              workspace,
              historyCounts: {
                recoverable: { messages: 0, turns: 0 },
                kept: { messages: 0, turns: 0 },
              },
            },
      )
      f.db.prepare("UPDATE documents SET value=? WHERE id='workspace'").run(raw)
      f.db.prepare('DELETE FROM workspace_tasks').run()
      const recovered = f.load()
      expect(recovered.store.get().tasks.map((entry) => entry.id)).toEqual(['kept'])
      expect(f.revisions()).toEqual([1, 2])
      f.load()
      expect(f.revisions()).toEqual([1, 2])
      expect(
        f.db
          .prepare("SELECT 1 FROM documents WHERE id LIKE 'workspace-backup:%' AND value=?")
          .get(raw),
      ).toBeDefined()
      recovered.store.update((current) => ({ ...current, tasks: [...current.tasks, task] }))
      expect(recovered.artifacts.read(task.id, f.first.id).content).toBe('second revision')
      expect(recovered.artifacts.read(task.id, f.first.id, 1).content).toBe('first revision')
    } finally {
      error.mockRestore()
      f.db.close()
    }
  },
)

it.each(['settled', 'archived'] as const)(
  'pauses %s retention while metadata is unavailable and resumes the original deadline after repair',
  (state) => {
    const f = fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      f.preferences.settledArtifactRetention = '7-days'
      f.preferences.archivedArtifactRetention = '7-days'
      f.initial.store.updateTask(task.id, (entry) => ({
        ...entry,
        archived: true,
        archivedAt: state === 'archived' ? new Date().toISOString() : undefined,
      }))
      const deadline = f.initial.artifacts.library()[0]!.deleteAt!
      const settledMetadata = decode(
        Schema.String,
        f.db.prepare('SELECT value FROM workspace_tasks WHERE task_id=?').pluck().get(task.id),
      )
      f.db.prepare('UPDATE workspace_tasks SET value=? WHERE task_id=?').run('{broken', task.id)
      const quarantined = f.load()
      expect(quarantined.artifacts.prune(Date.parse(deadline) + 1)).toBe(0)
      expect(f.revisions()).toEqual([1, 2])
      // Restore the settled metadata, retaining its saved lifecycle timestamp.
      f.db
        .prepare('UPDATE workspace_tasks SET value=? WHERE task_id=?')
        .run(settledMetadata, task.id)
      const repaired = f.load()
      expect(repaired.artifacts.library()[0]?.deleteAt).toBe(deadline)
      expect(repaired.artifacts.prune(Date.parse(deadline) - 1)).toBe(0)
      expect(repaired.artifacts.prune(Date.parse(deadline))).toBe(2)
      expect(f.revisions()).toEqual([])
    } finally {
      error.mockRestore()
      f.db.close()
    }
  },
)

it('finishes artifact cleanup after a task deletion committed without its cleanup callback', () => {
  const f = fixture()
  try {
    const store = new WorkspaceStore(f.db)
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.filter((entry) => entry.id !== task.id),
    }))
    expect(f.revisions()).toEqual([1, 2])
    const restarted = f.load()
    expect(f.revisions()).toEqual([])
    expect(restarted.activity.list('', 'task-activity', 0, task.id).events).toEqual([])
  } finally {
    f.db.close()
  }
})

it('preserves unreadable current metadata even when an older deletion marker remains', () => {
  const f = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    f.db
      .prepare('INSERT INTO documents VALUES (?,?)')
      .run(
        `workspace-deleted:tasks:${task.id}`,
        JSON.stringify({ deletedAt: '2026-09-01T00:00:00Z' }),
      )
    f.db.prepare('UPDATE workspace_tasks SET value=? WHERE task_id=?').run('{broken', task.id)
    f.load()
    expect(f.revisions()).toEqual([1, 2])
    expect(f.repair().artifacts.read(task.id, f.first.id).content).toBe('second revision')
  } finally {
    error.mockRestore()
    f.db.close()
  }
})
