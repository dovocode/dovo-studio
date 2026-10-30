import { expect, it } from 'vite-plus/test'
import {
  canChangeTaskCheckout,
  agentTurnSettings,
  defaultTaskHarness,
  resolveTaskAgent,
  type TaskHarness,
} from '@dovo/protocol'
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
    const settings = { provider: 'codex' as const, model: 'large', reasoning: 'high' }
    store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((task) => ({
        ...task,
        harness: defaultTaskHarness('codex'),
        draft: 'A newer draft',
        draftTurnSettings: settings,
      })),
    }))
    queue.add('task', 'second', 'Another message', [], undefined, false, false, undefined, {
      turnSettings: settings,
    })
    expect(new WorkspaceStore(db).task('task').draft).toBe('A newer draft')
    expect(new WorkspaceStore(db).task('task').draftTurnSettings).toEqual(settings)
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
it('rejects queued restoration beyond the combined attachment limit without changing either input', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const files = Array.from({ length: 6 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `${index}.txt`,
      mime: 'text/plain',
      size: 1,
    }))
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'draft',
          title: 'Task',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Preserve draft',
          draftAttachments: files.slice(0, 3),
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    queue.add('draft', 'queued', 'Preserve queue', files.slice(3))
    const before = store.task('draft')
    expect(() => queue.change('draft', 'restore', 'queued')).toThrow('attachments')
    expect(store.task('draft')).toEqual(before)
  } finally {
    db.close()
  }
})

it('atomically reopens the settled family on explicit send, including attachment-only input', () => {
  const db = openDatabase(':memory:')
  try {
    let fail = false
    const store = new WorkspaceStore(db, () => {
      if (fail) throw new Error('Storage unavailable')
    })
    const task = {
      id: 'parent',
      title: 'Settled',
      repositoryId: '',
      agentId: '',
      status: 'review' as const,
      createdAt: '',
      messages: [],
      files: [],
      draft: '',
      example: false,
      archived: true,
      snoozedUntil: '2099-01-01T00:00:00Z',
    }
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        task,
        {
          ...task,
          id: 'child',
          delegation: { parentTaskId: 'parent', parentRunId: 'old', key: 'child' },
        },
        {
          ...task,
          id: 'archived-child',
          delegation: { parentTaskId: 'parent', parentRunId: 'old', key: 'archived-child' },
          archivedAt: '2026-10-01T00:00:00Z',
        },
        { ...task, id: 'unrelated' },
      ],
    }))
    const queue = new TaskQueue(store)
    const attachment = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'note.txt',
      mime: 'text/plain',
      size: 1,
    }
    const submit = () =>
      queue.add('parent', 'follow-up', '', [attachment], undefined, false, true, undefined, {
        reopenSettled: true,
      })
    expect(() => queue.add('parent', 'background', 'Background update')).toThrow('Restore')
    fail = true
    expect(submit).toThrow('Storage unavailable')
    expect(store.taskSubmission('parent', 'follow-up')).toBeUndefined()
    expect(new WorkspaceStore(db).task('parent').archived).toBe(true)
    expect(store.get().tasks.every((item) => item.archived)).toBe(true)
    fail = false
    expect(submit()).toBe(true)
    for (const id of ['parent', 'child'])
      expect(store.task(id)).toMatchObject({ archived: false, snoozedUntil: null })
    expect(store.task('parent').queue?.[0]).toMatchObject({ text: '', attachments: [attachment] })
    expect(store.task('archived-child').archivedAt).toBeTruthy()
    expect(store.task('unrelated').archived).toBe(true)
    store.updateTask('parent', (current) => ({ ...current, archived: true }))
    expect(submit()).toBe(false)
    expect(store.task('parent').archived).toBe(true)
    store.updateTask('parent', (current) => ({
      ...current,
      queue: Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        role: 'user' as const,
        text: 'Queued',
        createdAt: '',
      })),
    }))
    expect(() =>
      queue.add('parent', 'overflow', 'New', [], undefined, false, true, undefined, {
        reopenSettled: true,
      }),
    ).toThrow('Queue is full')
    expect(store.task('parent').archived).toBe(true)
    expect(store.taskSubmission('parent', 'overflow')).toBeUndefined()
  } finally {
    db.close()
  }
})

