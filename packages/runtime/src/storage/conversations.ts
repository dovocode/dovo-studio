import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  conversationPageMessages,
  conversationWindowPage,
  decode,
  messageSchema,
  turnSchema,
  mutableArray,
  mutableStruct,
  taskSearchHit,
  taskSearchTerms,
  taskSearchText,
  type ConversationPage,
  type Task,
  type TaskSearchResult,
} from '@dovo/protocol'
const valuesSchema = mutableArray(mutableStruct({ value: Schema.String }))
const ordinalSchema = Schema.UndefinedOr(mutableStruct({ ordinal: Schema.Number }))
const countSchema = mutableStruct({ items: Schema.Number, indexed: Schema.Number })
const sourceSchema = mutableArray(
  mutableStruct({
    row: Schema.Number,
    task_id: Schema.String,
    kind: Schema.String,
    item_id: Schema.String,
    ordinal: Schema.Number,
    value: Schema.String,
  }),
)
const indexVersion = '3'
const candidateLimit = 1000
const liveSearchLimit = 256
const liveSearchBytes = 1024 * 1024
const pendingSchema = mutableArray(
  mutableStruct({
    row: Schema.Number,
    task_id: Schema.String,
    item_id: Schema.String,
    value: Schema.String,
  }),
)
const searchTriggers = `
  CREATE TRIGGER IF NOT EXISTS conversation_search_insert AFTER INSERT ON conversation_index
  WHEN NEW.kind = 'message' BEGIN
    INSERT INTO conversation_search(rowid, search_text) VALUES (NEW.rowid, NEW.search_text);
  END;
  CREATE TRIGGER IF NOT EXISTS conversation_search_delete AFTER DELETE ON conversation_index
  WHEN OLD.kind = 'message' BEGIN
    INSERT INTO conversation_search(conversation_search, rowid, search_text)
    VALUES ('delete', OLD.rowid, OLD.search_text);
  END;
  CREATE TRIGGER IF NOT EXISTS conversation_search_update AFTER UPDATE ON conversation_index
  WHEN NEW.kind = 'message' AND OLD.search_text IS NOT NEW.search_text BEGIN
    INSERT INTO conversation_search(conversation_search, rowid, search_text)
    VALUES ('delete', OLD.rowid, OLD.search_text);
    INSERT INTO conversation_search(rowid, search_text) VALUES (NEW.rowid, NEW.search_text);
  END;`

/** History is authoritative in SQLite; workspace metadata never rewrites old messages.
 * `conversation_index` is derived from `conversation_items` in the same transactions: it keeps
 * ordering, turn ownership and folded message text out of the large JSON rows so paging and
 * search read only the records they return. */
