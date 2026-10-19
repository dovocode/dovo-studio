import { createServices } from '../../services'
import { openDatabase } from '../../storage/database'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { summarizeTask, type Task, type TaskSummary } from '@dovo/protocol'
import { Housekeeping, inactiveTaskIds } from './housekeeping'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const now = Date.parse('2026-09-30T12:00:00Z')
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()
const task = (id: string, changes: Partial<Task> = {}): Task =>
  ({
    id,
    title: id,
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'review',
    createdAt: daysAgo(40),
    updatedAt: daysAgo(20),
    messages: [],
    files: [],
    draft: '',
    example: false,
    ...changes,
  }) as Task

it('archives only idle, unpinned tasks without recent activity', () => {
  const tasks = [
    task('stale'),
    task('recent', { updatedAt: daysAgo(2) }),
    task('running', { status: 'running' }),
    task('pinned', { pinned: true }),
    task('archived', { archivedAt: daysAgo(10) }),
    task('example', { example: true }),
    task('waiting'),
    task('recent-turn', {
      turns: [{ id: 't', startedAt: daysAgo(3), finishedAt: daysAgo(3) } as never],
    }),
  ]
  const busy = (item: TaskSummary) => item.id === 'waiting'
  expect(inactiveTaskIds(tasks.map(summarizeTask), 14, now, busy)).toEqual(['stale'])
  expect(inactiveTaskIds(tasks.map(summarizeTask), 30, now, busy)).toEqual([])
  expect(inactiveTaskIds(tasks.map(summarizeTask), 0, now, busy)).toEqual([])
})

const family = () => [
  task('parent'),
  task('child', { delegation: { parentTaskId: 'parent', parentRunId: 'old', key: 'child' } }),
  task('nested', { delegation: { parentTaskId: 'child', parentRunId: 'old', key: 'nested' } }),
]

it('considers descendant activity, pins and busy state and selects only the main thread', () => {
  expect(inactiveTaskIds(family().map(summarizeTask), 14, now, () => false)).toEqual(['parent'])
  const protections: Partial<Task>[] = [
    { status: 'running' },
    { updatedAt: daysAgo(2) },
    { pinned: true },
  ]
  for (const protection of protections) {
    const tasks = family().map((item) => (item.id === 'nested' ? { ...item, ...protection } : item))
    expect(inactiveTaskIds(tasks.map(summarizeTask), 14, now, () => false)).toEqual([])
  }
  expect(
    inactiveTaskIds(family().map(summarizeTask), 14, now, (item) => item.id === 'nested'),
  ).toEqual([])
})

async function archiveFixture() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'housekeeping-test-owner-token-with-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({ ...f.workspace, tasks: family() }))
  s.preferences.save({ ...s.preferences.get(), autoArchiveDays: 14 })
  return { s, housekeeping: new Housekeeping(s) }
}

it('automatically archives the main thread and all descendants together', async () => {
  const { s, housekeeping } = await archiveFixture()
  const close = vi.spyOn(s.browsers, 'closeTask').mockResolvedValue()
  const release = vi.spyOn(s.agents, 'releaseTask').mockResolvedValue()
  expect(await housekeeping.archiveInactive(now)).toEqual(['parent'])
  expect(s.store.get().tasks.every((item) => item.archived && item.archivedAt)).toBe(true)
  expect(close.mock.calls.map(([id]) => id).sort()).toEqual(['child', 'nested', 'parent'])
  expect(release.mock.calls.map(([id]) => id).sort()).toEqual(['child', 'nested', 'parent'])
})

it('keeps the whole family unarchived when its activity audit cannot commit', async () => {
  const { s, housekeeping } = await archiveFixture()
  const before = s.db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')
  const add = s.activity.add.bind(s.activity)
  vi.spyOn(s.activity, 'add').mockImplementation((...args) => {
    if (args[2].startsWith('Archived after')) throw new Error('Audit write failed')
    return add(...args)
  })
  expect(await housekeeping.archiveInactive(now)).toEqual([])
  expect(s.store.get().tasks.every((item) => !item.archivedAt)).toBe(true)
  expect(s.db.prepare('SELECT value FROM documents WHERE id = ?').get('workspace')).toEqual(before)
})