it('moves queued messages atomically, persists their order and rejects messages or destinations that started', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'sortable',
          title: 'Sortable',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Keep this draft',
          example: false,
          queuePaused: true,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const attachment = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'note.txt',
      mime: 'text/plain',
      size: 1,
    }
    queue.add('sortable', 'first', 'First')
    queue.add('sortable', 'second', 'Second')
    queue.add('sortable', 'third', '', [attachment])
    // A newly queued message must survive a move made from an older client snapshot.
    queue.add('sortable', 'fourth', 'Fourth')
    const receipt = store.taskSubmission('sortable', 'third')
    queue.move('sortable', 'third', 'first')
    expect(store.task('sortable').queue?.map((message) => message.id)).toEqual([
      'third',
      'first',
      'second',
      'fourth',
    ])
    queue.move('sortable', 'first', null)
    queue.move('sortable', 'second', 'second')
    queue.move('sortable', 'second', 'fourth')
    const persisted = new WorkspaceStore(db).task('sortable')
    expect(persisted.queue?.map((message) => message.id)).toEqual([
      'third',
      'second',
      'fourth',
      'first',
    ])
    expect(persisted.queue?.[0].attachments).toEqual([attachment])
    expect(persisted).toMatchObject({
      draft: 'Keep this draft',
      queuePaused: true,
      checkoutLocked: true,
    })
    expect(store.taskSubmission('sortable', 'third')).toBe(receipt)
    queue.take('sortable')
    const remaining = store.task('sortable').queue
    expect(() => queue.move('sortable', 'third', 'second')).toThrow(
      'already started or was removed',
    )
    expect(() => queue.move('sortable', 'first', 'third')).toThrow('queue changed while dragging')
    expect(store.task('sortable').queue).toEqual(remaining)
  } finally {
    db.close()
  }
})

it('unsnoozes accepted input without waking on background input, retries or rejected sends', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const snoozedUntil = '2099-01-01T00:00:00Z'
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'snoozed',
          title: 'Snoozed',
          repositoryId: '',
          agentId: '',
          status: 'review',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
          snoozedUntil,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const submit = (id: string, steering = false) =>
      queue.add('snoozed', id, 'Continue', [], undefined, false, false, undefined, {
        unsnooze: true,
        steering,
      })
    queue.add('snoozed', 'background', 'Agent result', [], undefined, false, false, 'child')
    expect(store.task('snoozed').snoozedUntil).toBe(snoozedUntil)
    for (const steering of [false, true]) {
      const id = steering ? 'steer' : 'send'
      expect(submit(id, steering)).toBe(true)
      expect(new WorkspaceStore(db).task('snoozed').snoozedUntil).toBeNull()
      store.updateTask('snoozed', (task) => ({ ...task, snoozedUntil }))
      expect(submit(id, steering)).toBe(false)
      expect(store.task('snoozed').snoozedUntil).toBe(snoozedUntil)
    }
    store.updateTask('snoozed', (task) => ({ ...task, archivedAt: '2026-10-01T00:00:00Z' }))
    expect(() => submit('rejected')).toThrow('Restore')
    expect(store.task('snoozed').snoozedUntil).toBe(snoozedUntil)
  } finally {
    db.close()
  }
})

