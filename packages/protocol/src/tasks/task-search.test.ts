import { expect, it } from 'vite-plus/test'
import type { Task } from '../workspace'
import {
  searchTaskMessages,
  taskSearchHit,
  taskSearchMatch,
  taskSearchNeedle,
  taskSearchTerms,
} from './task-search'
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

it('matches separated words and accents without typos, with explicit literal phrases', () => {
  const tasks = [
    thread('one', '', [
      'The Café has an open door',
      'An OPEN café',
      'A cafe open late',
      'The cafeteria is closed',
    ]),
  ]
  expect(searchTaskMessages(tasks, 'cafe open').hits.map((hit) => hit.messageId)).toEqual([
    'one-2',
    'one-1',
    'one-0',
  ])
  expect(searchTaskMessages(tasks, '"café open"').hits.map((hit) => hit.messageId)).toEqual([
    'one-2',
  ])
  expect(searchTaskMessages(tasks, 'late "cafe open"').hits.map((hit) => hit.messageId)).toEqual([
    'one-2',
  ])
  expect(searchTaskMessages(tasks, 'cfae open').hits).toEqual([])
  expect(searchTaskMessages(tasks, 'has z').hits).toEqual([])
  expect(searchTaskMessages(tasks, 'é').hits).toHaveLength(4)
  expect(taskSearchTerms('  café "open door" café ')).toEqual(['cafe', 'open door'])
  expect(taskSearchMatch('text', '""')).toBeUndefined()
})

it.each([
  ['İ 🐱 Café needle', 'needle', 'needle'],
  ['ﬃ İstanbul cafe\u0301 🐱', 'cafe', 'cafe\u0301'],
  ['before ﬁnal after', 'final', 'ﬁnal'],
  ['before ﬁ after', 'i', 'ﬁ'],
  ['before 🐱 after', '🐱', '🐱'],
  ['Αυτός', 'αυτοσ', 'Αυτός'],
])('maps folded offsets back to source text: %s', (text, query, source) => {
  const match = taskSearchMatch(text, query)!
  expect(text.slice(match.start, match.end)).toBe(source)
})

it('keeps snippet context at Unicode character boundaries after folding', () => {
  const text = `${'İ'.repeat(80)}🐱${'x'.repeat(59)} Café ${'z'.repeat(99)}🐱end`
  const snippet = taskSearchHit('one', { id: 'm', role: 'assistant', text }, 'cafe')!.snippet
  expect(snippet).toContain('Café')
  expect(snippet).not.toContain('\ufffd')
  expect(/[\ud800-\udfff]/u.test(snippet)).toBe(false)
})
