import { mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, searchTaskMessages, type Task } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { Conversations } from './conversations.js'
import { WorkspaceStore } from './workspace.js'

const task = (id = 'thread', texts = ['original text']): Task => ({
  id,
  title: id,
  repositoryId: '',
  agentId: '',
  status: 'running',
  draft: '',
  files: [],
  example: false,
  createdAt: '2026-10-01T00:00:00Z',
  messages: texts.map((text, index) => ({ id: `${id}-${index}`, role: 'assistant', text })),
})
function audit(db: ReturnType<typeof openDatabase>) {
  db.exec(`CREATE TABLE search_writes (kind TEXT);
    CREATE TRIGGER audit_history AFTER UPDATE ON conversation_items
    WHEN NEW.kind = 'message' BEGIN INSERT INTO search_writes VALUES ('history'); END;
    CREATE TRIGGER audit_search AFTER UPDATE ON conversation_index
    WHEN NEW.kind = 'message' AND OLD.search_text IS NOT NEW.search_text
    BEGIN INSERT INTO search_writes VALUES ('index'); END;`)
}

it('reduces 100 growing-text index updates to one while committing all 100 message saves', () => {
  const counts = []
  const ftsCounts = []
  for (const defer of [false, true]) {
    const db = openDatabase(':memory:')
    try {
      const store = new WorkspaceStore(db)
      store.update((workspace) => ({ ...workspace, tasks: [task()] }))
      audit(db)
      // SQLite forbids triggers on FTS shadow tables. Preserve the production update trigger
      // and append a transactional audit after each successful FTS command instead.
      const { sql } = decode(
        mutableStruct({ sql: Schema.String }),
        db.prepare("SELECT sql FROM sqlite_master WHERE name = 'conversation_search_update'").get(),
      )
      const audited = sql.replace(/INSERT INTO conversation_search[\s\S]*?;/g, (statement) => {
        const kind = statement.includes("VALUES ('delete'") ? 'fts-delete' : 'fts-insert'
        return `${statement}\nINSERT INTO search_writes VALUES ('${kind}');`
      })
      db.exec(`DROP TRIGGER conversation_search_update; ${audited}`)
      const finish = defer ? store.deferHistorySearch('thread') : () => {}
      for (let chunk = 1; chunk <= 100; chunk++) {
        const text = `Café ${'growing '.repeat(chunk)}open ${chunk}`
        store.updateTaskHistory('thread', (current) => ({
          ...current,
          messages: [{ ...current.messages[0]!, text }],
        }))
        // Reads stay current without settling the index, including short terms and phrases.
        expect(store.searchHistory(`open café ${chunk}`)).toEqual(
          searchTaskMessages([store.task('thread')], `open café ${chunk}`),
        )
        expect(store.searchHistory('original').hits).toEqual([])
        expect(store.searchHistory('é').hits).toHaveLength(1)
        expect(store.historyPage('thread')!.messages[0]!.text).toBe(text)
      }
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'").get(),
      ).toEqual({ count: defer ? 0 : 100 })
      finish()
      finish()
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'history'").get(),
      ).toEqual({ count: 100 })
      const count = db
        .prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'")
        .get()
      counts.push(count)
      // Each replacement executes an FTS delete and insert, audited in the same transaction.
      ftsCounts.push(
        db
          .prepare(`SELECT kind, COUNT(*) AS count FROM search_writes
            WHERE kind IN ('fts-insert', 'fts-delete') GROUP BY kind ORDER BY kind`)
          .all(),
      )
      const finalText = `Café ${'growing '.repeat(100)}open 100`
      expect(
        db
          .prepare(`SELECT json_extract(value, '$.text') AS text FROM conversation_items
            WHERE task_id = 'thread' AND kind = 'message' AND item_id = 'thread-0'`)
          .get(),
      ).toEqual({ text: finalText })
      expect(store.task('thread').messages[0]!.text).toBe(finalText)
      expect(
        db
          .prepare(`SELECT rowid FROM conversation_search WHERE conversation_search MATCH ?`)
          .all('"caf" AND "100"'),
      ).toHaveLength(1)
      expect(
        db
          .prepare(`SELECT rowid FROM conversation_search WHERE conversation_search MATCH ?`)
          .all('"ori"'),
      ).toEqual([])
      db.prepare(`INSERT INTO conversation_search(conversation_search, rank)
        VALUES ('integrity-check', 1)`).run()
      expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
      expect(new WorkspaceStore(db).task('thread').messages).toEqual(store.task('thread').messages)
      expect(store.searchHistory('open café')).toEqual(
        searchTaskMessages([store.task('thread')], 'open café'),
      )
    } finally {
      db.close()
    }
  }
  expect(counts).toEqual([{ count: 100 }, { count: 1 }])
  expect(ftsCounts).toEqual([
    [
      { kind: 'fts-delete', count: 100 },
      { kind: 'fts-insert', count: 100 },
    ],
    [
      { kind: 'fts-delete', count: 1 },
      { kind: 'fts-insert', count: 1 },
    ],
  ])
})