it('persists per-message choices through reorder, editing, admission and restore with conflict checks', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Queue',
          repositoryId: '',
          agentId: '',
          harness: {
            provider: 'codex',
            model: 'default-model',
            endpoint: '',
            instructions: '',
            permission: 'ask',
          },
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    let queue = new TaskQueue(store)
    const settings = { provider: 'codex' as const, model: 'large', reasoning: 'high' }
    queue.add('task', 'one', 'One', [], undefined, false, false, undefined, {
      turnSettings: settings,
    })
    queue.add('task', 'two', 'Two')
    expect(
      queue.add('task', 'one', 'One', [], undefined, false, false, undefined, {
        turnSettings: { reasoning: 'high', model: 'large', provider: 'codex' },
      }),
    ).toBe(false)
    expect(() =>
      queue.add('task', 'one', 'One', [], undefined, false, false, undefined, {
        turnSettings: { ...settings, reasoning: 'low' },
      }),
    ).toThrow('different')
    expect(() =>
      queue.add('task', 'wrong', 'Wrong', [], undefined, false, false, undefined, {
        turnSettings: { ...settings, provider: 'claude' },
      }),
    ).toThrow('current harness')
    queue.move('task', 'two', 'one')
    queue.edit('task', 'one', 'Edited', 'One', { ...settings, reasoning: 'low' }, settings)
    expect(() => queue.edit('task', 'one', 'Stale', 'Edited', settings, settings)).toThrow(
      'changed',
    )
    // A legacy text-only client preserves the one-turn settings.
    queue.edit('task', 'one', 'Final', 'Edited')
    const restored = new WorkspaceStore(db)
    queue = new TaskQueue(restored)
    queue.take('task', 'first-run')
    expect(restored.task('task').runAttempt?.turnSettings).toBeUndefined()
    expect(resolveTaskAgent(restored.task('task'), [])?.model).toBe('default-model')
    queue.take('task', 'second-run')
    expect(restored.task('task').runAttempt?.turnSettings).toEqual({
      ...settings,
      reasoning: 'low',
    })
    expect(restored.task('task').messages.at(-1)?.turnSettings).toEqual({
      ...settings,
      reasoning: 'low',
    })
    expect(resolveTaskAgent(restored.task('task'), [])).toMatchObject({
      model: 'large',
      reasoning: 'low',
    })
    queue.add('task', 'restore', 'Restore', [], undefined, false, false, undefined, {
      turnSettings: settings,
    })
    restored.updateTask('task', (t) => ({ ...t, draft: 'Other draft' }))
    expect(() => queue.change('task', 'restore', 'restore')).toThrow('Clear the composer')
    restored.updateTask('task', (t) => ({ ...t, draft: '' }))
    queue.change('task', 'restore', 'restore')
    expect(restored.task('task')).toMatchObject({ draft: 'Restore', draftTurnSettings: settings })
    // Native draft text is stored on the phone, while its model choice is shared metadata.
    restored.updateTask('task', (t) => ({ ...t, draft: '' }))
    queue.add('task', 'mobile-send', 'Phone-only draft', [], undefined, false, false, undefined, {
      turnSettings: settings,
    })
    expect(restored.task('task').draftTurnSettings).toBeNull()
    restored.patch({
      collection: 'tasks',
      id: 'task',
      changes: { draftTurnSettings: { before: null, after: settings } },
    })
    queue.add('task', 'other-sender', 'Other device uses defaults')
    expect(restored.task('task').draftTurnSettings).toEqual(settings)
  } finally {
    db.close()
  }
})

