import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { TaskPullWatcher } from './task-pulls'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const pull = (state: 'open' | 'merged', checksState: string | null) => ({
  number: 7,
  title: 'Fix',
  url: 'https://github.com/o/r/pull/7',
  state,
  draft: false,
  author: 'me',
  updatedAt: '2026-09-27T10:00:00Z',
  head: 'dovo/fix-7',
  base: 'main',
  labels: [],
  checksState,
})

it('follows a task’s pull request by branch and archives it on merge only when enabled', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'pulls-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Fix',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  s.store.updateTask(task.id, (value) => ({
    ...value,
    checkoutBranch: 'dovo/fix-7',
    status: 'review',
  }))
  const updatedAt = s.store.task(task.id).updatedAt
  const list = vi.spyOn(s.pullCache, 'list')
  const detail = vi.spyOn(s.pullCache, 'detail')
  const watcher = new TaskPullWatcher(s)

  list.mockResolvedValue({ pulls: [pull('open', 'PENDING')], hasMore: false, page: 1 })
  await watcher.refresh()
  expect(s.store.task(task.id).pullStatus).toMatchObject({
    number: 7,
    state: 'open',
    checks: 'pending',
  })
  // Status is metadata: it neither reorders the list nor counts as activity.
  expect(s.store.task(task.id).updatedAt).toBe(updatedAt)

  list.mockResolvedValue({ pulls: [pull('open', 'FAILURE')], hasMore: false, page: 1 })
  detail.mockResolvedValue({
    pull: { ...pull('open', 'FAILURE') },
    checks: [
      { name: 'lint', status: 'failure' },
      { name: 'test', status: 'SUCCESS' },
    ],
  } as unknown as Awaited<ReturnType<typeof s.pullCache.detail>>)
  await watcher.refresh()
  expect(s.store.task(task.id).pullStatus).toMatchObject({
    checks: 'failed',
    failedChecks: ['lint'],
  })

  // Merged: it left the open list; the detail says so. Off by default, so nothing is archived.
  list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  detail.mockResolvedValue({
    pull: { ...pull('merged', null) },
    checks: [],
  } as unknown as Awaited<ReturnType<typeof s.pullCache.detail>>)
  await watcher.refresh()
  expect(s.store.task(task.id)).toMatchObject({ pullStatus: { state: 'merged' } })
  expect(s.store.task(task.id).archivedAt).toBeUndefined()

  s.preferences.save({ ...s.preferences.get(), archiveOnPullMerge: true })
  await watcher.refresh()
  expect(s.store.task(task.id).archivedAt).toBeDefined()
})

it('finds branch pull requests on later pages and reuses those pages for the repository', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'pulls-pages-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const tasks = ['dovo/older', 'dovo/newer'].map((branch) => {
    const task = s.tasks.create({
      title: branch,
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    s.store.updateTask(task.id, (value) => ({ ...value, checkoutBranch: branch, status: 'review' }))
    return task
  })
  const list = vi.spyOn(s.pullCache, 'list').mockImplementation(async (_cwd, _state, page) => ({
    pulls: [
      {
        ...pull('open', 'SUCCESS'),
        number: page === 1 ? 8 : 7,
        head: page === 1 ? 'dovo/newer' : 'dovo/older',
      },
    ],
    hasMore: page === 1,
    page,
  }))

  await new TaskPullWatcher(s).refresh()

  expect(s.store.task(tasks[0].id).pullStatus).toMatchObject({ number: 7, state: 'open' })
  expect(s.store.task(tasks[1].id).pullStatus).toMatchObject({ number: 8, state: 'open' })
  expect(list.mock.calls.map(([, , page]) => page)).toEqual([1, 2])
})
