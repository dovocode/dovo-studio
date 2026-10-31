import type Database from 'better-sqlite3'
import {
  decode,
  mutableArray,
  mutableStruct,
  reviewGuideSchema,
  type ReviewGuide,
  type ReviewProgress,
  type reviewGuideMoveSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../../errors.js'

const rowsSchema = mutableArray(
  mutableStruct({
    path: Schema.String,
    fingerprint: Schema.String,
    viewed: Schema.Number,
    version: Schema.Number,
  }),
)
const PULL_GUIDE_LIMIT = 500
const PULL_REVISION_LIMIT = 500
export class ReviewMarks {
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS review_marks (scope TEXT NOT NULL, path TEXT NOT NULL, fingerprint TEXT NOT NULL, viewed INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(scope,path)); CREATE TABLE IF NOT EXISTS review_scopes (scope TEXT PRIMARY KEY); INSERT OR IGNORE INTO review_scopes SELECT DISTINCT scope FROM review_marks',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS review_revisions (scope TEXT PRIMARY KEY, revision TEXT NOT NULL, updated INTEGER NOT NULL DEFAULT 0)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS review_guides (scope TEXT PRIMARY KEY, task_id TEXT, id TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL, generated_at TEXT)',
    )
    const columns = (table: string) =>
      decode(
        mutableArray(mutableStruct({ name: Schema.String })),
        db.prepare(`PRAGMA table_info(${table})`).all(),
      ).map((column) => column.name)
    if (!columns('review_revisions').includes('updated'))
      db.exec('ALTER TABLE review_revisions ADD COLUMN updated INTEGER NOT NULL DEFAULT 0')
    if (!columns('review_guides').includes('generated_at')) {
      db.exec('ALTER TABLE review_guides ADD COLUMN generated_at TEXT')
      db.exec("UPDATE review_guides SET generated_at=json_extract(value,'$.generatedAt')")
    }
  }
  guide(scope: string, revision: string): ReviewGuide | undefined {
    const row = this.db.prepare('SELECT value FROM review_guides WHERE scope=?').get(scope)
    if (!row) return
    const value = decode(mutableStruct({ value: Schema.String }), row)
    const guide = decode(reviewGuideSchema, JSON.parse(value.value))
    return guide.revision === revision ? guide : undefined
  }
  /** Task guides live until their task is deleted. PR guides keep only the newest generations. */
  saveGuide(scope: string, taskId: string | null, guide: ReviewGuide) {
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO review_guides (scope,task_id,id,version,value,generated_at) VALUES (?,?,?,?,?,?)',
        )
        .run(scope, taskId, guide.id, guide.version, JSON.stringify(guide), guide.generatedAt)
      if (taskId === null)
        this.db
          .prepare(
            `DELETE FROM review_guides WHERE task_id IS NULL AND scope NOT IN (
              SELECT scope FROM review_guides WHERE task_id IS NULL
              ORDER BY generated_at DESC, rowid DESC LIMIT ${PULL_GUIDE_LIMIT})`,
          )
          .run()
    })()
  }
  moveGuide(scope: string, revision: string, move: typeof reviewGuideMoveSchema.Type) {
    const guide = this.guide(scope, revision)
    if (!guide || guide.id !== move.id || guide.version !== move.version)
      throw new HttpError(409, 'This guide changed. Refresh before continuing the review.')
    if (
      move.position >= guide.steps.length ||
      (move.reviewed !== undefined && move.reviewed >= guide.steps.length)
    )
      throw new HttpError(400, 'Choose a step in this guide.')
    const seen = [
      ...new Set([...guide.seen, ...(move.reviewed === undefined ? [] : [move.reviewed])]),
    ].sort((a, b) => a - b)
    const next = { ...guide, position: move.position, seen, version: guide.version + 1 }
    const result = this.db
      .prepare('UPDATE review_guides SET version=?,value=? WHERE scope=? AND id=? AND version=?')
      .run(next.version, JSON.stringify(next), scope, guide.id, guide.version)
    if (!result.changes)
      throw new HttpError(409, 'This guide changed on another client. Refresh before continuing.')
    return next
  }
  pruneGuides() {
    this.db
      .prepare(`DELETE FROM review_guides WHERE task_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM documents WHERE id='workspace-deleted:tasks:' || review_guides.task_id)
      AND NOT EXISTS (SELECT 1 FROM workspace_tasks WHERE task_id=review_guides.task_id)`)
      .run()
  }
  revision(scope: string): string | undefined {
    const row = this.db.prepare('SELECT revision FROM review_revisions WHERE scope=?').get(scope)
    return row ? decode(mutableStruct({ revision: Schema.String }), row).revision : undefined
  }
  hasScope(scope: string) {
    return !!this.db.prepare('SELECT scope FROM review_scopes WHERE scope=?').get(scope)
  }
  reconcile(scope: string, files: { path: string; fingerprint: string }[], revision?: string) {
    return this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO review_scopes(scope) VALUES(?)').run(scope)
      if (revision !== undefined) {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO review_revisions (scope,revision,updated) VALUES (?,?,?)',
          )
          .run(scope, revision, Date.now())
        // Bounded like the PR cache. A dropped row costs one throttled fresh fetch before the
        // scope's guide can be used again.
        this.db
          .prepare(
            `DELETE FROM review_revisions WHERE scope NOT IN (
              SELECT scope FROM review_revisions ORDER BY updated DESC, rowid DESC LIMIT ${PULL_REVISION_LIMIT})`,
          )
          .run()
      }
      const rows = decode(
        rowsSchema,
        this.db
          .prepare('SELECT path,fingerprint,viewed,version FROM review_marks WHERE scope=?')
          .all(scope),
      )
      const prior = new Map(rows.map((row) => [row.path, row]))
      const paths = new Set(files.map((file) => file.path))
      for (const row of rows)
        if (!paths.has(row.path))
          this.db
            .prepare(
              "UPDATE review_marks SET fingerprint='',viewed=0,version=version+1 WHERE scope=? AND path=? AND fingerprint<>''",
            )
            .run(scope, row.path)
      return files.map((file) => {
        const row = prior.get(file.path)
        const changed = row?.fingerprint !== file.fingerprint
        const version = (row?.version ?? 0) + (changed ? 1 : 0)
        const viewed = !changed && row?.viewed === 1
        if (changed)
          this.db
            .prepare(
              'INSERT OR REPLACE INTO review_marks(scope,path,fingerprint,viewed,version) VALUES(?,?,?,?,?)',
            )
            .run(scope, file.path, file.fingerprint, 0, version)
        return { ...file, viewed, version }
      })
    })()
  }
  set(
    scope: string,
    input: { path: string; fingerprint: string; viewed: boolean; version: number },
  ) {
    const result = this.db
      .prepare(
        'UPDATE review_marks SET viewed=?,version=version+1 WHERE scope=? AND path=? AND fingerprint=? AND version=?',
      )
      .run(Number(input.viewed), scope, input.path, input.fingerprint, input.version)
    if (!result.changes)
      throw new HttpError(
        409,
        'This file or its viewed flag changed. Refresh before marking it again.',
      )
  }
  files(scope: string): ReviewProgress['files'] {
    return decode(
      rowsSchema,
      this.db
        .prepare(
          "SELECT path,fingerprint,viewed,version FROM review_marks WHERE scope=? AND fingerprint<>'' ORDER BY path",
        )
        .all(scope),
    ).map((row) => ({ ...row, viewed: row.viewed === 1 }))
  }
}