it.each(['harness', 'custom agent'] as const)(
  'persists queued models in execution order without leaking full settings or changing the saved %s',
  (selection) => {
    const db = openDatabase(':memory:')
    try {
      const store = new WorkspaceStore(db)
      const harness: TaskHarness = {
        ...defaultTaskHarness('codex'),
        model: 'original',
        reasoning: 'low',
        serviceTier: 'priority',
        cyberAccessProgram: 'daybreakBlue',
        instructions: 'Thread instructions',
        env: { KEEP: 'yes' },
        permission: 'read-only' as const,
      }
      const custom = { ...harness, id: 'agent', name: 'Saved agent' }
      store.update((w) => ({
        ...w,
        agents: [custom],
        tasks: [
          {
            id: 'task',
            title: 'Queue',
            repositoryId: '',
            agentId: selection === 'custom agent' ? custom.id : '',
            ...(selection === 'harness' ? { harness } : {}),
            agentOverrides: { permission: 'ask' },
            status: 'running',
            createdAt: '',
            messages: [],
            files: [],
            draft: '',
            example: false,
          },
        ],
      }))
      const queue = new TaskQueue(store)
      const settings = agentTurnSettings(
        {
          ...harness,
          model: 'large',
          reasoning: 'high',
          serviceTier: undefined,
          cyberAccessProgram: undefined,
          permission: 'full-access',
          instructions: 'One-turn instructions',
          env: { TEMPORARY: 'yes' },
        },
        true,
      )
      queue.add('task', 'chosen', 'Use a larger model', [], undefined, false, false, undefined, {
        turnSettings: settings,
      })
      queue.add('task', 'inherited', 'Use the selected model')
      queue.add('task', 'earlier', 'Still uses the original model')
      queue.move('task', 'earlier', 'chosen')
      expect(resolveTaskAgent(store.task('task'), store.get().agents)?.model).toBe('original')
      queue.take('task', 'earlier-run')
      expect(resolveTaskAgent(store.task('task'), store.get().agents)?.model).toBe('original')
      queue.setPaused('task', 'chosen', true)
      expect(() => queue.take('task')).toThrow('Resume')
      expect(resolveTaskAgent(store.task('task'), store.get().agents)?.model).toBe('original')
      queue.setPaused('task', 'chosen', false)
      queue.take('task', 'chosen-run')

      // Reopen storage before the next turn: the defaults are durable, not composer state.
      const reopened = new WorkspaceStore(db)
      const selected = resolveTaskAgent(reopened.task('task'), reopened.get().agents)
      expect(selected).toMatchObject({
        model: 'large',
        reasoning: 'high',
        permission: 'ask',
        instructions: 'Thread instructions',
        env: { KEEP: 'yes' },
      })
      expect(selected?.serviceTier).toBeUndefined()
      expect(selected?.cyberAccessProgram).toBeUndefined()
      expect(reopened.task('task').runAttempt?.turnSettings).toEqual(settings)
      expect(reopened.task('task').harnessCustomized).toBe(true)
      expect(reopened.get().agents).toEqual([custom])
      const restoredQueue = new TaskQueue(reopened)
      restoredQueue.take('task', 'inherited-run')
      expect(reopened.task('task').runAttempt?.turnSettings).toBeUndefined()
      expect(resolveTaskAgent(reopened.task('task'), reopened.get().agents)).toEqual(selected)

      const reset = { provider: 'codex' as const, model: '', reasoning: '' }
      restoredQueue.add(
        'task',
        'removed',
        'Do not change models',
        [],
        undefined,
        false,
        false,
        undefined,
        {
          turnSettings: reset,
        },
      )
      restoredQueue.change('task', 'remove', 'removed')
      expect(resolveTaskAgent(reopened.task('task'), reopened.get().agents)).toEqual(selected)
      restoredQueue.add(
        'task',
        'reset',
        'Use provider defaults',
        [],
        undefined,
        false,
        false,
        undefined,
        {
          turnSettings: reset,
        },
      )
      restoredQueue.take('task', 'reset-run')
      expect(resolveTaskAgent(reopened.task('task'), reopened.get().agents)).toMatchObject({
        model: '',
        reasoning: '',
      })
    } finally {
      db.close()
    }
  },
)

it('includes full turn settings in stable submission receipts', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const harness = defaultTaskHarness('codex')
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Queue',
          repositoryId: '',
          agentId: '',
          harness,
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
    const settings = agentTurnSettings(
      { ...harness, permission: 'full-access', env: { A: '1', B: '2' } },
      true,
    )
    queue.add('task', 'message', 'Next', [], undefined, false, false, undefined, {
      turnSettings: settings,
    })
    expect(
      queue.add('task', 'message', 'Next', [], undefined, false, false, undefined, {
        turnSettings: agentTurnSettings(
          { ...harness, permission: 'full-access', env: { B: '2', A: '1' } },
          true,
        ),
      }),
    ).toBe(false)
    expect(() =>
      queue.add('task', 'message', 'Next', [], undefined, false, false, undefined, {
        turnSettings: agentTurnSettings(
          { ...harness, permission: 'ask', env: { A: '1', B: '2' } },
          true,
        ),
      }),
    ).toThrow('different')
  } finally {
    db.close()
  }
})