it('bounds the active overlay while paging new, edited and reordered live messages without stale hits', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    const original = task(
      'thread',
      Array.from({ length: 320 }, (_, i) => `old ${i}`),
    )
    store.update((workspace) => ({
      ...workspace,
      tasks: [original, task('other', ['Café other open'])],
    }))
    const finish = store.deferHistorySearch('thread')
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [
        ...current.messages
          .slice(5)
          .reverse()
          .map((message, i) => ({ ...message, text: `Café ${i} is open` })),
        { id: 'appended', role: 'assistant', text: 'An OPEN café' },
      ],
    }))
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get()).toEqual({
      count: 256,
    })
    expect(store.searchHistory('old').hits).toEqual([])
    for (const query of ['open café', 'é', '"is open"', '🐱', 'Café\0']) {
      expect(store.searchHistory(query)).toEqual(
        searchTaskMessages(
          store.get().tasks.map((entry) => store.task(entry.id)),
          query,
        ),
      )
      const ids: string[] = []
      let before: string | undefined
      do {
        const page = store.searchHistory(query, 'thread', before)
        ids.push(...page.hits.map((hit) => hit.messageId))
        before = page.nextBefore
      } while (before !== undefined)
      expect(ids).toEqual(
        searchTaskMessages([store.task('thread')], query, 1000).hits.map((hit) => hit.messageId),
      )
    }
    expect(() => store.searchHistory('cafe', 'thread', 'thread-0')).toThrow(
      'cursor no longer exists',
    )
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: current.messages.slice(0, -1),
    }))
    expect(
      store.searchHistory('open cafe', 'thread').hits.some((hit) => hit.messageId === 'appended'),
    ).toBe(false)
    finish()
    expect(store.searchHistory('open cafe')).toEqual(
      searchTaskMessages(
        store.get().tasks.map((entry) => store.task(entry.id)),
        'open cafe',
      ),
    )
    expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
  } finally {
    db.close()
  }
})

it('batches overflow reconciliation and searches a bounded overlay without retaining whole histories', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        task(
          'thread',
          Array.from({ length: 1100 }, (_, i) => `old ${i}`),
        ),
        task(
          'other',
          Array.from({ length: 1200 }, () => 'Unrelated Café'),
        ),
      ],
    }))
    const batches: number[] = []
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (sql.includes('FROM conversation_search_pending AS pending')) {
        const all = statement.all.bind(statement)
        vi.spyOn(statement, 'all').mockImplementation((...parameters: unknown[]) => {
          const rows = all(...parameters)
          batches.push(rows.length)
          return rows
        })
      }
      return statement
    })
    const finish = store.deferHistorySearch('thread')
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: current.messages.map((message, i) => ({ ...message, text: `Café ${i} is open` })),
    }))
    expect(batches.filter((count) => count > 0).length).toBeGreaterThan(3)
    const retained = store.retainedHistories()
    const parse = vi.spyOn(JSON, 'parse')
    const live = store.searchHistory('open cafe', 'thread')
    const liveReads = parse.mock.calls.length
    expect(live.hits).toHaveLength(50)
    expect(live.nextBefore).toBe('thread-1050')
    expect(liveReads).toBeLessThanOrEqual(256 + 51)
    parse.mockClear()
    expect(store.searchHistory('unrelated cafe', 'other').hits).toHaveLength(50)
    expect(parse.mock.calls.length).toBeLessThanOrEqual(51)
    parse.mockRestore()
    expect(store.retainedHistories()).toEqual(retained)
    finish()
    expect(Math.max(...batches)).toBeLessThanOrEqual(256)
    expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
  } finally {
    vi.restoreAllMocks()
    db.close()
  }
})

