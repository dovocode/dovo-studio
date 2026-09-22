import { expect, it } from 'vitest'
import { canChangeTaskCheckout } from '@dovo/protocol'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { Activity } from '../storage/activity'
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