it('persists pauses through editing and dragging and never skips a paused queue head', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'paused-queue',
          title: 'Queue',
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
    queue.add('paused-queue', 'first', 'First')
    queue.add('paused-queue', 'second', 'Second')
    queue.add('paused-queue', 'third', 'Third')
    queue.setPaused('paused-queue', 'first', true)
    queue.setPaused('paused-queue', 'third', true)
    queue.edit('paused-queue', 'first', 'Edited first', 'First')
    queue.move('paused-queue', 'third', 'first')
    const reloaded = new WorkspaceStore(db)
    expect(
      reloaded.taskSummary('paused-queue').queue?.map(({ id, paused }) => ({ id, paused })),
    ).toEqual([
      { id: 'third', paused: true },
      { id: 'first', paused: true },
      { id: 'second', paused: undefined },
    ])
    expect(() => queue.take('paused-queue')).toThrow('Resume the first queued message')
    expect(store.task('paused-queue').messages).toEqual([])
    // Resuming a later message leaves the head blocking all following input.
    queue.setPaused('paused-queue', 'first', false)
    expect(() => queue.take('paused-queue')).toThrow('Resume the first queued message')
    // Moving the paused head behind other input makes the new front runnable.
    queue.move('paused-queue', 'third', null)
    queue.take('paused-queue')
    expect(store.task('paused-queue').messages.map((message) => message.id)).toEqual(['first'])
    expect(() => queue.setPaused('paused-queue', 'first', true)).toThrow('already started')
    queue.take('paused-queue')
    expect(store.task('paused-queue').messages.map((message) => message.id)).toEqual([
      'first',
      'second',
    ])
    expect(() => queue.take('paused-queue')).toThrow('Resume the first queued message')
    expect(store.taskSummary('paused-queue').queue?.[0]).toMatchObject({
      id: 'third',
      paused: true,
    })
    store.updateTask('paused-queue', (task) => ({
      ...task,
      queue: task.queue?.map((message) => ({ ...message, steering: true })),
    }))
    expect(() => queue.setPaused('paused-queue', 'third', true)).toThrow('being delivered')
  } finally {
    db.close()
  }
})

it('duplicates adjacent queued input with attachments, settings and pause state without changing drafts', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const settings = { provider: 'codex' as const, model: 'large', reasoning: 'high' }
    const attachment = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'photo.png',
      mime: 'image/png',
      size: 10,
    }
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Queue',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          harness: defaultTaskHarness('codex'),
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Unrelated draft',
          draftAttachments: [attachment],
          draftTurnSettings: settings,
          queuePaused: true,
          example: false,
          queue: [
            {
              id: 'source',
              role: 'user',
              text: 'Review this',
              attachments: [attachment],
              turnSettings: settings,
              paused: true,
              review: true,
              subagentResultId: 'child',
              createdAt: 'old',
            },
            { id: 'next', role: 'user', text: 'Next', createdAt: '' },
          ],
        },
      ],
    }))
    const queue = new TaskQueue(store)
    queue.duplicate('task', 'source', 'copy')
    const saved = new WorkspaceStore(db).task('task')
    expect(saved.queue?.map((m) => m.id)).toEqual(['source', 'copy', 'next'])
    expect(saved.queue?.[1]).toMatchObject({
      id: 'copy',
      text: 'Review this',
      attachments: [attachment],
      turnSettings: settings,
      paused: true,
    })
    expect(saved.queue?.[1].createdAt).not.toBe('old')
    expect(saved.queue?.[1].review).toBeUndefined()
    expect(saved.queue?.[1].subagentResultId).toBeUndefined()
    expect(saved).toMatchObject({
      draft: 'Unrelated draft',
      draftAttachments: [attachment],
      draftTurnSettings: settings,
      queuePaused: true,
    })
    // A lost response can be retried after editing/removing the source, or a runtime restart.
    queue.edit('task', 'source', 'Changed', 'Review this')
    queue.change('task', 'remove', 'source')
    new TaskQueue(new WorkspaceStore(db)).duplicate('task', 'source', 'copy')
    expect(store.task('task').queue?.filter((m) => m.id === 'copy')).toHaveLength(1)
    expect(store.task('task').queue?.find((m) => m.id === 'copy')?.text).toBe('Review this')
    expect(() => queue.duplicate('task', 'next', 'copy')).toThrow('already in use')
    expect(() => queue.duplicate('task', 'source', 'new-copy')).toThrow('already started')
  } finally {
    db.close()
  }
})

