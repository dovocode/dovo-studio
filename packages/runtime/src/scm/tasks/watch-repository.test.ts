import { expect, it, vi } from 'vite-plus/test'
import { decode, taskSchema } from '@dovo/protocol'
import { WatchLifecycleCache, watchAccountRepositoryId } from './watch-repository'

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

it('inherits a primary or sole editable linked account and requires selection between linked accounts', () => {
  const primary = task()
  const projects = new Set(['repo', 'linked', 'other'])
  expect(watchAccountRepositoryId(primary, projects)).toBe('repo')
  const general = {
    ...primary,
    repositoryId: 'scratch',
    linkedCheckouts: [
      {
        id: 'ref',
        repositoryId: 'other',
        execution: 'main' as const,
        access: 'read-only' as const,
      },
      { id: 'edit', repositoryId: 'linked', execution: 'main' as const, access: 'edit' as const },
    ],
  }
  expect(watchAccountRepositoryId(general, projects)).toBe('linked')
  expect(() =>
    watchAccountRepositoryId(
      {
        ...general,
        linkedCheckouts: general.linkedCheckouts.map((link) => ({ ...link, access: 'edit' })),
      },
      projects,
    ),
  ).toThrow('Specify repositoryId')
  expect(watchAccountRepositoryId({ ...general, linkedCheckouts: [] }, projects)).toBe('scratch')
})
