import { decode, pullDetailSchema } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

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
  f.workspace.repositories[0]!.gitIdentity = 'github.com/o/r'
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
  f.workspace.repositories[0]!.gitIdentity = 'github.com/o/r'
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
  f.workspace.repositories[0]!.gitIdentity = 'github.com/o/r'
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
  return { runtime, s, task, list, detail, watcher: new TaskPullWatcher(s) }
}

it.each(['manual', 'polling'] as const)(
  'drains a delayed %s refresh before disposal and prevents new cycles',
  async (mode) => {
    const f = await smartFixture()
    const { promise: entered, resolve: enter } = deferred<void>()
    const { promise: response, resolve: release } =
      deferred<Awaited<ReturnType<typeof f.s.pullCache.list>>>()
    f.list.mockImplementation(() => {
      enter()
      return response
    })
    let refresh: Promise<void> | undefined
    let closing: Promise<void> | undefined
    try {
      if (mode === 'polling') {
        vi.useFakeTimers()
        f.watcher.start()
        f.watcher.start()
        await vi.advanceTimersByTimeAsync(120_000)
      } else refresh = f.watcher.refresh()
      await entered
      let disposed = false
      closing = f.watcher.dispose().then(() => {
        disposed = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(disposed).toBe(false)
      await f.watcher.refresh()
      expect(f.list).toHaveBeenCalledTimes(1)

      release({ pulls: [pull('open', 'SUCCESS')], hasMore: false, page: 1 })
      await Promise.all([refresh, closing])
      expect(f.s.store.task(f.task.id).pullStatus).toMatchObject({ state: 'open' })
      const update = vi.spyOn(f.s.store, 'update')
      f.watcher.start()
      await f.watcher.refresh()
      if (mode === 'polling') await vi.advanceTimersByTimeAsync(240_000)
      await f.watcher.dispose()
      expect(f.list).toHaveBeenCalledTimes(1)
      expect(update).not.toHaveBeenCalled()
    } finally {
      release({ pulls: [], hasMore: false, page: 1 })
      await Promise.all([refresh, closing, f.watcher.dispose()])
      vi.useRealTimers()
    }
  },
)

it('waits for every concurrent refresh when disposing', async () => {
  const f = await smartFixture()
  const first = deferred<Awaited<ReturnType<typeof f.s.pullCache.list>>>()
  const second = deferred<Awaited<ReturnType<typeof f.s.pullCache.list>>>()
  f.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const refreshes = [f.watcher.refresh(), f.watcher.refresh()]
  let closing: Promise<void> | undefined
  try {
    await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2))
    let disposed = false
    closing = f.watcher.dispose().then(() => {
      disposed = true
    })
    first.resolve({ pulls: [pull('open', 'SUCCESS')], hasMore: false, page: 1 })
    await refreshes[0]
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)
    second.reject(new Error('Forge unavailable'))
    await Promise.all([...refreshes, closing])
    expect(disposed).toBe(true)
    await f.watcher.dispose()
  } finally {
    first.resolve({ pulls: [], hasMore: false, page: 1 })
    second.resolve({ pulls: [], hasMore: false, page: 1 })
    await Promise.all([...refreshes, closing, f.watcher.dispose()])
  }
})

it('keeps runtime dependencies open until a delayed task pull refresh finishes', async () => {
  const start = vi.spyOn(TaskPullWatcher.prototype, 'start')
  const f = await smartFixture()
  const watcher = start.mock.contexts[0]
  if (!(watcher instanceof TaskPullWatcher))
    throw new Error('Runtime did not start its task pull watcher')
  const { promise: entered, resolve: enter } = deferred<void>()
  const { promise: response, resolve: release } =
    deferred<Awaited<ReturnType<typeof f.s.pullCache.list>>>()
  f.list.mockImplementation(() => {
    enter()
    return response
  })
  const refresh = watcher.refresh()
  let disposed = false
  const stop = watcher.dispose.bind(watcher)
  const dispose = vi.spyOn(watcher, 'dispose').mockImplementation(async () => {
    await stop()
    disposed = true
  })
  let closing: Promise<void> | undefined
  try {
    await entered
    closing = f.runtime.close()
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled())
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(f.s.db.open).toBe(true)
    release({ pulls: [pull('open', 'SUCCESS')], hasMore: false, page: 1 })
    await Promise.all([refresh, closing])
    expect(f.s.store.task(f.task.id).pullStatus).toMatchObject({ state: 'open' })
    expect(f.s.db.open).toBe(false)
  } finally {
    release({ pulls: [], hasMore: false, page: 1 })
    await Promise.all([refresh, closing])
  }
})

