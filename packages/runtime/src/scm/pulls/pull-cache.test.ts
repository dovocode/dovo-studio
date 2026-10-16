import { Effect, Fiber } from 'effect'
import type { PullDetail } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { GitService } from '../git/git'
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
it('shares PR feedback across worktrees and accounts correctly, invalidates it on actions and coalesces refreshes', async () => {
  const { cache, pulls, db, store } = setup()
  const detail: PullDetail = {
    pull: {
      number: 7,
      title: 'PR',
      url: 'https://github.com/a/b/pull/7',
      repositoryUrl: 'https://github.com/a/b',
      state: 'open',
      draft: false,
      author: 'dev',
      updatedAt: '2026-10-07',
      head: 'fix',
      base: 'main',
      labels: [],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    comments: [],
    checks: [],
    files: [],
    warnings: [],
  }
  const load = vi.spyOn(pulls, 'feedback').mockResolvedValue(detail)
  let account = 'account-1'
  const shared = new PullCache(db, pulls, store, async () => account)
  cleanup.push(() => shared.dispose())
  await Promise.all([shared.feedback('/repo', 7), shared.feedback('/worktree', 7)])
  expect(load).toHaveBeenCalledTimes(1)
  shared.invalidate('/repo', 7)
  expect((await shared.feedback('/worktree', 7)).stale).toBe(true)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  await vi.waitFor(async () => expect((await shared.feedback('/repo', 7)).stale).toBe(false))
  account = 'account-2'
  await shared.feedback('/repo', 7)
  expect(load).toHaveBeenCalledTimes(3)
  expect((await cache.feedback('/other-repo', 7)).pull.number).toBe(7)
  expect(load).toHaveBeenCalledTimes(4)
})
it('persists pages, coalesces requests, serves stale data immediately and retains it on failure', async () => {
  const { cache, pulls, db, store } = setup()
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await Promise.all([cache.list('/repo', 'open', 1), cache.list('/repo', 'open', 1)])
  expect(load).toHaveBeenCalledTimes(1)
  const reopened = new PullCache(db, pulls, store)
  expect((await reopened.list('/repo', 'open', 1)).cachedAt).toBeDefined()
  expect(load).toHaveBeenCalledTimes(1)
  db.prepare('UPDATE pull_cache SET updated=?').run(Date.now() - 301000)
  load.mockRejectedValue(new Error('Offline'))
  expect((await cache.list('/repo', 'open', 1)).stale).toBe(true)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect((await cache.list('/repo', 'open', 1)).refreshError).toBe('Offline')
  expect(load).toHaveBeenCalledTimes(2)
  await reopened.dispose()
})
it('refreshes only on demand and stops spending provider reads after a client leaves', async () => {
  vi.useFakeTimers()
  const { cache, pulls, store } = setup()
  store.update((w) => ({
    ...w,
    repositories: [
      { id: 'repo', name: 'Repo', path: '/repo', branch: 'main' },
      { id: 'idle', name: 'Idle', path: '/idle', branch: 'main' },
    ],
  }))
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await vi.advanceTimersByTimeAsync(300000)
  // Nothing was read by a client, so an idle runtime spends no GitHub calls.
  expect(load).not.toHaveBeenCalled()
  await Effect.runPromise(cache.overviewEffect('/repo', 'open', 1))
  expect(load).toHaveBeenCalledWith('/repo', 'open', 1, false)
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(load).toHaveBeenCalledTimes(1)
  // Returning to the overview serves saved data immediately and refreshes on demand.
  expect((await Effect.runPromise(cache.overviewEffect('/repo', 'open', 1))).stale).toBe(true)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(load.mock.calls.every(([path]) => path === '/repo')).toBe(true)
  await cache.dispose()
  await vi.advanceTimersByTimeAsync(300000)
  expect(load).toHaveBeenCalledTimes(2)
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
  db.prepare('UPDATE pull_cache SET updated=?').run(Date.now() - 301000)
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

it('finishes disposing the cache when the disposing caller is interrupted', async () => {
  const { cache, pulls, db } = setup()
  let finish: (value: { pulls: []; page: number; hasMore: boolean }) => void = () => {
    throw new Error('Refresh did not start')
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
  const closing = Effect.runPromise(Fiber.interrupt(Effect.runFork(cache.disposeEffect()))).then(
    () => {
      disposed = true
    },
  )
  await Promise.resolve()
  expect(disposed).toBe(false)
  finish({ pulls: [], page: 1, hasMore: false })
  await closing
  expect(disposed).toBe(true)
  expect(db.prepare('SELECT COUNT(*) AS count FROM pull_cache').get()).toEqual({ count: 1 })
  await expect(cache.list('/repo', 'open', 1, true)).rejects.toThrow('Pull cache is closed')
})

it('shares upstream requests across worktrees for the same repository and account, including invalidation', async () => {
  const { db, pulls, store } = setup()
  const identity = vi.fn<(cwd: string) => Promise<string>>(async (cwd: string) =>
    cwd === '/other-account' ? 'repo:other' : 'repo:owner',
  )
  const cache = new PullCache(db, pulls, store, identity)
  cleanup.push(() => cache.dispose())
  const load = vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await Promise.all([cache.list('/repo', 'open', 1), cache.list('/worktree', 'open', 1)])
  expect(load).toHaveBeenCalledTimes(1)
  await cache.list('/other-account', 'open', 1)
  expect(load).toHaveBeenCalledTimes(2)
  const reopened = new PullCache(db, pulls, store, identity)
  cleanup.push(() => reopened.dispose())
  reopened.invalidate('/worktree')
  expect((await cache.list('/repo', 'open', 1)).stale).toBe(true)
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3))
  expect((await cache.list('/other-account', 'open', 1)).stale).toBe(false)
})
it('keeps overview reads to one page and discovers full stacks only for details', async () => {
  const { cache, pulls } = setup()
  const summary = (number: number, head: string, base: string) => ({
    number,
    head,
    base,
    title: `PR ${number}`,
    url: `https://github.com/a/b/pull/${number}`,
    state: 'open' as const,
    draft: false,
    author: 'dev',
    updatedAt: '2026-10-02',
    labels: [],
  })
  const parent = summary(1, 'first', 'main'),
    child = summary(2, 'second', 'first')
  const list = vi.spyOn(pulls, 'list').mockImplementation(async (_cwd, _state, page) => ({
    pulls: page === 1 ? [child] : [parent],
    page,
    hasMore: page === 1,
  }))
  const page = await Effect.runPromise(cache.overviewEffect('/repo', 'open', 1))
  expect(page.pulls[0]?.stack).toBeUndefined()
  expect(list).toHaveBeenCalledTimes(1)
  const stack = await cache.stack('/repo', 2)
  expect(stack.stack?.members.map((pull) => pull.number)).toEqual([1, 2])
  const all = await Effect.runPromise(cache.overviewEffect('/repo', 'all', 1))
  expect(all.pulls[0]?.stack).toBeUndefined()
  expect(list).toHaveBeenCalledTimes(3)
  const detail: PullDetail = {
    pull: {
      ...child,
      repositoryUrl: 'https://github.com/a/b',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    files: [],
    comments: [],
    checks: [],
    warnings: [],
  }
  const loadDetail = vi.spyOn(pulls, 'detail').mockResolvedValue(detail)
  expect(
    (await Effect.runPromise(cache.detailWithStackEffect('/repo', 2))).stack?.parentNumber,
  ).toBe(1)
  loadDetail.mockResolvedValue({ ...detail, pull: { ...detail.pull, state: 'merged' } })
  const closed = await Effect.runPromise(cache.detailWithStackEffect('/repo', 2, true))
  expect(closed.stack).toBeUndefined()
  expect(closed.pull.stack).toBeUndefined()
  expect(list).toHaveBeenCalledTimes(3)
  list.mockImplementation(async (_cwd, _state, page) => ({
    pulls: page === 1 ? [{ ...child, base: 'main' }, parent] : [],
    page,
    hasMore: false,
  }))
  const refreshed = await Effect.runPromise(cache.overviewEffect('/repo', 'open', 1, true))
  expect(refreshed.pulls.every((pull) => !pull.stack)).toBe(true)
})
it.each([
  ['open', 1, false, true],
  ['open', 1, true, false],
  ['open', 2, false, false],
  ['all', 1, false, false],
] as const)(
  'infers stacks from a single %s page %s (hasMore %s)',
  async (state, number, hasMore, complete) => {
    const { cache, pulls } = setup()
    const list = vi.spyOn(pulls, 'list').mockResolvedValue({
      page: number,
      hasMore,
      pulls: [1, 2].map((number) => ({
        number,
        title: `PR ${number}`,
        url: `https://github.com/a/b/pull/${number}`,
        state: 'open',
        draft: false,
        author: 'dev',
        updatedAt: '2026-10-02',
        labels: [],
        head: `branch-${number}`,
        base: number === 1 ? 'main' : 'branch-1',
      })),
    })
    const page = await Effect.runPromise(cache.overviewEffect('/repo', state, number))
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith('/repo', state, number, false)
    expect(page.pulls[0]?.stack).toMatchObject({ rootNumber: 1, position: 1, size: 2, complete })
    expect(page.pulls[1]?.stack).toMatchObject({
      rootNumber: 1,
      parentNumber: 1,
      position: 2,
      size: 2,
      complete,
    })
  },
)
it('marks stack data partial when a later page fails instead of claiming a complete stack', async () => {
  const { cache, pulls } = setup()
  vi.spyOn(pulls, 'list').mockImplementation(async (_cwd, _state, page) => {
    if (page > 1) throw new Error('Forge unavailable')
    return {
      page,
      hasMore: true,
      pulls: [1, 2].map((number) => ({
        number,
        head: `branch-${number}`,
        base: number === 1 ? 'main' : 'branch-1',
        title: 'PR',
        url: `https://github.com/a/b/pull/${number}`,
        state: 'open' as const,
        draft: false,
        author: 'dev',
        updatedAt: '2026-10-02',
        labels: [],
      })),
    }
  })
  const { stack, warning } = await cache.stack('/repo', 2)
  expect(stack?.complete).toBe(false)
  expect(warning).toContain('Forge unavailable')
})
it('rejects a detail fetched from a new destination after resolving the old cache scope', async () => {
  const { pulls, db, store } = setup()
  const cache = new PullCache(db, pulls, store, async () => 'old-destination')
  cleanup.push(() => cache.dispose())
  const detail: PullDetail = {
    destination: 'new-destination',
    pull: {
      number: 7,
      title: 'Private',
      url: 'https://github.com/owner/project/pull/7',
      repositoryUrl: 'https://github.com/owner/project',
      state: 'open',
      draft: false,
      author: 'dev',
      updatedAt: '',
      head: 'feature',
      base: 'main',
      labels: [],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: 'Private data from new account',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    comments: [],
    checks: [],
    files: [],
    warnings: [],
  }
  vi.spyOn(pulls, 'detail').mockResolvedValue(detail)
  await expect(cache.detail('/repo', 7)).rejects.toThrow('destination changed during the read')
  expect(db.prepare('SELECT count(*) AS count FROM pull_cache').get()).toEqual({ count: 0 })
})
it.each([401, 403, 409])(
  'does not return private cached PR lists after HTTP %s',
  async (status) => {
    const { pulls, db, store } = setup()
    const cache = new PullCache(db, pulls, store, async () => 'destination')
    cleanup.push(() => cache.dispose())
    const load = vi
      .spyOn(pulls, 'list')
      .mockResolvedValue({ destination: 'destination', pulls: [], page: 1, hasMore: false })
    await cache.list('/repo', 'open', 1)
    const { HttpError } = await import('../../errors.js')
    load.mockRejectedValue(new HttpError(status, 'Account or destination rejected'))
    await expect(cache.list('/repo', 'open', 1, true)).rejects.toMatchObject({ status })
  },
)

it('caches PR sections independently, coalesces concurrent reads, and scopes them by revision and account', async () => {
  const { db, store, pulls } = setup()
  let account = 'owner'
  const cache = new PullCache(db, pulls, store, async () => account)
  cleanup.push(() => cache.dispose())
  const detail: PullDetail = {
    pull: {
      number: 7,
      title: 'PR',
      url: 'https://github.com/a/b/pull/7',
      repositoryUrl: 'https://github.com/a/b',
      state: 'open',
      draft: false,
      author: 'dev',
      updatedAt: '',
      head: 'feature',
      base: 'main',
      labels: [],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: 'Description',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    comments: [],
    files: [],
    checks: [],
    warnings: [],
  }
  const section = vi.spyOn(pulls, 'section').mockResolvedValue(detail)
  const read = (
    kind: 'overview' | 'changes' | 'checks',
    force = false,
    revision = `${'a'.repeat(40)}:${'b'.repeat(40)}`,
  ) => Effect.runPromise(cache.sectionEffect('/repo', 7, kind, force, undefined, revision))
  await Promise.all([read('overview'), read('overview'), read('changes')])
  expect(section).toHaveBeenCalledTimes(2)
  section.mockRejectedValueOnce(new Error('Checks offline'))
  await expect(read('checks')).rejects.toThrow('Checks offline')
  expect((await read('overview')).pull.body).toBe('Description')
  expect(section).toHaveBeenCalledTimes(3)
  await read('changes', true)
  expect(section).toHaveBeenCalledTimes(4)
  await read('changes', false, `${'c'.repeat(40)}:${'b'.repeat(40)}`)
  expect(section).toHaveBeenCalledTimes(5)
  account = 'other-account'
  await read('overview')
  expect(section).toHaveBeenCalledTimes(6)
  const reopened = new PullCache(db, pulls, store, async () => account)
  cleanup.push(() => reopened.dispose())
  expect(
    (await Effect.runPromise(reopened.sectionEffect('/repo', 7, 'overview'))).cachedAt,
  ).toBeDefined()
  expect(section).toHaveBeenCalledTimes(6)
  reopened.invalidate('/repo', 7)
  account = 'owner'
  expect((await read('overview')).stale).toBe(true)
  await vi.waitFor(() => expect(section).toHaveBeenCalledTimes(7))
  account = 'other-account'
  expect((await read('overview')).stale).toBe(true)
  await vi.waitFor(() => expect(section).toHaveBeenCalledTimes(8))
})

it('migrates persisted checkout aliases so writes invalidate pre-upgrade caches', async () => {
  const { db, store, pulls, cache } = setup()
  vi.spyOn(pulls, 'list').mockResolvedValue({ pulls: [], page: 1, hasMore: false })
  await cache.list('/repo', 'open', 1)
  db.exec('CREATE TABLE pull_cache_scopes (cwd TEXT PRIMARY KEY, scope TEXT NOT NULL)')
  db.prepare('INSERT INTO pull_cache_scopes(cwd,scope) VALUES(?,?)').run(
    '/legacy-worktree',
    '/repo',
  )
  const reopened = new PullCache(db, pulls, store)
  cleanup.push(() => reopened.dispose())
  reopened.invalidate('/legacy-worktree')
  expect((await cache.list('/repo', 'open', 1)).stale).toBe(true)
})

it('loads native stack details without scanning PR pages, reuses the cache and invalidates it on writes', async () => {
  const { cache, pulls } = setup()
  const list = vi.spyOn(pulls, 'list')
  const native = vi.spyOn(pulls, 'nativeStack').mockResolvedValue({
    rootNumber: 6,
    parentNumber: 6,
    position: 2,
    size: 2,
    nativeId: 99,
    nativeNumber: 12,
    complete: true,
    members: [6, 7].map((number, index) => ({
      number,
      title: `PR ${number}`,
      url: `https://github.com/team/project/pull/${number}`,
      draft: false,
      head: `branch-${index}`,
      base: index ? 'branch-0' : 'main',
      depth: index,
    })),
  })
  for (let index = 0; index < 2; index++) {
    const result = await Effect.runPromise(cache.stackEffect('/repo', 7, false, undefined, 12))
    expect(result.stack).toMatchObject({ nativeId: 99, position: 2, size: 2 })
  }
  expect(native).toHaveBeenCalledTimes(1)
  expect(list).not.toHaveBeenCalled()
  cache.invalidate('/repo', 7)
  await Effect.runPromise(cache.stackEffect('/repo', 7, true, undefined, 12))
  expect(native).toHaveBeenCalledTimes(2)
})
