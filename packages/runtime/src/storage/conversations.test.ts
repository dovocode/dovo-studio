import { expect, it } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, mutableStruct, type Task, type Workspace } from '@dovo/protocol'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
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
    const store = new WorkspaceStore(db, (before, after) => activity.workspace(before, after))
    expect(value(db, 'workspace-before-history-v2')).toBe(JSON.stringify(workspace))
    expect(value(db, 'workspace')).not.toContain('Message 199')
    db.exec(
      `CREATE TABLE history_writes (item_id TEXT); CREATE TRIGGER history_update AFTER UPDATE ON conversation_items BEGIN INSERT INTO history_writes VALUES (NEW.item_id); END;`,
    )
    store.updateTask(task.id, (task) => ({ ...task, activity: 'Working' }))
    expect(db.prepare('SELECT * FROM history_writes').all()).toEqual([])
    store.updateTask(task.id, (task) => ({
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
      "CREATE TRIGGER fail_commit BEFORE UPDATE ON documents WHEN NEW.id = 'workspace' BEGIN SELECT RAISE(ABORT, 'Disk full'); END",
    )
    expect(() =>
      store.updateTask(
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
      store.updateTask(task.id, (t) => ({
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