it('rejects duplication of delivering or archived messages, collisions and overflow without queue changes', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'task',
          title: 'Queue',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [{ id: 'history', role: 'user', text: 'Sent', createdAt: '' }],
          files: [],
          draft: '',
          example: false,
          queue: [{ id: 'source', role: 'user', text: 'Input', createdAt: '', steering: true }],
        },
      ],
    }))
    const queue = new TaskQueue(store)
    expect(() => queue.duplicate('task', 'source', 'copy')).toThrow('being delivered')
    const before = store.task('task')
    for (const action of [
      () => queue.edit('task', 'source', 'Edited', 'Input'),
      () => queue.change('task', 'remove', 'source'),
      () => queue.change('task', 'restore', 'source'),
      () =>
        queue.restore('task', {
          requestId: 'restore-delivering',
          messageId: 'source',
          expectedText: 'Input',
          expectedTurnSettings: null,
          expectedDraftTurnSettings: null,
          expectedAttachmentIds: [],
        }),
    ])
      expect(action).toThrow(expect.objectContaining({ status: 409 }))
    expect(store.task('task')).toEqual(before)
    expect(db.prepare('SELECT * FROM queue_restore_receipts').all()).toEqual([])

    store.updateTask('task', (t) => ({
      ...t,
      queue: t.queue?.map((m) => ({ ...m, steering: false })),
    }))
    for (const id of ['source', 'history'])
      expect(() => queue.duplicate('task', 'source', id)).toThrow('already in use')
    store.updateTask('task', (t) => ({ ...t, archived: true }))
    expect(() => queue.duplicate('task', 'source', 'copy')).toThrow('Restore')
    store.updateTask('task', (t) => ({
      ...t,
      archived: false,
      queue: [
        ...(t.queue ?? []),
        ...Array.from({ length: 49 }, (_, i) => ({
          id: String(i),
          role: 'user' as const,
          text: 'Next',
          createdAt: '',
        })),
      ],
    }))
    const full = store.task('task')
    expect(() => queue.duplicate('task', 'source', 'copy')).toThrow('Queue is full')
    expect(store.task('task')).toEqual(full)
    expect(store.taskSubmission('task', 'copy')).toBeUndefined()
  } finally {
    db.close()
  }
})