it.each(['recent activity', 'new descendant', 'disabled preference'] as const)(
  'rechecks automatic archive eligibility after resource cleanup: %s',
  async (change) => {
    const { s, housekeeping } = await archiveFixture()
    let entered!: () => void
    let release!: () => void
    const closing = new Promise<void>((resolve) => (entered = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    vi.spyOn(s.browsers, 'closeTask').mockImplementation(async (id) => {
      if (id === 'parent') {
        entered()
        await gate
      }
    })
    const archive = housekeeping.archiveInactive(now)
    try {
      await closing
      if (change === 'recent activity')
        s.store.updateTask('nested', (item) => ({ ...item, draft: 'New work' }))
      else if (change === 'new descendant')
        s.store.update((workspace) => ({
          ...workspace,
          tasks: [
            ...workspace.tasks,
            task('new-child', {
              delegation: { parentTaskId: 'parent', parentRunId: 'old', key: 'new' },
            }),
          ],
        }))
      else s.preferences.save({ ...s.preferences.get(), autoArchiveDays: 0 })
      release()
      expect(await archive).toEqual([])
      expect(s.store.get().tasks.every((item) => !item.archivedAt)).toBe(true)
    } finally {
      release()
      await archive
    }
  },
)

it('prunes activity older than the retention window and keeps newer entries', async () => {
  const Database = (await import('better-sqlite3')).default
  const { Activity } = await import('../../storage/activity')
  const { Housekeeping } = await import('./housekeeping')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const activity = new Activity(db)
  const insert = db.prepare("INSERT INTO activity VALUES (?, ?, 'task', 'scope', 'summary', '{}')")
  for (let index = 0; index < 4500; index++) insert.run(`old-${index}`, daysAgo(100))
  insert.run('recent', daysAgo(5))
  let retention = 0
  const housekeeping = new Housekeeping({
    activity,
    preferences: { get: () => ({ activityRetentionDays: retention }) },
  } as never)
  expect(await housekeeping.pruneActivity(now)).toBe(0)
  retention = 90
  expect(await housekeeping.pruneActivity(now)).toBe(4500)
  expect(db.prepare('SELECT id FROM activity').all()).toEqual([{ id: 'recent' }])
  db.close()
})

it.each([0, 90])(
  'expires diagnostics after seven days with activity retention %s',
  async (retention) => {
    const db = openDatabase(':memory:')
    try {
      const { Activity } = await import('../../storage/activity')
      const activity = new Activity(db)
      const insert = db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?)')
      db.transaction(() => {
        for (let index = 0; index < 4500; index++)
          insert.run(`command-${index}`, daysAgo(8), 'command', 'scope', 'git · failed', '{}')
        insert.run('old-event', daysAgo(8), 'agent-event', 'scope', 'Raw delta', '{}')
        insert.run('boundary', daysAgo(7), 'command', 'scope', 'Boundary', '{}')
        insert.run('new-event', daysAgo(6), 'agent-event', 'scope', 'Raw delta', '{}')
        for (const kind of ['tool', 'message', 'task', 'approval', 'integration'])
          insert.run(kind, daysAgo(8), kind, 'scope', kind, '{}')
        insert.run('artifact:old:1', daysAgo(100), 'tool', 'scope', 'Artifact', '{}')
      })()
      const housekeeping = new Housekeeping({
        activity,
        preferences: { get: () => ({ activityRetentionDays: retention }) },
      } as never)
      expect(await housekeeping.pruneActivity(now)).toBe(4501)
      expect(db.prepare('SELECT id FROM activity ORDER BY id').pluck().all()).toEqual([
        'approval',
        'artifact:old:1',
        'boundary',
        'integration',
        'message',
        'new-event',
        'task',
        'tool',
      ])
      expect(await housekeeping.pruneActivity(now)).toBe(0)
    } finally {
      db.close()
    }
  },
)

it('rechecks inactivity after releasing provider processes before auto-settling', async () => {
  const { s, housekeeping } = await archiveFixture()
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: { environment: { taskBehavior: { settleInactive: true } }, shared: [] },
    },
    false,
  )
  let released!: () => void
  const release = vi.spyOn(s.agents, 'releaseTask').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        released = resolve
      }),
  )
  const settling = housekeeping.settleInactive(now)
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  s.store.updateTask('parent', (task) => ({ ...task, draft: 'New work' }))
  released()
  expect(await settling).toEqual([])
  expect(s.store.task('parent').archived).not.toBe(true)
})

