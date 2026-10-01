import { expect, it } from 'vitest'
import { canChangeTaskCheckout } from '@dovo/protocol'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { Activity } from '../../storage/activity'
import { TaskQueue } from './task-queue'
it('keeps the checkout locked when the first queued message is removed before running', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'draft',
          title: 'New task',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'draft',
          execution: 'main',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
          queuePaused: true,
        },
      ],
    }))
    expect(canChangeTaskCheckout(store.task('draft'))).toBe(true)
    const queue = new TaskQueue(store)
    queue.add('draft', 'message', 'Submitted input')
    queue.change('draft', 'remove', 'message')
    const restored = new WorkspaceStore(db)
    const restoredQueue = new TaskQueue(restored)
    expect(restoredQueue.add('draft', 'message', 'Submitted input')).toBe(false)
    expect(() => restoredQueue.add('draft', 'message', 'Changed input')).toThrow('different text')
    expect(() =>
      restoredQueue.add('draft', 'message', 'Submitted input', [
        { id: 'file', name: 'a.txt', mime: 'text/plain', size: 1 },
      ]),
    ).toThrow('attachments')
    expect(restored.task('draft').messages).toEqual([])
    expect(restored.task('draft').queue).toEqual([])
    expect(canChangeTaskCheckout(restored.task('draft'))).toBe(false)
    expect(() =>
      restored.patch({
        collection: 'tasks',
        id: 'draft',
        changes: { execution: { before: 'main', after: 'worktree' } },
      }),
    ).toThrow('before sending the first message')
    expect(() =>
      restored.patch({
        collection: 'tasks',
        id: 'draft',
        changes: { checkoutLocked: { before: true, after: false } },
      }),
    ).toThrow('Cannot edit checkoutLocked')
  } finally {
    db.close()
  }
})

it('returns canceled queued text and attachments to the draft', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'draft',
          title: 'Task',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'draft',
          execution: 'main',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Current draft',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const file = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'a.txt',
      mime: 'text/plain',
      size: 1,
    }
    queue.add('draft', 'queued', 'Queued text', [file])
    queue.change('draft', 'restore', 'queued')
    expect(store.task('draft').queue).toEqual([])
    expect(store.task('draft').draft).toBe('Current draft\n\nQueued text')
    expect(store.task('draft').draftAttachments).toEqual([file])
  } finally {
    db.close()
  }
})

it('commits the receipt and queued input together and clears receipts only when the task is deleted', () => {
  const db = openDatabase(':memory:')
  try {
    let fail = false
    const store = new WorkspaceStore(db, () => {
      if (fail) throw new Error('Storage unavailable')
    })
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Receipt',
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
    fail = true
    expect(() => queue.add('task', 'input', 'Work')).toThrow('Storage unavailable')
    expect(store.taskSubmission('task', 'input')).toBeUndefined()
    expect(store.task('task').queue).toBeUndefined()
    fail = false
    expect(queue.add('task', 'input', 'Work')).toBe(true)
    expect(store.taskSubmission('task', 'input')).toBeTruthy()
    store.update((w) => ({ ...w, tasks: [] }))
    expect(store.taskSubmission('task', 'input')).toBeUndefined()
  } finally {
    db.close()
  }
})

it('does not replay a completed provider turn if restart interrupts change capture', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Finalize',
          repositoryId: '',
          agentId: '',
          status: 'running',
          runPhase: 'finalizing',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
          turns: [
            {
              id: 'turn',
              assistantId: 'answer',
              agentId: '',
              provider: 'codex',
              model: '',
              status: 'completed',
              startedAt: '2026-09-24T00:00:00Z',
              finishedAt: '2026-09-24T00:01:00Z',
              checkpoint: { before: 'ref', files: [], omitted: [] },
            },
          ],
          queue: [{ id: 'next', role: 'user', text: 'Next task', createdAt: '' }],
        },
      ],
    }))
    const recovered = new WorkspaceStore(db).task('task')
    expect(recovered).toMatchObject({
      status: 'review',
      queuePaused: true,
      restartRecovery: { kind: 'turn', automatic: true },
    })
    expect(recovered.runPhase).toBe('finalizing')
    expect(recovered.turns?.[0]).toMatchObject({
      status: 'completed',
      finishedAt: '2026-09-24T00:01:00Z',
    })
    expect(recovered.turns?.[0].checkpoint?.error).toContain('change capture')
  } finally {
    db.close()
  }
})