it('persists subagent input separately from full user queues, drafts and conversation history', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'parent',
          title: 'Parent',
          repositoryId: 'repo',
          agentId: 'agent',
          status: 'review',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Child answer',
          example: false,
          lastPromptAt: 'original',
          queuePaused: true,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    for (let i = 0; i < 50; i++) queue.add('parent', `user-${i}`, `User ${i}`)
    // Keep the first user message paused: internal delivery must not resume or remove it.
    queue.setPaused('parent', 'user-0', true)
    expect(queue.addSubagentResult('parent', 'result', 'Child answer', 'child')).toBe(true)
    expect(queue.addSubagentResult('parent', 'result', 'Child answer', 'child')).toBe(false)
    expect(() => queue.addSubagentResult('parent', 'result', 'Different', 'child')).toThrow(
      'already in use',
    )
    expect(store.task('parent').draft).toBe('Child answer')
    expect(store.task('parent').queuePaused).toBe(true)
    const before = store.task('parent').lastPromptAt
    const restored = new WorkspaceStore(db)
    expect(restored.task('parent').subagentInbox).toHaveLength(1)
    const resumedQueue = new TaskQueue(restored)
    resumedQueue.take('parent', 'run', 'attempt')
    expect(restored.task('parent').runAttempt?.subagentInputs?.[0]).toMatchObject({
      text: 'Child answer',
      subagentResultId: 'child',
    })
    expect(restored.task('parent').messages).toEqual([])
    expect(restored.task('parent').queue).toHaveLength(50)
    expect(restored.task('parent').queue?.[0].paused).toBe(true)
    expect(restored.task('parent').lastPromptAt).toBe(before)
    expect(restored.task('parent').draft).toBe('Child answer')
    expect(restored.task('parent').subagentInbox).toEqual([])
    // Failed admission must retain internal input for a retry.
    resumedQueue.take('parent', 'retry', 'retry-attempt')
    expect(restored.task('parent').runAttempt?.subagentInputs?.[0].text).toBe('Child answer')
    // Manual compaction does not accept delegated input and must not consume it.
    restored.updateTask('parent', (task) => ({
      ...task,
      queue: [{ id: 'compact', role: 'user', text: '/compact', createdAt: '' }],
    }))
    resumedQueue.take('parent', 'compact-run', 'compact-attempt')
    expect(restored.task('parent').runAttempt?.subagentInputs).toBeUndefined()
    expect(restored.task('parent').subagentInbox?.[0].text).toBe('Child answer')

    expect(resumedQueue.addSubagentResult('parent', 'result', 'Child answer', 'child')).toBe(false)
  } finally {
    db.close()
  }
})

it('persists atomic restore receipts across restart and rejects changed contents without consuming the message', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((w) => ({
      ...w,
      tasks: [
        {
          id: 'restore',
          title: 'Restore',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          execution: 'main',
          createdAt: '',
          messages: [],
          files: [],
          draft: 'Draft',
          example: false,
          queuePaused: true,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const attachment = {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'a.txt',
      mime: 'text/plain',
      size: 1,
    }
    queue.add('restore', 'queued', 'Queue text', [attachment])
    const input = {
      requestId: 'operation',
      messageId: 'queued',
      expectedText: 'Queue text',
      expectedAttachmentIds: ['10000000-0000-4000-8000-000000000001'],
      expectedTurnSettings: null,
      expectedDraftTurnSettings: null,
    }
    expect(() => queue.restore('restore', { ...input, expectedAttachmentIds: [] })).toThrow(
      'changed',
    )
    expect(store.taskSummary('restore').queue).toHaveLength(1)
    store.updateTask('restore', (t) => ({
      ...t,
      draftTurnSettings: { provider: 'codex', model: 'new-choice', reasoning: '' },
    }))
    expect(() => queue.restore('restore', input)).toThrow('draft model settings changed')
    store.updateTask('restore', (t) => ({ ...t, draftTurnSettings: null }))
    db.exec(
      `CREATE TRIGGER fail_restore_receipt BEFORE INSERT ON queue_restore_receipts BEGIN SELECT RAISE(ABORT, 'receipt disk failure'); END`,
    )
    expect(() => queue.restore('restore', input)).toThrow('receipt disk failure')
    expect(store.taskSummary('restore')).toMatchObject({
      draft: 'Draft',
      queue: [{ id: 'queued' }],
    })
    expect(db.prepare('SELECT * FROM queue_restore_receipts').all()).toEqual([])
    db.exec('DROP TRIGGER fail_restore_receipt')
    expect(queue.restore('restore', input)).toBe(true)
    const reopened = new WorkspaceStore(db)
    reopened.updateTask('restore', (t) => ({ ...t, draft: 'New typing' }))
    expect(new TaskQueue(reopened).restore('restore', input)).toBe(false)
    expect(reopened.taskSummary('restore')).toMatchObject({
      draft: 'New typing',
      draftAttachments: [attachment],
      queue: [],
    })
    expect(() =>
      new TaskQueue(reopened).restore('restore', { ...input, messageId: 'other' }),
    ).toThrow('another request')
  } finally {
    db.close()
  }
})
