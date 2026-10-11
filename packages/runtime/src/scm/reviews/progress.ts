import type Database from 'better-sqlite3'
import { decode, mutableArray, mutableStruct, type ReviewProgress } from '@dovo/protocol'
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
export class ReviewMarks {
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS review_marks (scope TEXT NOT NULL, path TEXT NOT NULL, fingerprint TEXT NOT NULL, viewed INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(scope,path)); CREATE TABLE IF NOT EXISTS review_scopes (scope TEXT PRIMARY KEY); INSERT OR IGNORE INTO review_scopes SELECT DISTINCT scope FROM review_marks',
    )
  }
  hasScope(scope: string) {
    return !!this.db.prepare('SELECT scope FROM review_scopes WHERE scope=?').get(scope)
  }
  reconcile(scope: string, files: { path: string; fingerprint: string }[]) {
    return this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO review_scopes(scope) VALUES(?)').run(scope)
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
