import { expect, it } from 'vite-plus/test'
import type { Task } from '../workspace'
import { searchTaskMessages, taskSearchHit, taskSearchNeedle } from './task-search'
const thread = (id: string, updatedAt: string, texts: string[]): Task => ({
  id,
  title: id,
  repositoryId: '',
  agentId: '',
  status: 'review',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt,
  draft: '',
  files: [],
  example: false,
  messages: texts.map((text, index) => ({ id: `${id}-${index}`, role: 'user', text })),
})
it('matches case-insensitively and trims snippets around the match', () => {
  const text = `${'a'.repeat(80)} Find ME\n\tnow ${'b'.repeat(120)}`
  const hit = taskSearchHit('task', { id: 'm', role: 'user', text }, taskSearchNeedle('  find me '))
  expect(hit?.snippet.startsWith('…')).toBe(true)
  expect(hit?.snippet.endsWith('…')).toBe(true)
  expect(hit?.snippet).toContain('Find ME now')
  expect(taskSearchHit('task', { id: 'm', role: 'user', text: 'other' }, 'find')).toBeUndefined()
})
it('lists every matching thread by recent activity while bounding hits', () => {
  const tasks = [
    thread('older', '2026-10-01T00:00:00Z', ['match first', 'match second']),
    thread('newer', '2026-10-02T00:00:00Z', ['MATCH only']),
    thread('tie', '2026-10-01T00:00:00Z', ['Match tie']),
    thread('none', '2026-10-03T00:00:00Z', ['nothing']),
  ]
  const result = searchTaskMessages(tasks, 'match', 2)
  expect(result.taskIds).toEqual(['newer', 'older', 'tie'])
  expect(result.hits.map((hit) => hit.messageId)).toEqual(['newer-0', 'older-1'])
  expect(searchTaskMessages(tasks, '   ')).toEqual({ taskIds: [], hits: [] })
})
