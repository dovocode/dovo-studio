import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import { TaskQueue } from './task-queue.js'
import { defaultTaskHarness, type MessageSource } from '@dovo/protocol'

it('retains runtime message provenance through queue persistence and delivery, while edits and duplicates belong to the user', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Work',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const source = {
      kind: 'thread' as const,
      runtimeId: 'local',
      runtimeIdentity: 'computer',
      threadId: 'reviewer',
      title: 'Reviewer',
    }
    queue.add('task', 'message', 'Review these results', [], undefined, false, false, undefined, {
      source,
    })
    expect(new WorkspaceStore(db).task('task').queue?.[0].source).toEqual(source)
    queue.duplicate('task', 'message', 'copy')
    expect(store.task('task').queue?.find((message) => message.id === 'copy')?.source).toEqual({
      kind: 'user',
    })
    queue.take('task', 'turn')
    expect(new WorkspaceStore(db).task('task').messages[0].source).toEqual(source)
    queue.add('task', 'edit', 'Original request', [], undefined, false, false, undefined, {
      source,
    })
    queue.edit('task', 'edit', 'My changed request', 'Original request')
    expect(store.task('task').queue?.find((message) => message.id === 'edit')?.source).toEqual({
      kind: 'user',
    })
    expect(store.task('task').subagentInbox ?? []).toHaveLength(0)
  } finally {
    db.close()
  }
})

it.each([
  { kind: 'pipeline', url: 'https://github.com/org/repo/actions/runs/1' },
  { kind: 'pull-request', url: 'https://github.com/org/repo/pull/1' },
  { kind: 'thread', runtimeId: 'local', threadId: 'parent', title: 'Parent' },
  { kind: 'automation', automationId: 'automation', runId: 'run', title: 'Reminder' },
  { kind: 'system', label: 'Studio' },
] satisfies MessageSource[])(
  'preserves matching composer contents when $kind input is queued, retried and delivered',
  (source) => {
    const db = openDatabase(':memory:')
    try {
      const store = new WorkspaceStore(db)
      const attachment = {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'photo.png',
        mime: 'image/png',
        size: 10,
      }
      const settings = { provider: 'codex' as const, model: 'large', reasoning: 'high' }
      const draft = {
        draft: 'Identical text',
        draftAttachments: [attachment],
        draftTurnSettings: settings,
      }
      store.update((workspace) => ({
        ...workspace,
        tasks: [
          {
            id: 'task',
            title: 'Work',
            repositoryId: '',
            agentId: '',
            harness: defaultTaskHarness('codex'),
            status: 'draft',
            createdAt: '',
            messages: [],
            files: [],
            ...draft,
            example: false,
          },
        ],
      }))
      const queue = new TaskQueue(store)
      const add = () =>
        queue.add(
          'task',
          'runtime-input',
          draft.draft,
          [attachment],
          undefined,
          false,
          false,
          undefined,
          {
            source,
            turnSettings: settings,
          },
        )
      expect(add()).toBe(true)
      expect(new WorkspaceStore(db).task('task')).toMatchObject(draft)
      expect(add()).toBe(false)
      queue.take('task', 'turn')
      expect(new WorkspaceStore(db).task('task')).toMatchObject(draft)
      expect(store.task('task').messages[0].source).toEqual(source)
      // Sending that exact draft explicitly still consumes its text, selected files and settings.
      queue.add(
        'task',
        'composer-input',
        draft.draft,
        [attachment],
        undefined,
        false,
        false,
        undefined,
        {
          source: { kind: 'user' },
          turnSettings: settings,
        },
      )
      expect(new WorkspaceStore(db).task('task')).toMatchObject({
        draft: '',
        draftAttachments: [],
        draftTurnSettings: null,
      })
      store.updateTask('task', (task) => ({ ...task, ...draft }))
      expect(
        queue.add(
          'task',
          'composer-input',
          draft.draft,
          [attachment],
          undefined,
          false,
          false,
          undefined,
          {
            source: { kind: 'user' },
            turnSettings: settings,
          },
        ),
      ).toBe(false)
      expect(new WorkspaceStore(db).task('task')).toMatchObject(draft)
    } finally {
      db.close()
    }
  },
)
