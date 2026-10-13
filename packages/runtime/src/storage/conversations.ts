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
  taskSearchText,
  type ConversationPage,
  type Task,
  type TaskSearchResult,
  type Workspace,
} from '@dovo/protocol'
const storedValuesSchema = mutableArray(Schema.String)
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
const indexVersion = '2'
const candidateLimit = 1000
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
  WHEN NEW.kind = 'message' BEGIN
    INSERT INTO conversation_search(conversation_search, rowid, search_text)
    VALUES ('delete', OLD.rowid, OLD.search_text);
    INSERT INTO conversation_search(rowid, search_text) VALUES (NEW.rowid, NEW.search_text);
  END;`

/** History is authoritative in SQLite; workspace metadata never rewrites old messages.
 * `conversation_index` is derived from `conversation_items` in the same transactions: it keeps
 * ordering, turn ownership and lowercased message text out of the large JSON rows so paging and
 * search read only the records they return. */
export class Conversations {
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
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
        search_text, content='conversation_index', content_rowid='rowid',
        tokenize='trigram case_sensitive 1', detail='none');`)
    this.ensureIndex(!hadSearch)
    db.exec(searchTriggers)
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
  hydrate(
    workspace: Workspace,
    counts: Record<string, { messages: number; turns: number }>,
  ): Workspace {
    const messageRows = this.db
      .prepare(
        "SELECT value FROM conversation_items WHERE task_id = ? AND kind = 'message' ORDER BY ordinal",
      )
      .pluck()
    const turnRows = this.db
      .prepare(
        "SELECT value FROM conversation_items WHERE task_id = ? AND kind = 'turn' ORDER BY ordinal",
      )
      .pluck()
    return {
      ...workspace,
      tasks: workspace.tasks.map((task) => {
        const expected = counts[task.id]
        const messages = decode(storedValuesSchema, messageRows.all(task.id))
        const turns = decode(storedValuesSchema, turnRows.all(task.id))
        if (!expected || messages.length !== expected.messages || turns.length !== expected.turns)
          throw new Error(
            `History for ${task.id} is incomplete. Restore the runtime database from a backup before continuing.`,
          )
        return {
          ...task,
          messages: messages.map((value) => decode(messageSchema, JSON.parse(value))),
          ...(task.turns !== undefined
            ? { turns: turns.map((value) => decode(turnSchema, JSON.parse(value))) }
            : {}),
        }
      }),
    }
  }
  record(tasks: readonly Task[], previous: ReadonlyMap<string, Task>, seed: boolean) {
    if (seed) {
      this.db.prepare('DELETE FROM conversation_items').run()
      this.db.prepare('DELETE FROM conversation_index').run()
    }
    const write = this.db.prepare(`INSERT INTO conversation_items VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, kind, item_id) DO UPDATE SET ordinal = excluded.ordinal, value = excluded.value`)
    const index = this.indexStatement()
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
            index.run(
              task.id,
              kind,
              item.id,
              position,
              kind === 'turn' && 'assistantId' in item ? item.assistantId : null,
              kind === 'message' && 'text' in item ? taskSearchText(item.text) : null,
            )
          }
        })
        for (const id of previousItems.keys())
          if (!retained.has(id)) {
            remove.run(task.id, kind, id)
            unindex.run(task.id, kind, id)
          }
      }
    }
    const retained = new Set(tasks.map((task) => task.id))
    for (const id of previous.keys())
      if (!retained.has(id)) {
        this.db.prepare('DELETE FROM conversation_items WHERE task_id = ?').run(id)
        this.db.prepare('DELETE FROM conversation_index WHERE task_id = ?').run(id)
      }
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
  search(orderedTaskIds: readonly string[], needle: string, limit = 50): TaskSearchResult {
    if (!needle) return { taskIds: [], hits: [] }
    // SQLite encodes strings as UTF-8. For malformed UTF-16, replacement characters, and
    // NULs, match original JSON text in JS to preserve the protocol's exact semantics.
    if (/[\ud800-\udfff]/u.test(needle) || needle.includes('\ufffd') || needle.includes('\0'))
      return this.searchOriginalText(orderedTaskIds, needle, limit)
    const candidates = this.searchCandidates(needle)
    const candidateJson = candidates === undefined ? undefined : JSON.stringify(candidates)
    const matching = new Set(
      decode(
        mutableArray(mutableStruct({ task_id: Schema.String })),
        this.db
          .prepare(
            candidateJson === undefined
              ? "SELECT DISTINCT task_id FROM conversation_index WHERE kind = 'message' AND instr(search_text, ?) > 0"
              : `SELECT DISTINCT task_id FROM conversation_index WHERE rowid IN (SELECT value FROM json_each(?))
                  AND kind = 'message' AND instr(search_text, ?) > 0`,
          )
          .all(...(candidateJson === undefined ? [needle] : [candidateJson, needle])),
      ).map((row) => row.task_id),
    )
    const read = this.db.prepare(`SELECT item.value FROM conversation_index AS entry
      JOIN conversation_items AS item USING (task_id, kind, item_id)
      WHERE ${candidateJson === undefined ? '' : 'entry.rowid IN (SELECT value FROM json_each(?)) AND'}
        entry.task_id = ? AND entry.kind = 'message' AND instr(entry.search_text, ?) > 0
      ORDER BY entry.ordinal DESC LIMIT ?`)
    const result: TaskSearchResult = { taskIds: [], hits: [] }
    for (const taskId of orderedTaskIds) {
      if (!matching.has(taskId)) continue
      result.taskIds.push(taskId)
      if (result.hits.length >= limit) continue
      for (const row of decode(
        valuesSchema,
        read.all(
          ...(candidateJson === undefined ? [] : [candidateJson]),
          taskId,
          needle,
          limit - result.hits.length,
        ),
      )) {
        const hit = taskSearchHit(taskId, decode(messageSchema, JSON.parse(row.value)), needle)
        if (hit) result.hits.push(hit)
      }
    }
    return result
  }
  /** Trigrams narrow rare substring searches. Common and short terms use a direct scan,
   * avoiding huge candidate lists while still returning every matching task ID. */
  private searchCandidates(needle: string): number[] | undefined {
    const characters = Array.from(needle)
    if (characters.length < 3) return undefined
    const grams = new Set<string>()
    for (let index = 0; index + 2 < characters.length && grams.size < 8; index++)
      grams.add(characters.slice(index, index + 3).join(''))
    const query = [...grams].map((gram) => `"${gram.replace(/"/g, '""')}"`).join(' AND ')
    const candidates = decode(
      mutableArray(mutableStruct({ rowid: Schema.Number })),
      this.db
        .prepare('SELECT rowid FROM conversation_search WHERE conversation_search MATCH ? LIMIT ?')
        .all(query, candidateLimit + 1),
    )
    return candidates.length > candidateLimit ? undefined : candidates.map((row) => row.rowid)
  }
  private searchOriginalText(orderedTaskIds: readonly string[], needle: string, limit: number) {
    const result: TaskSearchResult = { taskIds: [], hits: [] }
    const read = this.db.prepare(
      "SELECT value FROM conversation_items WHERE task_id = ? AND kind = 'message' ORDER BY ordinal DESC",
    )
    for (const taskId of orderedTaskIds) {
      let matched = false
      for (const row of read.iterate(taskId)) {
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