export class Conversations {
  private readonly deferredSearch = new Map<string, number>()
  constructor(private readonly db: Database.Database) {
    const hadSearch = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'conversation_search' AND type = 'table'",
      )
      .get()
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_items (
      task_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(task_id, kind, item_id));
      CREATE INDEX IF NOT EXISTS conversation_items_order ON conversation_items(task_id, kind, ordinal);
      CREATE TABLE IF NOT EXISTS conversation_index (
      task_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      assistant_id TEXT, search_text TEXT, PRIMARY KEY(task_id, kind, item_id));
      CREATE INDEX IF NOT EXISTS conversation_index_order ON conversation_index(task_id, kind, ordinal);
      CREATE INDEX IF NOT EXISTS conversation_index_assistant ON conversation_index(task_id, kind, assistant_id);
      CREATE TABLE IF NOT EXISTS conversation_search_pending (
        task_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(task_id, item_id));
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
        search_text, content='conversation_index', content_rowid='rowid',
        tokenize='trigram case_sensitive 1', detail='none');`)
    this.ensureIndex(!hadSearch)
    db.exec(searchTriggers)
    // A crash may leave derived text behind its committed source. No run owns it after restart.
    this.reconcileSearch()
  }
  /** Only derived search text is deferred. Message JSON and paging metadata remain durable.
   * The owner must finish in its outermost finally, after its last authoritative flush. */
  deferSearch(taskId: string) {
    this.deferredSearch.set(taskId, (this.deferredSearch.get(taskId) ?? 0) + 1)
    let released = false
    return () => {
      if (!released) {
        const owners = this.deferredSearch.get(taskId) ?? 1
        if (owners === 1) this.deferredSearch.delete(taskId)
        else this.deferredSearch.set(taskId, owners - 1)
        released = true
      }
      // A failed index write must not leave a completed run owning future deferrals.
      // Pending rows remain durable, and this callback can safely retry reconciliation.
      if (!this.deferredSearch.has(taskId)) this.reconcileSearch(taskId)
    }
  }
  private pendingSearch(taskIds?: readonly string[], limit?: number) {
    return decode(
      pendingSchema,
      this.db
        .prepare(`SELECT entry.rowid AS row,
      pending.task_id, pending.item_id, item.value FROM conversation_search_pending AS pending
      JOIN conversation_index AS entry ON entry.task_id = pending.task_id
        AND entry.kind = 'message' AND entry.item_id = pending.item_id
      JOIN conversation_items AS item USING (task_id, kind, item_id)
      ${taskIds === undefined ? '' : 'WHERE pending.task_id IN (SELECT value FROM json_each(?))'}
      ORDER BY pending.rowid LIMIT ?`)
        .all(...(taskIds === undefined ? [] : [JSON.stringify(taskIds)]), limit ?? liveSearchLimit),
    )
  }
  private storedSearchText(value: string) {
    let item: unknown
    try {
      item = JSON.parse(value)
    } catch {
      return null
    }
    return item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
      ? taskSearchText(item.text)
      : null
  }
  private boundSearchOverlay(taskIds: readonly string[]) {
    // octet_length(column) uses SQLite's stored byte count without loading the JSON body.
    // Budget only when searching, so streaming saves never scan growing text for sizing.
    const rows = decode(
      mutableArray(mutableStruct({ task_id: Schema.String, bytes: Schema.Number })),
      this.db
        .prepare(`SELECT pending.task_id, octet_length(item.value) AS bytes
        FROM conversation_search_pending AS pending
        JOIN conversation_items AS item ON item.task_id = pending.task_id
          AND item.kind = 'message' AND item.item_id = pending.item_id
        WHERE pending.task_id IN (SELECT value FROM json_each(?)) ORDER BY pending.rowid`)
        .all(JSON.stringify(taskIds)),
    )
    let bytes = rows.reduce((total, row) => total + row.bytes, 0)
    for (const row of rows) {
      if (bytes <= liveSearchBytes) break
      // A single message can exceed the budget. Reconcile overflow one at a time, rather
      // than materializing a batch of oversized bodies while trying to shrink the overlay.
      this.reconcileSearch(row.task_id, 1)
      bytes -= row.bytes
    }
  }
  private reconcileSearch(taskId?: string, limit?: number) {
    this.db.transaction(() => {
      const write = this.db.prepare(`UPDATE conversation_index SET search_text = ?
        WHERE task_id = ? AND kind = 'message' AND item_id = ? AND search_text IS NOT ?`)
      const remove = this.db.prepare(
        'DELETE FROM conversation_search_pending WHERE task_id = ? AND item_id = ?',
      )
      let remaining = limit ?? Infinity
      while (remaining > 0) {
        const rows = this.pendingSearch(
          taskId === undefined ? undefined : [taskId],
          Math.min(remaining, liveSearchLimit),
        )
        if (!rows.length) break
        for (const row of rows) {
          const text = this.storedSearchText(row.value)
          write.run(text, row.task_id, row.item_id, text)
          remove.run(row.task_id, row.item_id)
        }
        remaining -= rows.length
      }
    })()
  }
  /** Rebuild the derived index after an upgrade, a restore from an older backup, or any drift. */
  private ensureIndex(force: boolean) {
    const marker = this.db
      .prepare("SELECT value FROM documents WHERE id = 'conversation-index-version'")
      .get()
    const counts = decode(
      countSchema,
      this.db
        .prepare(
          'SELECT (SELECT COUNT(*) FROM conversation_items) AS items, (SELECT COUNT(*) FROM conversation_index) AS indexed',
        )
        .get(),
    )
    if (
      !force &&
      marker &&
      decode(mutableStruct({ value: Schema.String }), marker).value === indexVersion &&
      counts.items === counts.indexed
    )
      return
    this.db.transaction(() => {
      // Rebuild from authoritative history without applying deletes to a newly created FTS index.
      this.db.exec(`DROP TRIGGER IF EXISTS conversation_search_insert;
        DROP TRIGGER IF EXISTS conversation_search_delete;
        DROP TRIGGER IF EXISTS conversation_search_update;`)
      this.db.prepare('DELETE FROM conversation_index').run()
      this.db.prepare('DELETE FROM conversation_search_pending').run()
      const read = this.db.prepare(
        'SELECT rowid AS row, task_id, kind, item_id, ordinal, value FROM conversation_items WHERE rowid > ? ORDER BY rowid LIMIT 500',
      )
      const write = this.indexStatement()
      let after = 0
      for (;;) {
        const rows = decode(sourceSchema, read.all(after))
        if (!rows.length) break
        for (const row of rows) {
          let item: unknown
          try {
            item = JSON.parse(row.value)
          } catch {
            // Unreadable rows stay verbatim for recovery; hydration reports them for live tasks.
            item = undefined
          }
          const fields = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
          write.run(
            row.task_id,
            row.kind,
            row.item_id,
            row.ordinal,
            row.kind === 'turn' && typeof fields.assistantId === 'string'
              ? fields.assistantId
              : null,
            row.kind === 'message' && typeof fields.text === 'string'
              ? taskSearchText(fields.text)
              : null,
          )
        }
        after = rows.at(-1)!.row
      }
      this.db
        .prepare("INSERT INTO conversation_search(conversation_search) VALUES ('rebuild')")
        .run()
      this.db.exec(searchTriggers)
      this.db
        .prepare(
          "INSERT INTO documents VALUES ('conversation-index-version', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
        )
        .run(indexVersion)
    })()
  }
  private indexStatement() {
    return this.db.prepare(`INSERT INTO conversation_index VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, kind, item_id) DO UPDATE SET ordinal = excluded.ordinal,
      assistant_id = excluded.assistant_id, search_text = excluded.search_text
      WHERE ordinal IS NOT excluded.ordinal OR assistant_id IS NOT excluded.assistant_id
        OR search_text IS NOT excluded.search_text`)
  }
  record(tasks: readonly Task[], previous: ReadonlyMap<string, Task>, seed: boolean) {
    if (seed) {
      this.db.prepare('DELETE FROM conversation_items').run()
      this.db.prepare('DELETE FROM conversation_index').run()
      this.db.prepare('DELETE FROM conversation_search_pending').run()
    }
    const write = this.db.prepare(`INSERT INTO conversation_items VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, kind, item_id) DO UPDATE SET ordinal = excluded.ordinal, value = excluded.value`)
    const index = this.indexStatement()
    const deferredIndex = this.db
      .prepare(`INSERT INTO conversation_index VALUES (?, 'message', ?, ?, NULL, NULL)
      ON CONFLICT(task_id, kind, item_id) DO UPDATE SET ordinal = excluded.ordinal
      WHERE ordinal IS NOT excluded.ordinal`)
    const pending = this.db.prepare(
      'INSERT OR IGNORE INTO conversation_search_pending VALUES (?, ?)',
    )
    const clearPending = this.db.prepare(
      'DELETE FROM conversation_search_pending WHERE task_id = ? AND item_id = ?',
    )
    const remove = this.db.prepare(
      'DELETE FROM conversation_items WHERE task_id = ? AND kind = ? AND item_id = ?',
    )
    const unindex = this.db.prepare(
      'DELETE FROM conversation_index WHERE task_id = ? AND kind = ? AND item_id = ?',
    )
    for (const task of tasks) {
      const old = previous.get(task.id)
      if (!seed && task === old) continue
      for (const kind of ['message', 'turn'] as const) {
        const items = kind === 'message' ? task.messages : (task.turns ?? [])
        const before = kind === 'message' ? old?.messages : old?.turns
        if (!seed && items === before) continue
        const previousItems = new Map(before?.map((item, index) => [item.id, { item, index }]))
        const retained = new Set<string>()
        items.forEach((item, position) => {
          if (retained.has(item.id))
            throw new Error(
              `Duplicate ${kind} ID ${item.id} in ${task.id}. History was not changed.`,
            )
          retained.add(item.id)
          const prior = previousItems.get(item.id)
          if (seed || prior?.item !== item || prior.index !== position) {
            write.run(task.id, kind, item.id, position, JSON.stringify(item))
            if (kind === 'message' && this.deferredSearch.has(task.id)) {
              deferredIndex.run(task.id, item.id, position)
              pending.run(task.id, item.id)
            } else {
              index.run(
                task.id,
                kind,
                item.id,
                position,
                kind === 'turn' && 'assistantId' in item ? item.assistantId : null,
                kind === 'message' && 'text' in item ? taskSearchText(item.text) : null,
              )
              if (kind === 'message') clearPending.run(task.id, item.id)
            }
          }
        })
        for (const id of previousItems.keys())
          if (!retained.has(id)) {
            remove.run(task.id, kind, id)
            unindex.run(task.id, kind, id)
            if (kind === 'message') clearPending.run(task.id, id)
          }
      }
    }
    const retained = new Set(tasks.map((task) => task.id))
    for (const id of previous.keys())
      if (!retained.has(id)) {
        this.db.prepare('DELETE FROM conversation_items WHERE task_id = ?').run(id)
        this.db.prepare('DELETE FROM conversation_index WHERE task_id = ?').run(id)
        this.db.prepare('DELETE FROM conversation_search_pending WHERE task_id = ?').run(id)
      }
    // Bound live search work even for runs producing many separate assistant messages.
    const count = decode(
      mutableStruct({ count: Schema.Number }),
      this.db.prepare('SELECT COUNT(*) AS count FROM conversation_search_pending').get(),
    ).count
    if (count > liveSearchLimit) this.reconcileSearch(undefined, count - liveSearchLimit)
  }
  /** Reads one page from SQLite with `conversationPage` semantics. Undefined: the cursor is gone. */
  page(
    taskId: string,
    before: string | undefined,
    historyRevision: number | undefined,
  ): ConversationPage | undefined {
    let end = Number.MAX_SAFE_INTEGER
    if (before !== undefined) {
      const cursor = decode(
        ordinalSchema,
        this.db
          .prepare(
            "SELECT ordinal FROM conversation_items WHERE task_id = ? AND kind = 'message' AND item_id = ?",
          )
          .get(taskId, before),
      )
      if (!cursor) return undefined
      end = cursor.ordinal
    }
    const messages = decode(
      valuesSchema,
      this.db
        .prepare(
          "SELECT value FROM conversation_items WHERE task_id = ? AND kind = 'message' AND ordinal < ? ORDER BY ordinal DESC LIMIT ?",
        )
        .all(taskId, end, conversationPageMessages + 1),
    )
      .reverse()
      .map((row) => decode(messageSchema, JSON.parse(row.value)))
    const turns = decode(
      valuesSchema,
      this.db
        .prepare(
          `SELECT value FROM (
            SELECT item.value, item.ordinal FROM conversation_items AS item
            WHERE task_id = ? AND kind = 'turn' AND item_id IN (SELECT value FROM json_each(?))
            UNION
            SELECT item.value, item.ordinal FROM conversation_index AS entry
            JOIN conversation_items AS item USING (task_id, kind, item_id)
            WHERE entry.task_id = ? AND entry.kind = 'turn'
              AND entry.assistant_id IN (SELECT value FROM json_each(?))
          ) ORDER BY ordinal`,
        )
        .all(
          taskId,
          JSON.stringify(messages.flatMap((message) => (message.turnId ? [message.turnId] : []))),
          taskId,
          JSON.stringify(messages.map((message) => message.id)),
        ),
    ).map((row) => decode(turnSchema, JSON.parse(row.value)))
    return conversationWindowPage({ messages, turns, historyRevision })
  }
  /** `searchTaskMessages` over stored history. Every matching task is listed; hits are bounded. */
  search(
    orderedTaskIds: readonly string[],
    needle: string,
    limit = 50,
    before?: string,
  ): TaskSearchResult {
    const terms = taskSearchTerms(needle)
    if (!terms.length || !orderedTaskIds.length) return { taskIds: [], hits: [] }
    let end = Number.MAX_SAFE_INTEGER
    if (before !== undefined) {
      if (orderedTaskIds.length !== 1) throw new Error('Choose one thread for paged search')
      const cursor = decode(
        ordinalSchema,
        this.db
          .prepare(
            "SELECT ordinal FROM conversation_items WHERE task_id = ? AND kind = 'message' AND item_id = ?",
          )
          .get(orderedTaskIds[0], before),
      )
      if (!cursor) throw new Error('The search cursor no longer exists. Search again.')
      end = cursor.ordinal
    }
    // SQLite encodes strings as UTF-8. For malformed UTF-16, replacement characters, and
    // NULs, match original JSON text in JS to preserve the protocol's exact semantics.
    if (/[\ud800-\udfff]/u.test(needle) || needle.includes('\ufffd') || needle.includes('\0'))
      return this.searchOriginalText(orderedTaskIds, needle, limit, end)
    this.boundSearchOverlay(orderedTaskIds)
    const candidates = this.searchCandidates(terms)
    const candidateJson = candidates === undefined ? undefined : JSON.stringify(candidates)
    const live = this.pendingSearch(orderedTaskIds).map((row) => ({
      row: row.row,
      text: this.storedSearchText(row.value),
    }))
    // Only the bounded live overlay bypasses trigram narrowing. Exclude its stale indexed
    // text before merging, so edits can both add matches and remove old ones.
    const prefix = live.length
      ? `WITH live AS (
      SELECT json_extract(value, '$.row') AS row, json_extract(value, '$.text') AS search_text
      FROM json_each(?)
    ), entries AS (
      SELECT rowid, task_id, kind, item_id, ordinal, search_text
      FROM conversation_index WHERE rowid NOT IN (SELECT row FROM live)
        ${candidateJson === undefined ? '' : 'AND rowid IN (SELECT value FROM json_each(?))'}
      UNION ALL
      SELECT entry.rowid, entry.task_id, entry.kind, entry.item_id, entry.ordinal, live.search_text
      FROM live JOIN conversation_index AS entry ON entry.rowid = live.row
    ) `
      : ''
    const source = live.length ? 'entries' : 'conversation_index'
    const parameters = [
      ...(live.length ? [JSON.stringify(live)] : []),
      ...(candidateJson === undefined ? [] : [candidateJson]),
    ]
    const narrowed =
      candidateJson === undefined || live.length
        ? ''
        : 'entry.rowid IN (SELECT value FROM json_each(?)) AND'
    const matches = `NOT EXISTS (SELECT 1 FROM json_each(?) AS term
      WHERE coalesce(instr(entry.search_text, term.value), 0) = 0)`
    const query = JSON.stringify(terms)
    if (orderedTaskIds.length === 1) {
      const taskId = orderedTaskIds[0]
      const rows = decode(
        valuesSchema,
        this.db
          .prepare(`${prefix}SELECT item.value FROM ${source} AS entry
        JOIN conversation_items AS item USING (task_id, kind, item_id)
        WHERE ${narrowed}
          entry.task_id = ? AND entry.kind = 'message' AND ${matches} AND entry.ordinal < ?
        ORDER BY entry.ordinal DESC LIMIT ?`)
          .all(...parameters, taskId, query, end, Math.max(1, limit)),
      )
      const hits = rows.flatMap((row) => {
        const hit = taskSearchHit(taskId, decode(messageSchema, JSON.parse(row.value)), needle)
        return hit ? [hit] : []
      })
      return { taskIds: hits.length ? [taskId] : [], hits: hits.slice(0, Math.max(0, limit)) }
    }
    // Narrow by task before scanning common terms. Keep the global trigram index for rare
    // terms, but never scan unrelated histories when the caller already supplied a scope.
    const scope = JSON.stringify(orderedTaskIds)
    const matching = new Set(
      decode(
        mutableArray(mutableStruct({ task_id: Schema.String })),
        this.db
          .prepare(`${prefix}SELECT DISTINCT task_id FROM ${source} AS entry
            WHERE ${narrowed} task_id IN (SELECT value FROM json_each(?))
              AND kind = 'message' AND ${matches}`)
          .all(...parameters, scope, query),
      ).map((row) => row.task_id),
    )
    const read = this.db.prepare(`${prefix}SELECT item.value FROM ${source} AS entry
      JOIN conversation_items AS item USING (task_id, kind, item_id)
      WHERE ${narrowed}
        entry.task_id = ? AND entry.kind = 'message' AND ${matches}
      ORDER BY entry.ordinal DESC LIMIT ?`)
    const result: TaskSearchResult = { taskIds: [], hits: [] }
    for (const taskId of orderedTaskIds) {
      if (!matching.has(taskId)) continue
      result.taskIds.push(taskId)
      if (result.hits.length >= limit) continue
      for (const row of decode(
        valuesSchema,
        read.all(...parameters, taskId, query, limit - result.hits.length),
      )) {
        const hit = taskSearchHit(taskId, decode(messageSchema, JSON.parse(row.value)), needle)
        if (hit) result.hits.push(hit)
      }
    }
    return result
  }
  /** Trigrams narrow rare substring searches. Common and short terms use a direct scan,
   * avoiding huge candidate lists while still returning every matching task ID. */
  private searchCandidates(terms: readonly string[]): number[] | undefined {
    const grams = new Set<string>()
    for (const term of terms) {
      const characters = Array.from(term)
      for (let index = 0; index + 2 < characters.length && grams.size < 8; index++)
        grams.add(characters.slice(index, index + 3).join(''))
      if (grams.size >= 8) break
    }
    if (!grams.size) return undefined
    const query = [...grams].map((gram) => `"${gram.replace(/"/g, '""')}"`).join(' AND ')
    const candidates = decode(
      mutableArray(mutableStruct({ rowid: Schema.Number })),
      this.db
        .prepare('SELECT rowid FROM conversation_search WHERE conversation_search MATCH ? LIMIT ?')
        .all(query, candidateLimit + 1),
    )
    return candidates.length > candidateLimit ? undefined : candidates.map((row) => row.rowid)
  }
  private searchOriginalText(
    orderedTaskIds: readonly string[],
    needle: string,
    limit: number,
    end: number,
  ) {
    const result: TaskSearchResult = { taskIds: [], hits: [] }
    const read = this.db.prepare(
      "SELECT value FROM conversation_items WHERE task_id = ? AND kind = 'message' AND ordinal < ? ORDER BY ordinal DESC",
    )
    for (const taskId of orderedTaskIds) {
      let matched = false
      for (const row of read.iterate(taskId, end)) {
        const stored = decode(mutableStruct({ value: Schema.String }), row)
        const hit = taskSearchHit(taskId, decode(messageSchema, JSON.parse(stored.value)), needle)
        if (!hit) continue
        matched = true
        if (result.hits.length >= limit) break
        result.hits.push(hit)
      }
      if (matched) result.taskIds.push(taskId)
    }
    return result
  }
}
