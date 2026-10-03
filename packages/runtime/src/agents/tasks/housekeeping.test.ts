import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@dovo/protocol'
import { Housekeeping, inactiveTaskIds } from './housekeeping'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
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
  const busy = (item: Task) => item.id === 'waiting'
  expect(inactiveTaskIds(tasks, 14, now, busy)).toEqual(['stale'])
  expect(inactiveTaskIds(tasks, 30, now, busy)).toEqual([])
  expect(inactiveTaskIds(tasks, 0, now, busy)).toEqual([])
})

const family = () => [
  task('parent'),
  task('child', { delegation: { parentTaskId: 'parent', parentRunId: 'old', key: 'child' } }),
  task('nested', { delegation: { parentTaskId: 'child', parentRunId: 'old', key: 'nested' } }),
]

it('considers descendant activity, pins and busy state and selects only the main thread', () => {
  expect(inactiveTaskIds(family(), 14, now, () => false)).toEqual(['parent'])
  const protections: Partial<Task>[] = [
    { status: 'running' },
    { updatedAt: daysAgo(2) },
    { pinned: true },
  ]
  for (const protection of protections) {
    const tasks = family().map((item) => (item.id === 'nested' ? { ...item, ...protection } : item))
    expect(inactiveTaskIds(tasks, 14, now, () => false)).toEqual([])
  }
  expect(inactiveTaskIds(family(), 14, now, (item) => item.id === 'nested')).toEqual([])
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
  expect(await housekeeping.archiveInactive(now)).toEqual(['parent'])
  expect(s.store.get().tasks.every((item) => item.archived && item.archivedAt)).toBe(true)
  expect(close.mock.calls.map(([id]) => id).sort()).toEqual(['child', 'nested', 'parent'])
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
})
