import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/studio-core'
import { compareTaskActivity, isSnoozed } from './task-priority'
const task = (id: string, status: Task['status'], updatedAt: string): Task => ({
  id,
  title: id,
  repositoryId: 'repo',
  agentId: 'agent',
  status,
  createdAt: updatedAt,
  updatedAt,
  messages: [],
  files: [],
  draft: '',
  example: false,
})
it('puts input ahead of failure, running, and recent completed work across projects', () => {
  const tasks = [
    task('recent', 'review', '2026-09-12T12:00:00Z'),
    task('running', 'running', '2026-09-12T11:00:00Z'),
    task('input', 'running', '2026-09-10T11:00:00Z'),
    task('failed', 'failed', '2026-09-11T11:00:00Z'),
    task('older', 'review', '2026-09-09T11:00:00Z'),
  ]
  expect(
    tasks.sort((a, b) => compareTaskActivity(a, b, new Set(['input']))).map((t) => t.id),
  ).toEqual(['input', 'failed', 'running', 'recent', 'older'])
})
it('returns snoozed tasks at their deadline and supports clearing snooze', () => {
  const snoozed = {
    ...task('later', 'review', '2026-09-12T11:00:00Z'),
    snoozedUntil: '2026-09-12T12:00:00Z',
  }
  expect(isSnoozed(snoozed, Date.parse('2026-09-12T11:59:59Z'))).toBe(true)
  expect(isSnoozed(snoozed, Date.parse('2026-09-12T12:00:00Z'))).toBe(false)
  expect(isSnoozed({ ...snoozed, snoozedUntil: null }, Date.parse('2026-09-12T11:00:00Z'))).toBe(
    false,
  )
})