it('reconciles large-message overflow before loading a byte-bounded, complete live search overlay', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        task(
          'thread',
          Array.from({ length: 5 }, () => 'Original'),
        ),
      ],
    }))
    audit(db)
    const finish = store.deferHistorySearch('thread')
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: current.messages.map((message, i) => ({
        ...message,
        text: `Café open ${i} ${'x'.repeat(i === 0 ? 2 * 1024 * 1024 : i === 4 ? 100 : 400 * 1024)}`,
      })),
    }))
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'").get(),
    ).toEqual({ count: 0 })
    const reads: { rows: number; bytes: number }[] = []
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (sql.includes('pending.task_id, pending.item_id, item.value')) {
        const all = statement.all.bind(statement)
        vi.spyOn(statement, 'all').mockImplementation((...parameters: unknown[]) => {
          const rows = all(...parameters)
          const values = decode(mutableArray(mutableStruct({ value: Schema.String })), rows)
          reads.push({
            rows: values.length,
            bytes: values.reduce((total, row) => total + Buffer.byteLength(row.value), 0),
          })
          return rows
        })
      }
      return statement
    })
    const expected = searchTaskMessages([store.task('thread')], 'open cafe')
    expect(store.searchHistory('open cafe', 'thread')).toEqual(expected)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'").get(),
    ).toEqual({ count: 2 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get()).toEqual({
      count: 3,
    })
    expect(reads.some((read) => read.rows > 1)).toBe(true)
    expect(reads.every((read) => read.rows <= 1 || read.bytes <= 1024 * 1024)).toBe(true)
    const indexWrites = db
      .prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'")
      .get()
    expect(store.searchHistory('open cafe', 'thread')).toEqual(expected)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'").get(),
    ).toEqual(indexWrites)
    finish()
    expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
    expect(store.searchHistory('open cafe', 'thread')).toEqual(expected)
  } finally {
    vi.restoreAllMocks()
    db.close()
  }
})

it('keeps a live search cursor stable when newer messages arrive and older text starts matching', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        task(
          'thread',
          Array.from({ length: 130 }, (_, i) => (i >= 40 ? `Café open ${i}` : `Old ${i}`)),
        ),
      ],
    }))
    const finish = store.deferHistorySearch('thread')
    const first = store.searchHistory('open cafe', 'thread')
    expect(first.nextBefore).toBe('thread-80')
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [
        ...current.messages.map((message) =>
          message.id === 'thread-10'
            ? { ...message, text: 'An open café appears in older streamed text' }
            : message,
        ),
        { id: 'newer', role: 'assistant', text: 'Café open in a new message' },
      ],
    }))
    const second = store.searchHistory('open cafe', 'thread', first.nextBefore)
    expect(second.hits.map((hit) => hit.messageId)).toEqual([
      ...Array.from({ length: 40 }, (_, i) => `thread-${79 - i}`),
      'thread-10',
    ])
    expect(second.nextBefore).toBeUndefined()
    expect(new Set([...first.hits, ...second.hits].map((hit) => hit.messageId)).size).toBe(91)
    expect(store.searchHistory('open cafe', 'thread').hits[0]!.messageId).toBe('newer')
    finish()
  } finally {
    db.close()
  }
})

it('reconciles committed pending text after a writer crashes without cleanup or closing SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-stream-search-'))
  const databasePath = join(directory, 'workspace.sqlite')
  let db = openDatabase(databasePath)
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({ ...workspace, tasks: [task()] }))
    db.close()
    const writer = spawn(
      process.execPath,
      [
        '--import',
        new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
        '--conditions=development',
        '--input-type=module',
        '--eval',
        `
        import { openDatabase } from ${JSON.stringify(new URL('./database.ts', import.meta.url).href)};
        import { WorkspaceStore } from ${JSON.stringify(new URL('./workspace.ts', import.meta.url).href)};
        const db = openDatabase(process.argv[1]);
        const store = new WorkspaceStore(db);
        store.deferHistorySearch('thread');
        store.updateTaskHistory('thread', current => ({
          ...current, messages: [{ ...current.messages[0], text: 'Café recovered partial answer' }],
        }));
        process.stdout.write('committed\\n', () => process.kill(process.pid, 'SIGKILL'));
      `,
        databasePath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 },
    )
    let stdout = '',
      stderr = ''
    writer.stdout.setEncoding('utf8').on('data', (data: string) => {
      stdout += data
    })
    writer.stderr.setEncoding('utf8').on('data', (data: string) => {
      stderr += data
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      writer.once('error', reject)
      writer.once('close', resolve)
    })
    expect({ stdout, stderr }).toEqual({ stdout: 'committed\n', stderr: '' })
    expect(code).not.toBe(0)
    db = openDatabase(databasePath)
    expect(db.prepare('SELECT search_text FROM conversation_index').get()).toEqual({
      search_text: 'original text',
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get()).toEqual({
      count: 1,
    })
    const restarted = new WorkspaceStore(db)
    expect(restarted.task('thread').messages[0]!.text).toBe('Café recovered partial answer')
    expect(restarted.searchHistory('partial cafe').hits).toHaveLength(1)
    expect(restarted.searchHistory('original').hits).toEqual([])
    expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)

