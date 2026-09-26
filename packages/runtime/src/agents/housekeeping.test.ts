import { expect, it } from 'vitest'
import type { Task } from '@dovo/protocol'
import { inactiveTaskIds } from './housekeeping'

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

it('prunes activity older than the retention window and keeps newer entries', async () => {
  const Database = (await import('better-sqlite3')).default
  const { Activity } = await import('../storage/activity')
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
