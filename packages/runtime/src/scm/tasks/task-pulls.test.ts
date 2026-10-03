import { decode, pullDetailSchema } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { TaskPullWatcher } from './task-pulls'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const pull = (state: 'open' | 'merged' | 'closed', checksState: string | null) => ({
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
  const detail = vi.spyOn(s.pullCache, 'status')
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

async function smartFixture(state: 'closed' | 'merged' = 'closed') {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'smart-pulls-test-owner-token-at-least-32-characters',
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
  const list = vi
    .spyOn(s.pullCache, 'list')
    .mockResolvedValue({ pulls: [pull('open', null)], hasMore: false, page: 1 })
  const detail = vi.spyOn(s.pullCache, 'status').mockResolvedValue(
    decode(pullDetailSchema, {
      pull: {
        ...pull(state, null),
        repositoryUrl: 'https://github.com/o/r',
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        body: '',
        additions: null,
        deletions: null,
        changedFiles: null,
        mergeable: null,
        reviewers: [],
        assignees: [],
      },
      comments: [],
      files: [],
      checks: [],
      warnings: [],
    }),
  )
  return { s, task, list, detail, watcher: new TaskPullWatcher(s) }
}

it.each(['settle', 'archive'] as const)(
  'protects pending descendants then %ss the whole PR task family',
  async (policy) => {
    const f = await smartFixture('merged')
    const child = f.s.tasks.create({
      title: 'Child',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    const nested = f.s.tasks.create({
      title: 'Nested',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    f.s.store.updateTask(child.id, (task) => ({
      ...task,
      draft: 'Pending child work',
      delegation: { parentTaskId: f.task.id, parentRunId: 'old', key: 'child' },
    }))
    f.s.store.updateTask(nested.id, (task) => ({
      ...task,
      delegation: { parentTaskId: child.id, parentRunId: 'old', key: 'nested' },
    }))
    f.s.preferences.save({
      ...f.s.preferences.get(),
      settleOnPullClose: policy === 'settle',
      archiveOnPullMerge: policy === 'archive',
    })
    await f.watcher.refresh()
    f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
    await f.watcher.refresh()
    expect(f.s.store.task(f.task.id).archived).not.toBe(true)
    f.s.store.updateTask(child.id, (task) => ({ ...task, draft: '' }))
    await f.watcher.refresh()
    for (const id of [f.task.id, child.id, nested.id]) {
      expect(f.s.store.task(id).archived).toBe(true)
      expect(Boolean(f.s.store.task(id).archivedAt)).toBe(policy === 'archive')
    }
  },
)

it('keeps the PR family unsettled when its activity audit cannot commit', async () => {
  const f = await smartFixture('merged')
  const child = f.s.tasks.create({
    title: 'Child',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  f.s.store.updateTask(child.id, (task) => ({
    ...task,
    delegation: { parentTaskId: f.task.id, parentRunId: 'old', key: 'child' },
  }))
  f.s.preferences.save({ ...f.s.preferences.get(), settleOnPullClose: true })
  await f.watcher.refresh()
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  const add = f.s.activity.add.bind(f.s.activity)
  vi.spyOn(f.s.activity, 'add').mockImplementation((...args) => {
    if (args[2].startsWith('Settled because')) throw new Error('Audit write failed')
    return add(...args)
  })
  await f.watcher.refresh()
  for (const id of [f.task.id, child.id]) expect(f.s.store.task(id).archived).not.toBe(true)
})

it('does not archive a closed PR family when new child work arrives during resource cleanup', async () => {
  const f = await smartFixture('merged')
  const child = f.s.tasks.create({
    title: 'Child',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  f.s.store.updateTask(child.id, (task) => ({
    ...task,
    delegation: { parentTaskId: f.task.id, parentRunId: 'old', key: 'child' },
  }))
  f.s.preferences.save({ ...f.s.preferences.get(), archiveOnPullMerge: true })
  await f.watcher.refresh()
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  let entered!: () => void
  let release!: () => void
  const closing = new Promise<void>((resolve) => (entered = resolve))
  const gate = new Promise<void>((resolve) => (release = resolve))
  vi.spyOn(f.s.browsers, 'closeTask').mockImplementation(async (id) => {
    if (id === f.task.id) {
      entered()
      await gate
    }
  })
  const refresh = f.watcher.refresh()
  try {
    await closing
    f.s.store.updateTask(child.id, (task) => ({ ...task, draft: 'New child work' }))
    release()
    await refresh
    expect(f.s.store.task(f.task.id).archivedAt).toBeUndefined()
    expect(f.s.store.task(child.id).archivedAt).toBeUndefined()
  } finally {
    release()
    await refresh
  }
})
it('smart-links branch PRs and verified message URLs, ignores foreign projects and keeps unlinked PRs dismissed', async () => {
  const f = await smartFixture()
  f.s.store.updateTask(f.task.id, (task) => ({
    ...task,
    messages: [
      {
        id: 'm',
        role: 'assistant',
        text: 'https://github.com/o/r/pull/7 and https://github.com/other/r/pull/7.',
      },
    ],
  }))
  const updatedAt = f.s.store.task(f.task.id).updatedAt
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).linkedPullRequests).toEqual([
    {
      number: 7,
      title: 'Fix',
      url: 'https://github.com/o/r/pull/7',
      repositoryUrl: 'https://github.com/o/r',
    },
  ])
  expect(f.s.store.task(f.task.id).updatedAt).toBe(updatedAt)
  expect(f.s.store.task(f.task.id).pullRequest).toBeUndefined()
  f.s.store.patch({
    collection: 'tasks',
    id: f.task.id,
    changes: {
      linkedPullRequests: { before: f.s.store.task(f.task.id).linkedPullRequests, after: [] },
      ignoredPullRequestUrls: { before: null, after: ['https://github.com/o/r/pull/7'] },
    },
  })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).linkedPullRequests).toEqual([])
  f.s.preferences.save({ settleOnPullClose: true })
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).archived).not.toBe(true)
})
it.each(['closed', 'merged'] as const)(
  'settles a %s main PR without archiving it and protects pending work',
  async (state) => {
    const f = await smartFixture(state)
    await f.watcher.refresh()
    f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
    f.s.preferences.save({ settleOnPullClose: true })
    for (const changes of [
      { pinned: true },
      { status: 'running' as const },
      { draft: 'unfinished' },
      {
        queue: [
          { id: 'q', role: 'user' as const, text: 'next', createdAt: new Date().toISOString() },
        ],
      },
    ]) {
      f.s.store.updateTask(f.task.id, (task) => ({
        ...task,
        pinned: false,
        status: 'review',
        draft: '',
        queue: [],
        ...changes,
      }))
      await f.watcher.refresh()
      expect(f.s.store.task(f.task.id).archived).not.toBe(true)
    }
    f.s.store.updateTask(f.task.id, (task) => ({
      ...task,
      pinned: false,
      status: 'review',
      draft: '',
      queue: [],
    }))
    const closed = await f.detail.mock.results[0]?.value
    if (!closed) throw new Error('Missing closed detail')
    f.detail.mockResolvedValue({ ...closed, stale: true, refreshError: 'Offline' })
    await f.watcher.refresh()
    expect(f.s.store.task(f.task.id).archived).not.toBe(true)
    f.detail.mockResolvedValue(closed)
    await f.watcher.refresh()
    expect(f.detail).toHaveBeenCalledWith(expect.any(String), 7, true)
    expect(f.s.store.task(f.task.id)).toMatchObject({
      archived: true,
      pullStatus: { state },
    })
    expect(f.s.store.task(f.task.id).archivedAt).toBeUndefined()
  },
)
it('can disable smart links and never settles a thread just because an auxiliary PR is closed', async () => {
  const f = await smartFixture()
  f.s.store.updateTask(f.task.id, (task) => ({
    ...task,
    checkoutBranch: undefined,
    messages: [{ id: 'm', role: 'user', text: 'See https://github.com/o/r/pull/7' }],
  }))
  f.s.preferences.save({ settleOnPullClose: true, autoLinkPullRequests: false })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).linkedPullRequests).toBeUndefined()
  f.s.preferences.save({ autoLinkPullRequests: true })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).linkedPullRequests).toHaveLength(1)
  expect(f.s.store.task(f.task.id).archived).not.toBe(true)
})

