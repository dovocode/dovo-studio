import { expect, it, vi } from 'vite-plus/test'
import { searchTaskMessages, type Task } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { Conversations } from './conversations.js'

function task(id: string, texts: string[]): Task {
  return {
    id,
    title: id,
    repositoryId: '',
    agentId: '',
    status: 'review',
    draft: '',
    files: [],
    example: false,
    createdAt: '2026-10-01T00:00:00Z',
    messages: texts.map((text, index) => ({ id: `${id}-${index}`, role: 'assistant', text })),
  }
}
function setup(tasks: Task[]) {
  const db = openDatabase(':memory:')
  const conversations = new Conversations(db)
  db.transaction(() => conversations.record(tasks, new Map(), true))()
  return { db, conversations }
}

it('preserves substring search through trigram narrowing, quotes, wildcards and Unicode', () => {
  const tasks = [
    task('one', [
      'abc--bcd',
      'actual abcd',
      'ÄRGER İSTANBUL',
      'Café has an open door',
      'A cafe open late',
      'ﬃ cafe\u0301 🐱',
      'quoted "needle" and %_ wildcard',
      'prefix 🐱🐶🐭 suffix',
    ]),
    task('two', ['a second actual abcd', 'only the fragments abc and bcd', 'different']),
  ]
  const { db, conversations } = setup(tasks)
  try {
    for (const query of [
      'abcd',
      'ärger',
      'i̇stanbul',
      '"needle"',
      '%_ wildcard',
      '🐱🐶🐭',
      'ab',
      'absent',
      'open café',
      '"cafe open"',
      'late "cafe open"',
      'ffi cafe',
      'e',
      '""',
    ])
      expect(
        conversations.search(
          tasks.map((task) => task.id),
          query,
        ),
      ).toEqual(searchTaskMessages(tasks, query))
  } finally {
    db.close()
  }
})

it('matches original JSON strings for malformed UTF-16, replacement characters and NULs', () => {
  const tasks = [
    task('one', [
      'lone \ud800 surrogate',
      'lone \udc00 surrogate',
      'real \ufffd replacement',
      'embedded \0 null',
      'paired 🐱 emoji',
    ]),
    task('two', ['ordinary text']),
  ]
  const { db, conversations } = setup(tasks)
  try {
    for (const query of ['\ud800', '\udc00', '\ufffd', '\0', '🐱'])
      expect(
        conversations.search(
          tasks.map((task) => task.id),
          query,
        ),
      ).toEqual(searchTaskMessages(tasks, query))
  } finally {
    db.close()
  }
})

it('returns every matching task when a common term exceeds the candidate and hit budgets', () => {
  const tasks = Array.from({ length: 60 }, (_, index) =>
    task(`t${index}`, Array(20).fill('common needle')),
  )
  const { db, conversations } = setup(tasks)
  try {
    const result = conversations.search(
      tasks.map((task) => task.id),
      'needle',
    )
    expect(result).toEqual(searchTaskMessages(tasks, 'needle'))
    expect(result.taskIds).toHaveLength(60)
    expect(result.hits).toHaveLength(50)
  } finally {
    db.close()
  }
})

it('keeps the trigram index consistent across edits, removals, rollback and reconstruction', () => {
  const original = task('one', ['original needle'])
  const { db, conversations } = setup([original])
  try {
    const updated = task('one', ['updated needle'])
    expect(() =>
      db.transaction(() => {
        conversations.record([updated], new Map([[original.id, original]]), false)
        throw new Error('rollback')
      })(),
    ).toThrow('rollback')
    expect(conversations.search(['one'], 'original')).toEqual(
      searchTaskMessages([original], 'original'),
    )
    expect(conversations.search(['one'], 'updated').hits).toEqual([])
    db.transaction(() =>
      conversations.record([updated], new Map([[original.id, original]]), false),
    )()
    expect(conversations.search(['one'], 'original').hits).toEqual([])
    expect(conversations.search(['one'], 'updated')).toEqual(
      searchTaskMessages([updated], 'updated'),
    )
    db.exec('DROP TABLE conversation_search')
    const rebuilt = new Conversations(db)
    expect(rebuilt.search(['one'], 'updated')).toEqual(searchTaskMessages([updated], 'updated'))
    db.transaction(() => rebuilt.record([], new Map([[updated.id, updated]]), false))()
    expect(rebuilt.search(['one'], 'updated').hits).toEqual([])
  } finally {
    db.close()
  }
})

it('decodes only a bounded message and turn window from a long conversation', () => {
  const long = task(
    'long',
    Array.from({ length: 2000 }, (_, index) => `message ${index}`),
  )
  long.turns = long.messages.map((message, index) => ({
    id: `turn-${index}`,
    assistantId: message.id,
    agentId: '',
    provider: 'codex',
    model: '',
    status: 'completed',
    startedAt: '2026-10-01T00:00:00Z',
  }))
  const { db, conversations } = setup([long])
  const parse = vi.spyOn(JSON, 'parse')
  try {
    const page = conversations.page('long', undefined, 0)!
    expect(page.messages).toHaveLength(75)
    expect(page.turns).toHaveLength(75)
    expect(page.before).toBe('long-1925')
    expect(parse.mock.calls.length).toBeLessThanOrEqual(152)
  } finally {
    parse.mockRestore()
    db.close()
  }
})

it('scopes common-term searches before reading hits, preserving ordering, zero limits and unrelated histories', () => {
  const selected = task('selected', ['common first', 'common last', 'quote "common" 🐱'])
  const others = Array.from({ length: 55 }, (_, i) =>
    task(`other-${i}`, Array(25).fill('common unrelated')),
  )
  const { db, conversations } = setup([selected, ...others])
  try {
    for (const query of ['common', 'co', '"common"', '🐱', 'absent']) {
      expect(conversations.search([selected.id], query)).toEqual(
        searchTaskMessages([selected], query),
      )
      expect(conversations.search([selected.id], query, 0)).toEqual(
        searchTaskMessages([selected], query, 0),
      )
      expect(conversations.search([others[3].id, selected.id], query, 1)).toEqual(
        searchTaskMessages([others[3], selected], query, 1),
      )
    }
    expect(conversations.search([], 'common')).toEqual({ taskIds: [], hits: [] })
    expect(conversations.search(['missing'], 'common')).toEqual({ taskIds: [], hits: [] })
  } finally {
    db.close()
  }
})