it('preserves draft state through list and detail refreshes', async () => {
  const f = await smartFixture()
  f.list.mockResolvedValue({
    pulls: [{ ...pull('open', null), draft: true }],
    hasMore: false,
    page: 1,
  })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).pullStatus).toMatchObject({ state: 'open', draft: true })
  const detail = await f.s.pullCache.status('/repo', 7)
  f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
  f.detail.mockResolvedValue({ ...detail, pull: { ...detail.pull, state: 'open', draft: false } })
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).pullStatus).toMatchObject({ state: 'open', draft: false })
})

it.each([
  ['settle', 'pr'],
  ['settle', 'pipeline'],
  ['archive', 'pr'],
  ['archive', 'pipeline'],
] as const)(
  'defers automatic %s while a linked project has an active %s watch',
  async (policy, kind) => {
    const f = await smartFixture('merged')
    const repo = f.s.store.get().repositories.find((repo) => repo.id === 'repo')
    if (!repo) throw new Error('Expected primary project')
    f.s.store.update((workspace) => ({
      ...workspace,
      repositories: [
        ...workspace.repositories,
        { ...repo, id: 'linked', path: `${repo.path}/linked` },
      ],
      tasks: workspace.tasks.map((task) =>
        task.id === f.task.id
          ? {
              ...task,
              linkedCheckouts: [
                { id: 'linked', repositoryId: 'linked', access: 'edit', execution: 'main' },
              ],
            }
          : task,
      ),
    }))
    f.s.preferences.save({
      enablePullRequestWatching: true,
      enablePipelineWatching: true,
      settleOnPullClose: policy === 'settle',
      archiveOnPullMerge: policy === 'archive',
    })
    if (kind === 'pr') {
      const closed = await f.s.pullCache.status(repo.path, 7)
      const url = 'https://github.com/o/linked/pull/7'
      vi.spyOn(f.s.pullCache, 'feedback').mockResolvedValue({
        ...closed,
        pull: { ...closed.pull, state: 'open', url },
      })
      await f.s.pullRequestWatch.command({
        taskId: f.task.id,
        action: 'watch',
        repositoryId: 'linked',
        url,
      })
    } else {
      vi.spyOn(f.s.forgeWork, 'request').mockResolvedValue({
        cachedAt: new Date().toISOString(),
        run: {
          id: '7',
          title: 'Build',
          url: 'https://github.com/o/linked/actions/runs/7',
          sha: 'a'.repeat(40),
          actor: 'me',
          ref: 'main',
          status: 'running',
          createdAt: '',
          updatedAt: '',
        },
        jobs: [],
      })
      await f.s.pipelineWatch.command({
        taskId: f.task.id,
        action: 'watch',
        repositoryId: 'linked',
        runIds: ['7'],
      })
    }
    expect(f.s.store.task(f.task.id).waitingForFeedback).toBe(true)
    await f.watcher.refresh()
    f.list.mockResolvedValue({ pulls: [], hasMore: false, page: 1 })
    await f.watcher.refresh()
    expect(f.s.store.task(f.task.id).archived).not.toBe(true)
    if (kind === 'pr')
      await f.s.pullRequestWatch.command({
        taskId: f.task.id,
        action: 'stop',
        repositoryId: 'linked',
      })
    else
      await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'stop', repositoryId: 'linked' })
    await f.watcher.refresh()
    expect(f.s.store.task(f.task.id).archived).toBe(true)
    expect(Boolean(f.s.store.task(f.task.id).archivedAt)).toBe(policy === 'archive')
  },
)

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
    // Empty drafts are still unfinished children. Only completed children release the parent.
    expect(f.s.store.task(f.task.id).waitingForFeedback).toBe(true)
    expect(f.s.store.task(f.task.id).archived).not.toBe(true)
    f.s.store.updateTask(child.id, (task) => ({ ...task, status: 'review' }))
    f.s.store.updateTask(nested.id, (task) => ({ ...task, status: 'review' }))
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
    status: 'review',
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
    status: 'review',
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
  f.s.store.updateTaskHistory(f.task.id, (task) => ({
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
    expect(f.detail).toHaveBeenCalledWith(expect.any(String), 7, true, true)
    expect(f.s.store.task(f.task.id)).toMatchObject({
      archived: true,
      pullStatus: { state },
    })
    expect(f.s.store.task(f.task.id).archivedAt).toBeUndefined()
  },
)
it('can disable smart links and never settles a thread just because an auxiliary PR is closed', async () => {
  const f = await smartFixture()
  f.s.store.updateTaskHistory(f.task.id, (task) => ({
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
  f.s.store.updateTaskHistory(f.task.id, (task) => ({
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
  expect(f.list).toHaveBeenCalledWith(expect.any(String), 'open', 1, true, true)
  expect(f.s.store.task(f.task.id).archived).toBe(true)
})

it('refreshes every linked PR independently, including foreign repositories, and preserves metadata on failure', async () => {
  const f = await smartFixture()
  const links = [
    {
      number: 8,
      title: 'PR #8',
      url: 'https://github.com/o/r/pull/8',
      repositoryUrl: 'https://github.com/o/r',
    },
    {
      number: 9,
      title: 'PR #9',
      url: 'https://github.com/other/project/pull/9',
      repositoryUrl: 'https://github.com/other/project',
    },
  ]
  f.s.store.updateTask(f.task.id, (task) => ({ ...task, linkedPullRequests: links }))
  const before = f.s.store.task(f.task.id).updatedAt
  const original = await f.s.pullCache.status('fixture', 7)
  const status = vi.spyOn(f.s.pullCache, 'status').mockImplementation(async (_path, number) => ({
    ...original,
    pull: {
      ...original.pull,
      state: number === 9 ? 'merged' : 'open',
      number,
      title: `Resolved ${number}`,
      url: links.find((link) => link.number === number)?.url ?? original.pull.url,
    },
    checks: number === 8 ? [{ name: 'test', status: 'failure' }] : [],
  }))
  await f.watcher.refresh()
  expect(status).toHaveBeenCalledWith('https://github.com/other/project/pull/9', 9, false, true)
  expect(f.s.store.task(f.task.id).pullStatuses).toMatchObject([
    { number: 8, title: 'Resolved 8', checks: 'failed', failedChecks: ['test'] },
    { number: 9, title: 'Resolved 9', state: 'merged' },
  ])
  expect(f.s.store.task(f.task.id).linkedPullRequests?.map((pull) => pull.title)).toEqual([
    'Resolved 8',
    'Resolved 9',
    'Fix',
  ])
  expect(f.s.store.task(f.task.id).updatedAt).toBe(before)
  const saved = f.s.store.task(f.task.id).pullStatuses
  status.mockRejectedValue(new Error('offline'))
  await f.watcher.refresh()
  expect(f.s.store.task(f.task.id).pullStatuses).toMatchObject(saved!)
})
it('never looks up a foreign project mention by number in the current repository', async () => {
  const f = await smartFixture()
  f.s.store.updateTask(f.task.id, (value) => ({ ...value, checkoutBranch: undefined }))
  f.s.store.updateTaskHistory(f.task.id, (value) => ({
    ...value,
    messages: [
      {
        id: 'foreign-mention',
        role: 'assistant',
        text: 'See https://github.com/another/project/pull/142 and https://github.com/o/r/pull/7',
      },
    ],
  }))
  await f.watcher.refresh()
  expect(f.detail).toHaveBeenCalledTimes(1)
  expect(f.detail).toHaveBeenCalledWith(expect.any(String), 7, false, true)
  await f.watcher.refresh()
  expect(f.detail.mock.calls.every(([, number]) => number === 7)).toBe(true)
})
it('matches mentions to the configured PR target when it differs from the clone origin', async () => {
  const f = await smartFixture()
  f.s.store.update((value) => ({
    ...value,
    repositories: value.repositories.map((repo) => ({
      ...repo,
      gitIdentity: 'github.com/fork/r',
      pullIdentity: 'github.com/o/r',
      forge: { connectionId: 'selected', repository: 'o/r' },
    })),
  }))
  f.s.store.updateTask(f.task.id, (value) => ({ ...value, checkoutBranch: undefined }))
  f.s.store.updateTaskHistory(f.task.id, (value) => ({
    ...value,
    messages: [
      {
        id: 'bound-mention',
        role: 'assistant',
        text: 'See https://github.com/o/r/pull/7 and https://github.com/fork/r/pull/142',
      },
    ],
  }))
  await f.watcher.refresh()
  expect(f.detail).toHaveBeenCalledTimes(1)
  expect(f.detail).toHaveBeenCalledWith(expect.any(String), 7, false, true)
})