it('rechecks a cached closed PR online and does not settle it if it has reopened', async () => {
  const f = await smartFixture()
  await f.watcher.refresh()
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  f.s.preferences.save({ settleOnPullClose: true })
  const repository = f.s.store.get().repositories.find((repo) => repo.id === f.task.repositoryId)
  if (!repository) throw new Error('Missing repository')
  const closed = await f.detail(repository.path, 7)
  f.detail.mockImplementation(async (_path, _number, force) =>
    force ? { ...closed, pull: { ...closed.pull, state: 'open' } } : closed,
  )
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).archived).not.toBe(true)
  expect(f.s.store.task(f.task.id).pullStatus?.state).toBe('open')
})

it('discovers an already closed main PR from its verified message URL before branch polling has seen it', async () => {
  const f = await smartFixture()
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  f.s.store.updateTask(f.task.id, (task) => ({
    ...task,
    messages: [{ id: 'm', role: 'assistant', text: 'Created https://github.com/o/r/pull/7' }],
  }))
  f.s.preferences.save({ settleOnPullClose: true })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id)).toMatchObject({
    archived: true,
    pullStatus: { number: 7, state: 'closed' },
  })
  expect(f.s.store.task(f.task.id).archivedAt).toBeUndefined()
  expect(f.s.store.task(f.task.id).pullRequest).toBeUndefined()
})

it('matches GitHub owner-qualified branches and settles their freshly confirmed merged PR', async () => {
  const f = await smartFixture('merged')
  const closed = await f.detail('unused', 7)
  f.list.mockResolvedValue({
    pulls: [{ ...pull('open', null), head: 'o:dovo/fix-7' }],
    hasMore: false,
    page: 1,
  })
  f.detail.mockResolvedValue({ ...closed, pull: { ...closed.pull, head: 'o:dovo/fix-7' } })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).pullStatus).toMatchObject({ number: 7, state: 'open' })
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  f.s.preferences.save({ settleOnPullClose: true })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id)).toMatchObject({
    archived: true,
    pullStatus: { number: 7, state: 'merged' },
  })
})
it('does not associate another owner’s same-named fork branch with the thread', async () => {
  const f = await smartFixture('merged')
  f.list.mockResolvedValue({
    pulls: [{ ...pull('open', null), head: 'contributor:dovo/fix-7' }],
    hasMore: false,
    page: 1,
  })
  f.s.preferences.save({ settleOnPullClose: true })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).pullStatus).toBeUndefined()
  expect(f.s.store.task(f.task.id).archived).not.toBe(true)
})
it('refreshes a stale open list before deciding a main PR is still open', async () => {
  const f = await smartFixture('merged')
  await f.watcher.refresh()
  f.s.preferences.save({ settleOnPullClose: true })
  f.list.mockImplementation(async (_path, _state, _page, force) =>
    force
      ? { pulls: [], hasMore: false, page: 1 }
      : { pulls: [pull('open', null)], hasMore: false, page: 1, stale: true },
  )
  await f.watcher.refresh()
  expect(f.list).toHaveBeenCalledWith(expect.any(String), 'open', 1, true)
  expect(f.s.store.task(f.task.id).archived).toBe(true)
})