it('recovers queued input after restart, pauses it and retains removed submissions in history', () => {
  const db = openDatabase(':memory:')
  try {
    const activity = new Activity(db),
      store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Recovery',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'running',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store, activity)
    queue.add('task', 'input', 'Keep this request')
    const restored = new WorkspaceStore(db)
    expect(restored.task('task').queuePaused).toBe(true)
    expect(restored.task('task').status).toBe('failed')
    expect(restored.task('task').queue?.[0].text).toBe('Keep this request')
    new TaskQueue(restored, activity).change('task', 'remove', 'input')
    expect(restored.task('task').queue).toEqual([])
    expect(activity.list('Keep this request', 'message', 0).events).toHaveLength(1)
  } finally {
    db.close()
  }
})
it('keeps the stored workspace unchanged when activity persistence fails', () => {
  const db = openDatabase(':memory:')
  try {
    let fail = false
    const store = new WorkspaceStore(db, () => {
      if (fail) throw new Error('Storage unavailable')
    })
    fail = true
    expect(() => store.update((w) => ({ ...w, runtimeAddress: 'changed' }))).toThrow(
      'Storage unavailable',
    )
    expect(store.get().runtimeAddress).toBe('')
    expect(new WorkspaceStore(db).get().runtimeAddress).toBe('')
  } finally {
    db.close()
  }
})

it('clears an accepted server draft atomically without erasing a newer draft', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Draft',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: ' Send this ',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    queue.add('task', 'first', 'Send this')
    expect(new WorkspaceStore(db).task('task').draft).toBe('')
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({ ...task, draft: 'A newer draft' })),
    }))
    queue.add('task', 'second', 'Another message')
    expect(new WorkspaceStore(db).task('task').draft).toBe('A newer draft')
    queue.add('task', 'first', 'Send this')
    expect(store.task('task').draft).toBe('A newer draft')
  } finally {
    db.close()
  }
})

it('edits a queued message in place, preserves attachments and order, and rejects stale or already-started edits', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Queue',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          execution: 'main',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const file = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'photo.png',
      mime: 'image/png',
      size: 10,
    }
    queue.add('task', 'first', 'Original', [file])
    queue.add('task', 'second', 'Next')
    queue.edit('task', 'first', 'Updated', 'Original')
    expect(store.task('task').queue?.map((message) => message.id)).toEqual(['first', 'second'])
    expect(store.task('task').queue?.[0]).toMatchObject({ text: 'Updated', attachments: [file] })
    expect(new WorkspaceStore(db).task('task').queue?.[0]?.text).toBe('Updated')
    expect(() => queue.edit('task', 'first', 'Conflict', 'Original')).toThrow('changed')
    expect(queue.accepted('task', 'first', 'Original', [file])).toBe(true)
    queue.change('task', 'restore', 'first')
    expect(store.task('task')).toMatchObject({ draft: 'Updated', draftAttachments: [file] })
    expect(() => queue.edit('task', 'first', 'Too late', 'Updated')).toThrow('already started')
    expect(() => queue.edit('task', 'second', ' ', 'Next')).toThrow('text or attachments')
  } finally {
    db.close()
  }
})

it('persists prompt submission time without moving it for answers, reviews or queue changes', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'prompt-order',
          title: 'Task',
          repositoryId: 'repo',
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
    queue.add('prompt-order', 'prompt', 'Real prompt')
    const submitted = store.task('prompt-order').lastPromptAt
    expect(submitted).toBeTruthy()
    queue.add('prompt-order', 'answer:question', 'Question answer', [], {
      id: 'question',
      fingerprint: 'receipt',
    })
    queue.add('prompt-order', 'review', 'Review changes', [], undefined, true)
    queue.add('prompt-order', 'compact', '/compact')
    queue.change('prompt-order', 'remove', 'prompt')
    expect(new WorkspaceStore(db).task('prompt-order').lastPromptAt).toBe(submitted)
    expect(queue.add('prompt-order', 'prompt', 'Real prompt')).toBe(false)
    expect(store.task('prompt-order').lastPromptAt).toBe(submitted)
  } finally {
    db.close()
  }
})