it('settles inactive task families using scoped policy without archiving or touching worktrees', async () => {
  const { s, housekeeping } = await archiveFixture()
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: {
        environment: { taskBehavior: { settleInactive: true, inactiveDays: 14 } },
        shared: [],
      },
    },
    false,
  )
  const close = vi.spyOn(s.browsers, 'closeTask').mockResolvedValue()
  expect(await housekeeping.settleInactive(now)).toEqual(['parent'])
  expect(s.store.get().tasks.every((item) => item.archived && !item.archivedAt)).toBe(true)
  expect(close).not.toHaveBeenCalled()
  s.store.updateTask('parent', (task) => ({ ...task, draft: 'New work' }))
  expect(s.store.get().tasks.every((task) => task.archived && task.autoSettled)).toBe(true)
  s.store.patch({
    collection: 'tasks',
    id: 'parent',
    changes: { draft: { before: 'New work', after: 'More draft work' } },
  })
  expect(s.store.get().tasks.every((task) => task.archived && task.autoSettled)).toBe(true)
})
it('revives automatically settled families when a new message is queued', async () => {
  const { s, housekeeping } = await archiveFixture()
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: { environment: { taskBehavior: { settleInactive: true } }, shared: [] },
    },
    false,
  )
  expect(await housekeeping.settleInactive(now)).toEqual(['parent'])
  s.store.updateTask('parent', (task) => ({ ...task, queuePaused: true }))
  await s.tasks.send('parent', 'new-user-message', 'New work')
  expect(s.store.get().tasks.every((task) => !task.archived && !task.autoSettled)).toBe(true)
  expect(s.store.task('parent').queue?.map((message) => message.id)).toEqual(['new-user-message'])
})
it('protects drafts, pending input, queued work and quota continuations from inactive settling', async () => {
  const { s, housekeeping } = await archiveFixture()
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: { environment: { taskBehavior: { settleInactive: true } }, shared: [] },
    },
    false,
  )
  s.store.updateTask('nested', (task) => ({ ...task, draft: 'Keep this work' }))
  expect(await housekeeping.settleInactive(now)).toEqual([])
  s.store.updateTask('nested', (task) => ({
    ...task,
    draft: '',
    quotaContinuation: { turnId: 'turn', at: new Date(now + 60000).toISOString(), resume: true },
  }))
  expect(await housekeeping.settleInactive(now)).toEqual([])
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({
      ...repo,
      taskBehavior: { settleInactive: false },
    })),
  }))
  expect(await housekeeping.settleInactive(now)).toEqual([])
})
it('waits for an already-started backup step when polling is cancelled during shutdown', async () => {
  const db = openDatabase(':memory:')
  const s = createServices(db, 'shutdown-test-owner-token-with-32-characters')
  cleanups.push(async () => {
    await s.attachments.dispose()
    db.close()
  })
  let enter: () => void = () => {},
    finish: () => void = () => {}
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  vi.spyOn(s.backups, 'automatic').mockImplementation(async () => {
    enter()
    await pending
  })
  const housekeeping = new Housekeeping(s)
  housekeeping.start()
  await entered
  let stopped = false
  const closing = housekeeping.dispose().then(() => {
    stopped = true
  })
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(stopped).toBe(false)
  } finally {
    finish()
    await closing
  }
  expect(stopped).toBe(true)
})

it('keeps threads waiting for feedback out of inactive settlement and archiving', () => {
  const waiting = { ...task('waiting'), waitingForFeedback: true }
  expect(inactiveTaskIds([waiting].map(summarizeTask), 14, now, () => false)).toEqual([])
})

