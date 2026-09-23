import { Effect, Fiber } from 'effect'
import type { PullDetail } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { GitService } from './git'
import { PullRequests } from './pulls'
import { PullCache } from './pull-cache'
import { retainUnavailableSections } from './cached-detail'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function setup() {
  const db = openDatabase(':memory:'),
    store = new WorkspaceStore(db),
    pulls = new PullRequests(new GitService()),
    cache = new PullCache(db, pulls, store)
  cleanup.push(async () => {
    await cache.dispose()
    db.close()
  })
  return { db, store, pulls, cache }
}
it('persists pages, coalesces requests, serves stale data immediately and retains it on failure', async () => {
  const { cache, pulls, db, store } = setup()
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await Promise.all([cache.list('/repo', 'open', 1), cache.list('/repo', 'open', 1)])
  expect(load).toHaveBeenCalledTimes(1)
  const reopened = new PullCache(db, pulls, store)
  expect((await reopened.list('/repo', 'open', 1)).cachedAt).toBeDefined()
  expect(load).toHaveBeenCalledTimes(1)
  db.prepare('UPDATE pull_cache SET updated=?').run(Date.now() - 61000)
  load.mockRejectedValue(new Error('Offline'))
  expect((await cache.list('/repo', 'open', 1)).stale).toBe(true)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect((await cache.list('/repo', 'open', 1)).refreshError).toBe('Offline')
  expect(load).toHaveBeenCalledTimes(2)
  await reopened.dispose()
})
it('watches registered repos without a PR screen and stops when disposed', async () => {
  vi.useFakeTimers()
  const { cache, pulls, store } = setup()
  store.update((w) => ({
    ...w,
    repositories: [{ id: 'repo', name: 'Repo', path: '/repo', branch: 'main' }],
  }))
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  cache.start()
  await vi.advanceTimersByTimeAsync(60000)
  expect(load).toHaveBeenCalledWith('/repo', 'open', 1)
  await cache.dispose()
  await vi.advanceTimersByTimeAsync(120000)
  expect(load).toHaveBeenCalledTimes(1)
})
it('returns cached discussion immediately while a new thread refresh is still pending', async () => {
  const { cache, pulls, db } = setup()
  const detail: PullDetail = {
    pull: {
      number: 7,
      title: 'PR',
      url: 'https://github.com/a/b/pull/7',
      repositoryUrl: 'https://github.com/a/b',
      state: 'open' as const,
      draft: false,
      author: 'dev',
      updatedAt: '2026-09-07',
      head: 'fix',
      base: 'main',
      labels: [],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: 'Description',
      additions: 1,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    comments: [
      {
        id: 'comment-1',
        kind: 'comment',
        author: 'dev',
        date: '2026-09-07',
        url: 'https://github.com/a/b/pull/7',
        body: 'Keep this thread',
      },
    ],
    files: [],
    checks: [],
    warnings: [],
  }
  const load = vi.spyOn(pulls, 'detail').mockResolvedValue(detail)
  const previous = {
    ...detail,
    files: [
      {
        path: 'old-base.txt',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ],
  }
  const unavailable = { ...detail, warnings: ['Files: temporarily unavailable'] }
  expect(retainUnavailableSections(unavailable, previous).files).toEqual(previous.files)
  expect(
    retainUnavailableSections(
      { ...unavailable, pull: { ...unavailable.pull, baseSha: 'c'.repeat(40) } },
      previous,
    ).files,
  ).toEqual([])
  await cache.detail('/repo', 7)
  let finish: (value: typeof detail) => void = () => {
    throw new Error('Refresh did not start')
  }
  load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  db.prepare('UPDATE pull_cache SET updated=?').run(Date.now() - 61000)
  expect((await cache.detail('/repo', 7)).pull.body).toBe('Description')
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  finish({
    ...detail,
    comments: [],
    warnings: ['Conversation: Offline'],
    pull: { ...detail.pull, body: 'Updated discussion' },
  })
  await cache.dispose()
  const cached = await cache.detail('/repo', 7)
  expect(cached.pull.body).toBe('Updated discussion')
  expect(cached.comments[0].body).toBe('Keep this thread')
  expect(cached.warnings).toContain('Unavailable sections are showing the last cached data.')
})

it('backs off uncached failures while allowing an explicit retry', async () => {
  const { cache, pulls } = setup()
  const load = vi.spyOn(pulls, 'list').mockRejectedValue(new Error('Unavailable'))
  await expect(cache.list('/repo', 'open', 1)).rejects.toThrow('Unavailable')
  await expect(cache.list('/repo', 'open', 1)).rejects.toThrow('Unavailable')
  expect(load).toHaveBeenCalledTimes(1)
  load.mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await expect(cache.list('/repo', 'open', 1, true)).resolves.toMatchObject({ pulls: [] })
  expect(load).toHaveBeenCalledTimes(2)
})

it('does not bypass freshness when background watching follows a foreground refresh', async () => {
  vi.useFakeTimers()
  const { cache, pulls, store } = setup()
  store.update((w) => ({
    ...w,
    repositories: [{ id: 'repo', name: 'Repo', path: '/repo', branch: 'main' }],
  }))
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  cache.start()
  await vi.advanceTimersByTimeAsync(30000)
  await cache.list('/repo', 'open', 1)
  await vi.advanceTimersByTimeAsync(30000)
  expect(load).toHaveBeenCalledTimes(1)
})

it('persists mutation invalidation without discarding cached data or its fetched time', async () => {
  const { cache, pulls, db, store } = setup()
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  const first = await cache.list('/repo', 'open', 1)
  await cache.list('/unrelated', 'open', 1)
  expect(first.cachedAt).toBeDefined()
  cache.invalidate('/repo', 7)
  const reopened = new PullCache(db, pulls, store)
  load.mockRejectedValue(new Error('GitHub unavailable'))
  const cached = await reopened.list('/repo', 'open', 1)
  expect(cached).toMatchObject({ stale: true, cachedAt: first.cachedAt, pulls: [] })
  expect((await reopened.list('/unrelated', 'open', 1)).stale).toBe(false)
  await reopened.dispose()
})

it('does not mark a response that started before a mutation as fresh', async () => {
  const { cache, pulls } = setup()
  let finish: (value: { pulls: []; page: number; hasMore: boolean }) => void = () => {
    throw new Error('Not started')
  }
  const load = vi.spyOn(pulls, 'list').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = cache.list('/repo', 'open', 1)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  cache.invalidate('/repo', 7)
  finish({ pulls: [], page: 1, hasMore: false })
  expect((await pending).stale).toBe(true)
  load.mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await cache.list('/repo', 'open', 1)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
})

it('keeps a shared refresh alive after a caller leaves and drains it before disposal', async () => {
  const { cache, pulls, db } = setup()
  let finish: (value: { pulls: []; page: number; hasMore: boolean }) => void = () => {
    throw new Error('Not started')
  }
  const load = vi.spyOn(pulls, 'list').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const caller = Effect.runFork(cache.listEffect('/repo', 'open', 1))
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  await Effect.runPromise(Fiber.interrupt(caller))
  let disposed = false
  const closing = cache.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  finish({ pulls: [], page: 1, hasMore: false })
  await closing
  expect(db.prepare('SELECT COUNT(*) AS count FROM pull_cache').get()).toEqual({ count: 1 })
  expect((await cache.list('/repo', 'open', 1)).page).toBe(1)
  await expect(cache.list('/repo', 'open', 1, true)).rejects.toThrow('Pull cache is closed')
  expect(load).toHaveBeenCalledTimes(1)
})