it.each(['completion retry', 'later run', 'normal write'])(
  'rolls back deferred writes and recovers failed reconciliation through a %s',
  (recovery) => {
    const db = openDatabase(':memory:')
    try {
      const conversations = new Conversations(db)
      const original = task()
      db.transaction(() => conversations.record([original], new Map(), true))()
      const finish = conversations.deferSearch('thread')
      const updated = task('thread', ['Café updated'])
      let latest = updated
      expect(() =>
        db.transaction(() => {
          conversations.record([updated], new Map([['thread', original]]), false)
          throw new Error('rollback')
        })(),
      ).toThrow('rollback')
      expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
      expect(conversations.search(['thread'], 'original')).toEqual(
        searchTaskMessages([original], 'original'),
      )
      db.transaction(() =>
        conversations.record([updated], new Map([['thread', original]]), false),
      )()
      db.exec(
        `CREATE TRIGGER reject_search BEFORE UPDATE ON conversation_index BEGIN SELECT RAISE(ABORT, 'full disk'); END`,
      )
      expect(finish).toThrow('full disk')
      expect(conversations.search(['thread'], 'updated cafe')).toEqual(
        searchTaskMessages([updated], 'updated cafe'),
      )
      expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get()).toEqual(
        {
          count: 1,
        },
      )
      db.exec('DROP TRIGGER reject_search')
      if (recovery === 'completion retry') finish()
      else if (recovery === 'later run') conversations.deferSearch('thread')()
      else {
        latest = task('thread', ['Café updated after failure'])
        db.transaction(() =>
          conversations.record([latest], new Map([['thread', updated]]), false),
        )()
      }
      expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
      expect(conversations.search(['thread'], 'updated cafe')).toEqual(
        searchTaskMessages([latest], 'updated cafe'),
      )
    } finally {
      db.close()
    }
  },
)

it('keeps independent deferral owners active and removes pending text when a task is deleted', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({ ...workspace, tasks: [task()] }))
    const outer = store.deferHistorySearch('thread')
    const inner = store.deferHistorySearch('thread')
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [{ ...current.messages[0]!, text: 'Café first' }],
    }))
    inner()
    inner()
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get()).toEqual({
      count: 1,
    })
    store.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [{ ...current.messages[0]!, text: 'Café second' }],
    }))
    expect(store.searchHistory('second cafe').hits).toHaveLength(1)
    store.update((workspace) => ({ ...workspace, tasks: [] }))
    outer()
    expect(db.prepare('SELECT * FROM conversation_search_pending').all()).toEqual([])
    expect(db.prepare('SELECT * FROM conversation_index').all()).toEqual([])
    expect(store.searchHistory('cafe').hits).toEqual([])
  } finally {
    db.close()
  }
})

it('upgrades the old lowercase index and ignores ordinal-only FTS updates', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [task('thread', ['Café open', 'Second reply'])],
    }))
    db.prepare(
      "UPDATE conversation_index SET search_text = 'café open' WHERE item_id = 'thread-0'",
    ).run()
    db.prepare("UPDATE documents SET value = '2' WHERE id = 'conversation-index-version'").run()
    // Model the previous trigger, which rewrote FTS even when only paging metadata changed.
    db.exec(`DROP TRIGGER conversation_search_update;
      CREATE TRIGGER conversation_search_update AFTER UPDATE ON conversation_index
      WHEN NEW.kind = 'message' BEGIN
        INSERT INTO conversation_search(conversation_search, rowid, search_text) VALUES ('delete', OLD.rowid, OLD.search_text);
        INSERT INTO conversation_search(rowid, search_text) VALUES (NEW.rowid, NEW.search_text);
      END;`)
    const reopened = new WorkspaceStore(db)
    expect(reopened.searchHistory('open cafe').hits.map((hit) => hit.messageId)).toEqual([
      'thread-0',
    ])
    expect(
      db.prepare("SELECT value FROM documents WHERE id = 'conversation-index-version'").get(),
    ).toEqual({ value: '3' })
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'conversation_search_update'")
      .get()
    expect(trigger).toEqual({
      sql: expect.stringContaining('OLD.search_text IS NOT NEW.search_text'),
    })
    audit(db)
    reopened.updateTaskHistory('thread', (current) => ({
      ...current,
      messages: [...current.messages].reverse(),
    }))
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM search_writes WHERE kind = 'index'").get(),
    ).toEqual({ count: 0 })
    expect(reopened.searchHistory('open cafe').hits).toHaveLength(1)
  } finally {
    db.close()
  }
})
