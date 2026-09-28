import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/studio-core'
import { messageResults, switcherResults } from './task-search'
import type { TaskEntry } from './task-collection'

const entry = (id: string, title: string, text: string, changes: Partial<Task> = {}): TaskEntry =>
  ({
    key: id,
    task: {
      id,
      title,
      createdAt: '2026-09-01T00:00:00Z',
      messages: [{ id: `${id}-m`, role: 'user', text }],
      ...changes,
    },
    source: { name: 'Studio Mac' },
    projectName: 'dovo',
  }) as unknown as TaskEntry

it('finds tasks by fuzzy title and puts archived ones last', () => {
  const entries = [
    entry('a', 'Fix login redirect', ''),
    entry('b', 'Fix logo', '', { archivedAt: '2026-09-02T00:00:00.000Z' }),
    entry('c', 'Write docs', ''),
  ]
  expect(switcherResults(entries, 'fix lo').map((item) => item.key)).toEqual(['a', 'b'])
  expect(switcherResults(entries, 'wdc').map((item) => item.key)).toEqual(['c'])
  expect(switcherResults(entries, 'studio').map((item) => item.key)).toEqual(['a', 'c', 'b'])
})

it('returns message snippets around the match', () => {
  const long = `${'x'.repeat(100)} the token refresh fails ${'y'.repeat(200)}`
  const [hit] = messageResults([entry('a', 'Auth', long)], 'Token refresh')
  expect(hit.messageId).toBe('a-m')
  expect(hit.snippet.startsWith('…')).toBe(true)
  expect(hit.snippet).toContain('token refresh fails')
  expect(messageResults([entry('a', 'Auth', long)], 'x')).toEqual([])
})
