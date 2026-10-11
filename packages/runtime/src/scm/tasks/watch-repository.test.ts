import { expect, it, vi } from 'vite-plus/test'
import { decode, taskSchema } from '@dovo/protocol'
import { WatchLifecycleCache } from './watch-repository'

const task = () =>
  decode(taskSchema, {
    id: 'task',
    repositoryId: 'repo',
    agentId: '',
    title: 'Task',
    status: 'review',
    createdAt: '2026-10-10T00:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
it('reuses watch ownership across streaming writes and refreshes lifecycle/state changes', () => {
  const cache = new WatchLifecycleCache(),
    initial = task()
  const read = vi.fn<() => Set<string>>(() => new Set(['task']))
  for (let revision = 0; revision < 100; revision++)
    expect(
      cache.reconcile([{ ...initial, activity: `token-${revision}` }], revision, true, read),
    ).toEqual(new Set(['task']))
  expect(read).toHaveBeenCalledOnce()
  cache.reconcile([{ ...initial, archived: true }], 100, true, read)
  expect(read).toHaveBeenCalledTimes(2)
  cache.invalidate()
  cache.reconcile([{ ...initial, archived: true }], 101, true, read)
  expect(read).toHaveBeenCalledTimes(3)
})
it('invalidates transaction results after a rollback and editable-link changes', () => {
  const cache = new WatchLifecycleCache(),
    initial = task()
  const read = vi.fn<() => Set<string>>(() => new Set(['task']))
  cache.reconcile([initial], 0, true, read)
  cache.reconcile([initial], 1, true, read)
  cache.reconcile([initial], 0, true, read)
  expect(read).toHaveBeenCalledTimes(2)
  cache.reconcile(
    [
      {
        ...initial,
        linkedCheckouts: [
          { id: 'linked', repositoryId: 'linked', access: 'edit', execution: 'main' },
        ],
      },
    ],
    1,
    true,
    read,
  )
  expect(read).toHaveBeenCalledTimes(3)
})