it('archives only after the configured settled period and resets its clock on reopening', async () => {
  const { s, housekeeping } = await archiveFixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  s.preferences.save({ ...s.preferences.get(), autoArchiveDays: 7 })
  s.store.patch({
    collection: 'tasks',
    id: 'parent',
    changes: {
      archived: { before: null, after: true },
      archiveAfterSettledDays: { before: null, after: 7 },
    },
  })
  expect(s.store.task('parent').settledAt).toBe(new Date(now).toISOString())
  expect(await housekeeping.archiveInactive(now + 6 * 86_400_000)).toEqual([])
  s.store.updateTask('parent', (task) => ({ ...task, archived: false }))
  expect(s.store.task('parent').settledAt).toBeUndefined()
  expect(await housekeeping.archiveInactive(now + 8 * 86_400_000)).toEqual([])
  vi.setSystemTime(now + 8 * 86_400_000)
  s.store.updateTask('parent', (task) => ({ ...task, archived: true }))
  expect(await housekeeping.archiveInactive(now + 14 * 86_400_000)).toEqual([])
  expect(await housekeeping.archiveInactive(now + 15 * 86_400_000)).toEqual(['parent'])
  expect(s.store.get().tasks.every((task) => task.archivedAt)).toBe(true)
})

it('protects pinned descendants and pending drafts and honors never auto-archive', async () => {
  const { s, housekeeping } = await archiveFixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  s.store.updateTask('parent', (task) => ({ ...task, archived: true, archiveAfterSettledDays: 1 }))
  const later = now + 2 * 86_400_000
  s.store.updateTask('nested', (task) => ({ ...task, pinned: true }))
  expect(await housekeeping.archiveInactive(later)).toEqual([])
  s.store.updateTask('nested', (task) => ({ ...task, pinned: false, draft: 'Keep this' }))
  expect(await housekeeping.archiveInactive(later)).toEqual([])
  s.store.updateTask('nested', (task) => ({ ...task, draft: '' }))
  s.store.updateTask('parent', (task) => ({ ...task, archiveAfterSettledDays: 0 }))
  expect(await housekeeping.archiveInactive(later)).toEqual([])
  s.store.updateTask('parent', (task) => ({ ...task, archiveAfterSettledDays: 1 }))
  expect(await housekeeping.archiveInactive(later)).toEqual(['parent'])
})

it('honors thread auto-settle overrides over project defaults', async () => {
  const { s, housekeeping } = await archiveFixture()
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: { environment: { taskBehavior: { settleInactive: true } }, shared: [] },
    },
    false,
  )
  s.store.patch({
    collection: 'tasks',
    id: 'parent',
    changes: {
      settleBehavior: { before: null, after: { settleInactive: false } },
    },
  })
  expect(await housekeeping.settleInactive(now)).toEqual([])
  s.store.patch({
    collection: 'tasks',
    id: 'parent',
    changes: {
      settleBehavior: {
        before: { settleInactive: false },
        after: { settleInactive: true, inactiveDays: 14 },
      },
    },
  })
  expect(await housekeeping.settleInactive(now)).toEqual(['parent'])
})

it('inherits settled auto-archive settings, honors project and thread overrides, and protects active tasks', async () => {
  const { s, housekeeping } = await archiveFixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  s.defaults.save(
    {
      ...s.defaults.get(),
      scopedSettings: {
        environment: { taskBehavior: { autoArchiveSettled: true, archiveAfterSettledDays: 3 } },
        shared: [],
      },
    },
    false,
  )
  // Old inactivity must not archive a task that has not entered Settled.
  expect(await housekeeping.archiveInactive(now)).toEqual([])
  s.store.updateTask('parent', (task) => ({ ...task, archived: true }))
  expect(await housekeeping.archiveInactive(now + 2 * 86_400_000)).toEqual([])
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) =>
      repo.id === 'repo' ? { ...repo, taskBehavior: { autoArchiveSettled: false } } : repo,
    ),
  }))
  expect(await housekeeping.archiveInactive(now + 4 * 86_400_000)).toEqual([])
  s.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) =>
      repo.id === 'repo'
        ? { ...repo, taskBehavior: { autoArchiveSettled: true, archiveAfterSettledDays: 5 } }
        : repo,
    ),
  }))
  expect(await housekeeping.archiveInactive(now + 4 * 86_400_000)).toEqual([])
  s.store.updateTask('parent', (task) => ({ ...task, archiveAfterSettledDays: 0 }))
  expect(await housekeeping.archiveInactive(now + 6 * 86_400_000)).toEqual([])
  s.store.updateTask('parent', (task) => ({ ...task, archiveAfterSettledDays: undefined }))
  expect(await housekeeping.archiveInactive(now + 6 * 86_400_000)).toEqual(['parent'])
})
