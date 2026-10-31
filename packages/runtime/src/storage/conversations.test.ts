import { expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import {
  conversationPage,
  decode,
  mutableStruct,
  searchTaskMessages,
  type Task,
  type Workspace,
} from '@dovo/protocol'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
import { WorkspaceDocuments } from './workspace-documents'
import { Activity } from './activity'
const task: Task = {
  id: 'thread',
  title: 'History',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'draft',
  createdAt: '2026-10-01T00:00:00Z',
  draft: '',
  files: [],
  example: false,
  messages: Array.from({ length: 200 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `Message ${index}`,
  })),
  turns: [
    {
      id: 'turn',
      assistantId: 'm199',
      agentId: 'agent',
      provider: 'codex',
      model: 'model',
      startedAt: '2026-10-01T00:00:00Z',
      status: 'completed',
      checkpoint: { before: 'before', after: 'after', files: [], omitted: [] },
    },
  ],
}
const workspace: Workspace = {
  version: 1,
  tasks: [task],
  agents: [],
  repositories: [],
  automations: [],
  runtimeAddress: '',
}
const value = (db: ReturnType<typeof openDatabase>, id: string) =>
  decode(
    mutableStruct({ value: Schema.String }),
    db.prepare('SELECT value FROM documents WHERE id = ?').get(id),
  ).value
it('migrates legacy history intact and writes only the changed message in an audited runtime', () => {
  const db = openDatabase(':memory:')
  try {
    db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', JSON.stringify(workspace))
    const activity = new Activity(db)
    const store = new WorkspaceStore(db, (change) => activity.workspace(change))
    expect(value(db, 'workspace-before-history-v2')).toBe(JSON.stringify(workspace))
    expect(value(db, 'workspace')).not.toContain('Message 199')
    db.exec(
      `CREATE TABLE history_writes (item_id TEXT); CREATE TRIGGER history_update AFTER UPDATE ON conversation_items BEGIN INSERT INTO history_writes VALUES (NEW.item_id); END;`,
    )
    store.updateTask(task.id, (task) => ({ ...task, activity: 'Working' }))
    expect(db.prepare('SELECT * FROM history_writes').all()).toEqual([])
    store.updateTaskHistory(task.id, (task) => ({
      ...task,
      messages: task.messages.map((message) =>
        message.id === 'm199' ? { ...message, text: 'Streamed reply' } : message,
      ),
    }))
    expect(db.prepare('SELECT * FROM history_writes').all()).toEqual([{ item_id: 'm199' }])
    expect(new WorkspaceStore(db).task(task.id).messages).toEqual(store.task(task.id).messages)
    expect(new WorkspaceStore(db).task(task.id).turns).toEqual(task.turns)
    expect(activity.list('', 'message', 0).events[0]?.payload).toContain('Streamed reply')
  } finally {
    db.close()
  }
})
it('rolls history, workspace, provider intent and acceptance back together on a failed commit', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update(() => workspace)
    db.exec(
      "CREATE TRIGGER fail_commit BEFORE UPDATE ON workspace_tasks BEGIN SELECT RAISE(ABORT, 'Disk full'); END",
    )
    expect(() =>
      store.updateTaskHistory(
        task.id,
        (task) => ({
          ...task,
          messages: [...task.messages, { id: 'new', role: 'user', text: 'Keep this safe' }],
        }),
        { id: 'new', fingerprint: 'fingerprint' },
        { id: 'intent', taskId: task.id, attemptId: 'attempt', kind: 'start', state: 'pending' },
      ),
    ).toThrow('Disk full')
    expect(store.task(task.id).messages).toEqual(task.messages)
    expect(store.providerActions.list(task.id)).toEqual([])
    expect(store.taskSubmission(task.id, 'new')).toBeUndefined()
    db.exec('DROP TRIGGER fail_commit')
    expect(new WorkspaceStore(db).task(task.id).messages).toEqual(task.messages)
  } finally {
    db.close()
  }
})
it('refuses to overwrite a normalized workspace whose history rows are missing', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update(() => workspace)
    const document = value(db, 'workspace')
    db.prepare("DELETE FROM conversation_items WHERE task_id = ? AND item_id = 'm3'").run(task.id)
    expect(() => new WorkspaceStore(db)).toThrow('History for thread is incomplete')
    expect(value(db, 'workspace')).toBe(document)
  } finally {
    db.close()
  }
})

it('rejects duplicate history IDs transactionally instead of saving an unreadable manifest', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update(() => workspace)
    const before = value(db, 'workspace')
    expect(() =>
      store.updateTaskHistory(task.id, (t) => ({
        ...t,
        messages: [...t.messages, { ...t.messages[0]!, text: 'Duplicate' }],
      })),
    ).toThrow('Duplicate message ID')
    expect(value(db, 'workspace')).toBe(before)
    expect(new WorkspaceStore(db).task(task.id).messages).toEqual(task.messages)
  } finally {
    db.close()
  }
})

/** The version 2 envelope and history rows written by the previous runtime. */
function storeVersion2(db: ReturnType<typeof openDatabase>, source: Workspace) {
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_items (
    task_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(task_id, kind, item_id))`)
  const insert = db.prepare('INSERT INTO conversation_items VALUES (?, ?, ?, ?, ?)')
  for (const entry of source.tasks) {
    entry.messages.forEach((item, index) =>
      insert.run(entry.id, 'message', item.id, index, JSON.stringify(item)),
    )
    entry.turns?.forEach((item, index) =>
      insert.run(entry.id, 'turn', item.id, index, JSON.stringify(item)),
    )
  }
  const raw = JSON.stringify({
    storageVersion: 2,
    historyCounts: Object.fromEntries(
      source.tasks.map((entry) => [
        entry.id,
        { messages: entry.messages.length, turns: entry.turns?.length ?? 0 },
      ]),
    ),
    workspace: {
      ...source,
      tasks: source.tasks.map((entry) => ({
        ...entry,
        messages: [],
        ...(entry.turns ? { turns: [] } : {}),
      })),
    },
  })
  db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', raw)
  return raw
}
const second: Task = {
  ...task,
  id: 'second',
  title: 'Second',
  updatedAt: '2026-10-02T00:00:00Z',
  messages: [
    { id: 's0', role: 'user', text: 'Ärger with MESSAGE casing' },
    { id: 's1', role: 'assistant', text: 'Reply', turnId: 'owned' },
  ],
  turns: [{ ...task.turns![0]!, id: 'owned', assistantId: 's1' }],
}
it('migrates the version 2 envelope to per-task rows transactionally and keeps a backup', () => {
  const db = openDatabase(':memory:')
  try {
    const raw = storeVersion2(db, { ...workspace, tasks: [task, second] })
    new WorkspaceDocuments(db)
    db.exec(
      "CREATE TRIGGER fail_migration BEFORE INSERT ON workspace_tasks WHEN NEW.task_id = 'second' BEGIN SELECT RAISE(ABORT, 'Disk full'); END",
    )
    expect(() => new WorkspaceStore(db)).toThrow('Disk full')
    expect(value(db, 'workspace')).toBe(raw)
    expect(db.prepare("SELECT * FROM documents WHERE id = 'workspace-before-tasks-v3'").get()).toBe(
      undefined,
    )
    expect(db.prepare('SELECT * FROM workspace_tasks').all()).toEqual([])
    db.exec('DROP TRIGGER fail_migration')
    const store = new WorkspaceStore(db)
    expect(value(db, 'workspace-before-tasks-v3')).toBe(raw)
    const shell = JSON.parse(value(db, 'workspace'))
    expect(shell).toMatchObject({ storageVersion: 3, taskIds: ['thread', 'second'] })
    expect(shell.workspace.tasks).toBeUndefined()
    expect(db.prepare('SELECT task_id, messages, turns FROM workspace_tasks').all()).toEqual([
      { task_id: 'thread', messages: 200, turns: 1 },
      { task_id: 'second', messages: 2, turns: 1 },
    ])
    expect(store.task('thread').messages).toEqual(task.messages)
    const reloaded = new WorkspaceStore(db)
    expect(reloaded.get().tasks.map((entry) => reloaded.task(entry.id).messages)).toEqual([
      task.messages,
      second.messages,
    ])
    expect(store.searchHistory('ärger').hits.map((hit) => hit.messageId)).toEqual(['s0'])
  } finally {
    db.close()
  }
})
it('writes only the changed task row and leaves the workspace shell untouched', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((current) => ({ ...current, tasks: [task, second] }))
    db.exec(`CREATE TABLE writes (target TEXT);
      CREATE TRIGGER task_write AFTER UPDATE ON workspace_tasks BEGIN INSERT INTO writes VALUES (NEW.task_id); END;
      CREATE TRIGGER shell_write AFTER UPDATE ON documents BEGIN INSERT INTO writes VALUES (NEW.id); END;`)
    store.updateTask('second', (entry) => ({ ...entry, activity: 'Working' }))
    store.updateTaskHistory('second', (entry) => ({
      ...entry,
      messages: [...entry.messages, { id: 's2', role: 'user', text: 'Appended' }],
    }))
    expect(db.prepare('SELECT target FROM writes').all()).toEqual([
      { target: 'second' },
      { target: 'second' },
    ])
    store.update((current) => ({ ...current, tasks: [...current.tasks].reverse() }))
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['second', 'thread'])
    store.update((current) => ({ ...current, tasks: current.tasks.slice(1) }))
    expect(db.prepare('SELECT task_id FROM workspace_tasks').all()).toEqual([{ task_id: 'thread' }])
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM conversation_index WHERE task_id = 'second'").get(),
    ).toEqual({ count: 0 })
    expect(new WorkspaceStore(db).get().tasks).toEqual(store.get().tasks)
  } finally {
    db.close()
  }
})
it('fails closed on missing task rows, invalid manifests and newer formats', () => {
  const db = openDatabase(':memory:')
  try {
    new WorkspaceStore(db).update((current) => ({ ...current, tasks: [task, second] }))
    const document = value(db, 'workspace')
    const rows = db.prepare('SELECT * FROM workspace_tasks').all()
    db.prepare("DELETE FROM workspace_tasks WHERE task_id = 'second'").run()
    expect(() => new WorkspaceStore(db)).toThrow('Task second is missing')
    expect(value(db, 'workspace')).toBe(document)
    db.prepare('DELETE FROM workspace_tasks').run()
    const insert = db.prepare('INSERT INTO workspace_tasks VALUES (?, ?, ?, ?)')
    for (const row of rows)
      insert.run(...Object.values(decode(Schema.Record(Schema.String, Schema.Unknown), row)))
    db.prepare("UPDATE workspace_tasks SET messages = 3 WHERE task_id = 'second'").run()
    expect(() => new WorkspaceStore(db)).toThrow('History for second is incomplete')
    db.prepare("UPDATE workspace_tasks SET messages = 2 WHERE task_id = 'second'").run()
    for (const [invalid, message] of [
      [{ ...JSON.parse(document), taskIds: ['thread', 'thread'] }, 'manifest is invalid'],
      [{ ...JSON.parse(document), taskIds: 'thread' }, 'manifest is invalid'],
      [{ ...JSON.parse(document), storageVersion: 4 }, 'newer storage format'],
    ] as const) {
      db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(
        JSON.stringify(invalid),
      )
      expect(() => new WorkspaceStore(db)).toThrow(message)
    }
    db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(document)
    expect(new WorkspaceStore(db).task('second').messages).toEqual(second.messages)
  } finally {
    db.close()
  }
})
it('reserves malformed version 2 tasks across migration, failures and restart', () => {
  const db = openDatabase(':memory:')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    storeVersion2(db, { ...workspace, tasks: [task, second] })
    const envelope = JSON.parse(value(db, 'workspace'))
    envelope.workspace.tasks[1].title = 4
    const raw = JSON.stringify(envelope)
    db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(raw)
    const history = db
      .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
      .all()
    new WorkspaceDocuments(db)
    db.exec(
      "CREATE TRIGGER reject_unreadable BEFORE INSERT ON workspace_tasks WHEN NEW.task_id = 'second' BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END",
    )
    expect(() => new WorkspaceStore(db)).toThrow('injected migration failure')
    expect(value(db, 'workspace')).toBe(raw)
    expect(db.prepare('SELECT * FROM workspace_tasks').all()).toEqual([])
    expect(
      db
        .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
        .all(),
    ).toEqual(history)
    db.exec('DROP TRIGGER reject_unreadable')
    const store = new WorkspaceStore(db)
    expect(store.get().tasks.map((entry) => entry.id)).toEqual(['thread'])
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread', 'second'])
    expect(
      db
        .prepare("SELECT value, messages, turns FROM workspace_tasks WHERE task_id = 'second'")
        .get(),
    ).toEqual({ value: JSON.stringify(envelope.workspace.tasks[1]), messages: 2, turns: 1 })
    db.exec(`CREATE TRIGGER reject_unneeded_shell BEFORE UPDATE ON documents WHEN NEW.id = 'workspace' BEGIN SELECT RAISE(ABORT, 'unneeded shell rewrite'); END;
      CREATE TRIGGER reject_unneeded_recovery BEFORE INSERT ON workspace_tasks WHEN NEW.task_id = 'second' BEGIN SELECT RAISE(ABORT, 'unneeded recovery insert'); END`)
    store.updateTask('thread', (current) => ({ ...current, title: 'Edited' }))
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [...current.messages, { id: 'streamed', role: 'assistant', text: 'new' }],
    }))
    db.exec('DROP TRIGGER reject_unneeded_shell; DROP TRIGGER reject_unneeded_recovery')
    const reopened = new WorkspaceStore(db)
    expect(() =>
      reopened.update((current) => ({ ...current, tasks: [...current.tasks, second] })),
    ).toThrow(/unreadable/)
    expect(
      db
        .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
        .all(),
    ).toEqual(history)
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread', 'second'])
  } finally {
    error.mockRestore()
    db.close()
  }
})

it('recovers an orphan from an already migrated v2 backup without overwriting its history', () => {
  const db = openDatabase(':memory:')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    storeVersion2(db, { ...workspace, tasks: [task, second] })
    const envelope = JSON.parse(value(db, 'workspace'))
    envelope.workspace.tasks[1].title = 4
    const legacy = JSON.stringify(envelope)
    db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(legacy)
    const history = db
      .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
      .all()
    const store = new WorkspaceStore(db)
    const shell = JSON.parse(value(db, 'workspace'))
    shell.taskIds = ['thread']
    db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(JSON.stringify(shell))
    db.prepare("DELETE FROM workspace_tasks WHERE task_id = 'second'").run()
    db.prepare("DELETE FROM documents WHERE id = 'workspace-v2-recovery-checked'").run()
    expect(store.get().tasks.map((entry) => entry.id)).toEqual(['thread'])
    db.prepare('INSERT INTO workspace_tasks VALUES (?, ?, ?, ?)').run('second', '{}', 0, 0)
    expect(() => new WorkspaceStore(db)).toThrow(/conflicting recovery records/)
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: '{}',
    })
    db.prepare("DELETE FROM workspace_tasks WHERE task_id = 'second'").run()
    db.prepare('INSERT INTO workspace_tasks VALUES (?, ?, ?, ?)').run(
      'unknown',
      '{unreadable',
      0,
      0,
    )
    db.exec(
      "CREATE TRIGGER reject_recovery BEFORE INSERT ON workspace_tasks WHEN NEW.task_id = 'second' BEGIN SELECT RAISE(ABORT, 'injected recovery failure'); END",
    )
    expect(() => new WorkspaceStore(db)).toThrow('injected recovery failure')
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread'])
    expect(
      db.prepare("SELECT 1 FROM documents WHERE id = 'workspace-v2-recovery-checked'").get(),
    ).toBeUndefined()
    expect(
      db
        .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
        .all(),
    ).toEqual(history)
    db.exec('DROP TRIGGER reject_recovery')
    const recovered = new WorkspaceStore(db)
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread', 'second'])
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'unknown'").get()).toEqual(
      { value: '{unreadable' },
    )
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: JSON.stringify(envelope.workspace.tasks[1]),
    })
    db.exec(`CREATE TRIGGER reject_repeated_marker BEFORE INSERT ON documents WHEN NEW.id = 'workspace-v2-recovery-checked' BEGIN SELECT RAISE(ABORT, 'repeated recovery marker'); END;
      CREATE TRIGGER reject_repeated_shell BEFORE UPDATE ON documents WHEN NEW.id = 'workspace' BEGIN SELECT RAISE(ABORT, 'repeated recovery shell'); END`)
    recovered.updateTask('thread', (current) => ({ ...current, title: 'Edited after recovery' }))
    db.exec('DROP TRIGGER reject_repeated_marker; DROP TRIGGER reject_repeated_shell')
    expect(() =>
      recovered.update((current) => ({ ...current, tasks: [...current.tasks, second] })),
    ).toThrow(/unreadable/)
    expect(
      db
        .prepare("SELECT * FROM conversation_items WHERE task_id = 'second' ORDER BY kind, item_id")
        .all(),
    ).toEqual(history)
    expect(() =>
      new WorkspaceStore(db).update((current) => ({
        ...current,
        tasks: [...current.tasks, second],
      })),
    ).toThrow(/unreadable/)
  } finally {
    error.mockRestore()
    db.close()
  }
})

it('only notifies document recovery after an outer workspace batch commits', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((current) => ({ ...current, tasks: [task] }))
    const committed = vi.spyOn(WorkspaceDocuments.prototype, 'committed')
    expect(() =>
      store.transaction(() => {
        store.updateTask('thread', (current) => ({ ...current, title: 'Tentative' }))
        store.transaction(() =>
          store.updateTask('thread', (current) => ({ ...current, title: 'Nested' })),
        )
        expect(committed).not.toHaveBeenCalled()
        throw new Error('injected outer failure')
      }),
    ).toThrow('injected outer failure')
    expect(committed).not.toHaveBeenCalled()
    store.transaction(() => {
      store.updateTask('thread', (current) => ({ ...current, title: 'Committed' }))
      expect(committed).not.toHaveBeenCalled()
    })
    expect(committed).toHaveBeenCalledOnce()
    committed.mockRestore()
  } finally {
    db.close()
  }
})

it('retries pending recovery after an outer workspace batch rolls back', () => {
  const db = openDatabase(':memory:')
  const legacyDb = openDatabase(':memory:')
  const preserve = vi.spyOn(WorkspaceDocuments.prototype, 'preserveUnreadableTasks')
  try {
    const store = new WorkspaceStore(db)
    store.update((current) => ({ ...current, tasks: [task] }))
    const documents = preserve.mock.instances.at(-1)
    if (!(documents instanceof WorkspaceDocuments)) throw new Error('Missing workspace documents')
    storeVersion2(legacyDb, { ...workspace, tasks: [task, second] })
    const envelope = JSON.parse(value(legacyDb, 'workspace'))
    envelope.workspace.tasks[1].title = 4
    legacyDb
      .prepare("UPDATE documents SET value = ? WHERE id = 'workspace'")
      .run(JSON.stringify(envelope))
    const legacy = new WorkspaceDocuments(legacyDb).read()
    const insert = db.prepare('INSERT INTO conversation_items VALUES (?, ?, ?, ?, ?)')
    second.messages.forEach((message, index) =>
      insert.run('second', 'message', message.id, index, JSON.stringify(message)),
    )
    second.turns?.forEach((turn, index) =>
      insert.run('second', 'turn', turn.id, index, JSON.stringify(turn)),
    )
    documents.preserveUnreadableTasks(legacy, store.get().tasks)
    expect(() =>
      store.transaction(() => {
        store.updateTask('thread', (current) => ({ ...current, title: 'Tentative' }))
        expect(JSON.parse(value(db, 'workspace')).taskIds).toContain('second')
        throw new Error('injected outer failure')
      }),
    ).toThrow('injected outer failure')
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread'])
    expect(
      db.prepare("SELECT 1 FROM workspace_tasks WHERE task_id = 'second'").get(),
    ).toBeUndefined()
    store.transaction(() =>
      store.updateTask('thread', (current) => ({ ...current, title: 'Committed' })),
    )
    expect(JSON.parse(value(db, 'workspace')).taskIds).toEqual(['thread', 'second'])
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: JSON.stringify(envelope.workspace.tasks[1]),
    })
  } finally {
    preserve.mockRestore()
    legacyDb.close()
    db.close()
  }
})

it('refuses migration when an unreadable v2 task has no usable identity', () => {
  const db = openDatabase(':memory:')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    storeVersion2(db, { ...workspace, tasks: [task] })
    const envelope = JSON.parse(value(db, 'workspace'))
    delete envelope.workspace.tasks[0].id
    const raw = JSON.stringify(envelope)
    db.prepare("UPDATE documents SET value = ? WHERE id = 'workspace'").run(raw)
    expect(() => new WorkspaceStore(db)).toThrow(/manifest is invalid/)
    expect(value(db, 'workspace')).toBe(raw)
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_items').get()).toEqual({
      count: 201,
    })
  } finally {
    error.mockRestore()
    db.close()
  }
})

it('loads the remaining tasks when one metadata row is unreadable and keeps that row', () => {
  const db = openDatabase(':memory:')
  try {
    new WorkspaceStore(db).update((current) => ({ ...current, tasks: [task, second] }))
    db.prepare("UPDATE workspace_tasks SET value = '{broken' WHERE task_id = 'second'").run()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new WorkspaceStore(db)
    expect(store.get().tasks.map((entry) => entry.id)).toEqual(['thread'])
    expect(error.mock.calls[0]?.[0]).toContain('tasks[1]')
    error.mockRestore()
    const backup = decode(
      mutableStruct({ value: Schema.String }),
      db.prepare("SELECT value FROM documents WHERE id LIKE 'workspace-backup:%:tasks'").get(),
    ).value
    expect(JSON.parse(backup)).toEqual({ second: '{broken' })
    store.updateTask('thread', (entry) => ({ ...entry, title: 'Still saved' }))
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: '{broken',
    })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM conversation_items WHERE task_id = 'second'").get(),
    ).toEqual({ count: 3 })
  } finally {
    db.close()
  }
})
it('preserves unreadable task rows and their manifest through rewrites and failed writes', () => {
  const db = openDatabase(':memory:')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    new WorkspaceStore(db).update((current) => ({ ...current, tasks: [task, second] }))
    db.prepare("UPDATE workspace_tasks SET value = '{broken' WHERE task_id = 'second'").run()
    const history = db
      .prepare("SELECT * FROM workspace_task_histories WHERE task_id = 'second'")
      .get()
    db.prepare("DELETE FROM workspace_task_histories WHERE task_id = 'thread'").run()
    const rowsBefore = db.prepare('SELECT * FROM workspace_tasks ORDER BY task_id').all()
    db.exec(
      "CREATE TRIGGER reject_rewrite BEFORE INSERT ON workspace_tasks BEGIN SELECT RAISE(ABORT, 'rewrite failure'); END",
    )
    expect(() => new WorkspaceStore(db)).toThrow(/rewrite failure/)
    db.exec('DROP TRIGGER reject_rewrite')
    expect(db.prepare('SELECT * FROM workspace_tasks ORDER BY task_id').all()).toEqual(rowsBefore)
    expect(
      db.prepare("SELECT * FROM workspace_task_histories WHERE task_id = 'second'").get(),
    ).toEqual(history)
    const store = new WorkspaceStore(db)
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: '{broken',
    })
    expect(
      db.prepare("SELECT * FROM workspace_task_histories WHERE task_id = 'second'").get(),
    ).toEqual(history)
    store.update((current) => ({ ...current, tasks: [...current.tasks, { ...task, id: 'third' }] }))
    const shell = decode(
      mutableStruct({ value: Schema.String }),
      db.prepare("SELECT value FROM documents WHERE id = 'workspace'").get(),
    ).value
    expect(JSON.parse(shell).taskIds).toContain('second')
    expect(() =>
      store.update((current) => ({ ...current, tasks: [...current.tasks, second] })),
    ).toThrow(/unreadable/)
    expect(
      decode(
        mutableStruct({ value: Schema.String }),
        db.prepare("SELECT value FROM documents WHERE id = 'workspace'").get(),
      ).value,
    ).toBe(shell)
    db.exec(
      "CREATE TRIGGER reject_workspace BEFORE UPDATE ON documents WHEN NEW.id = 'workspace' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    )
    expect(() =>
      store.update((current) => ({
        ...current,
        tasks: current.tasks.filter((entry) => entry.id !== 'third'),
      })),
    ).toThrow(/injected failure/)
    db.exec('DROP TRIGGER reject_workspace')
    expect(db.prepare("SELECT value FROM workspace_tasks WHERE task_id = 'second'").get()).toEqual({
      value: '{broken',
    })
    const reopened = new WorkspaceStore(db)
    expect(reopened.get().tasks.map((entry) => entry.id)).toEqual(['thread', 'third'])
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM conversation_items WHERE task_id = 'second'").get(),
    ).toEqual({ count: 3 })
  } finally {
    error.mockRestore()
    db.close()
  }
})
it('pages stored history exactly like the in-memory page at every cursor', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const large = 'x'.repeat(400 * 1024)
    const long: Task = {
      ...task,
      id: 'long',
      historyRevision: 3,
      messages: Array.from({ length: 260 }, (_, index) => ({
        id: `l${index}`,
        role: index % 3 === 0 ? 'user' : 'assistant',
        text: index % 41 === 0 ? large : `Line ${index}`,
        ...(index % 3 === 2 ? { turnId: `t${Math.floor(index / 3)}` } : {}),
      })),
      turns: Array.from({ length: 86 }, (_, index) => ({
        ...task.turns![0]!,
        id: `t${index}`,
        assistantId: `l${index * 3 + 1}`,
      })),
    }
    store.update((current) => ({ ...current, tasks: [long, second] }))
    const pages = [long, second].map((entry) => {
      let before: string | undefined
      let count = 0
      do {
        const stored = store.historyPage(entry.id, before)
        expect(stored).toEqual(conversationPage(store.task(entry.id), before))
        before = stored?.before
        count++
      } while (before)
      return count
    })
    expect(pages[0]).toBeGreaterThan(4)
    expect(pages[1]).toBe(1)
    expect(store.historyPage('long', 'missing')).toBeUndefined()
    expect(() => store.historyPage('unknown')).toThrow('Task not found')
    store.updateTaskHistory('long', (entry) => ({
      ...entry,
      messages: entry.messages.slice(0, 100),
    }))
    expect(store.historyPage('long', 'l150')).toBeUndefined()
    expect(store.historyPage('long')).toEqual(conversationPage(store.task('long')))
    expect(store.historyPage('long')?.historyRevision).toBe(4)
  } finally {
    db.close()
  }
})
it.each(['Message', 'Message\0', 'Message\ufffd'])(
  'pages every matching message for %s without loading whole histories',
  (query) => {
    const db = openDatabase(':memory:')
    try {
      const store = new WorkspaceStore(db)
      const messages = task.messages.map((message, index) => ({
        ...message,
        text: `${query} ${index}`,
      }))
      store.update((current) => ({ ...current, tasks: [{ ...task, messages }, second] }))
      const retained = store.retainedHistories()
      const ids: string[] = []
      let before: string | undefined
      do {
        const page = store.searchHistory(query, task.id, before)
        expect(page.hits.length).toBeLessThanOrEqual(50)
        ids.push(...page.hits.map((hit) => hit.messageId))
        before = page.nextBefore
      } while (before !== undefined)
      expect(ids).toEqual(messages.map((message) => message.id).reverse())
      expect(store.retainedHistories()).toEqual(retained)
      expect(() => store.searchHistory(query, task.id, 's0')).toThrow('cursor no longer exists')
    } finally {
      db.close()
    }
  },
)

it('searches stored history with the in-memory ordering, snippets and complete task list', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const busy: Task = {
      ...task,
      id: 'busy',
      updatedAt: '2026-10-03T00:00:00Z',
      messages: Array.from({ length: 70 }, (_, index) => ({
        id: `b${index}`,
        role: 'assistant',
        text: `${'context '.repeat(20)}Needle ${index}\n\tafter ${'tail '.repeat(40)}`,
      })),
    }
    const tie = {
      ...second,
      id: 'tie',
      messages: [{ id: 't0', role: 'user' as const, text: 'NEEDLE' }],
    }
    store.update((current) => ({ ...current, tasks: [task, second, busy, tie] }))
    for (const query of ['needle', '  NEEDLE ', 'message', 'ÄRGER', 'message 1', 'absent', '   '])
      expect(store.searchHistory(query)).toEqual(
        searchTaskMessages(
          store.get().tasks.map((entry) => store.task(entry.id)),
          query,
        ),
      )
    expect(store.searchHistory('needle').taskIds).toEqual(['busy', 'tie'])
    expect(store.searchHistory('needle').hits).toHaveLength(50)
    expect(store.searchHistory('message', 'second')).toEqual(
      searchTaskMessages([store.task('second')], 'message'),
    )
    store.updateTaskHistory('second', (entry) => ({
      ...entry,
      messages: entry.messages.map((message) =>
        message.id === 's0' ? { ...message, text: 'rewritten' } : message,
      ),
    }))
    expect(store.searchHistory('ärger').taskIds).toEqual([])
    expect(store.searchHistory('rewritten').hits.map((hit) => hit.messageId)).toEqual(['s0'])
  } finally {
    db.close()
  }
})
it('rebuilds the derived history index after an upgrade or drift', () => {
  const db = openDatabase(':memory:')
  try {
    new WorkspaceStore(db).update((current) => ({ ...current, tasks: [task, second] }))
    const index = db
      .prepare('SELECT * FROM conversation_index ORDER BY task_id, kind, item_id')
      .all()
    db.prepare("DELETE FROM documents WHERE id = 'conversation-index-version'").run()
    db.prepare('DELETE FROM conversation_index').run()
    expect(new WorkspaceStore(db).searchHistory('message 19').taskIds).toEqual(['thread'])
    expect(
      db.prepare('SELECT * FROM conversation_index ORDER BY task_id, kind, item_id').all(),
    ).toEqual(index)
    db.prepare("DELETE FROM conversation_index WHERE item_id = 'm5'").run()
    const store = new WorkspaceStore(db)
    expect(
      db.prepare('SELECT * FROM conversation_index ORDER BY task_id, kind, item_id').all(),
    ).toEqual(index)
    expect(store.historyPage('second')).toEqual(conversationPage(store.task('second')))
  } finally {
    db.close()
  }
})
