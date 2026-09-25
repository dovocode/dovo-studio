import { mutableStruct, decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { errorMessage, runtimeOperation, type RuntimeFailure } from '../../errors.js'

const rowSchema = mutableStruct({
  value: Schema.String,
  updated: Schema.Number.pipe(Schema.finite()),
})

type CacheResult = {
  cachedAt?: string
  stale?: boolean
  refreshError?: string
}

export class ForgeWorkCache {
  private versions = new Map<string, number>()

  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS forge_work_cache (key TEXT PRIMARY KEY, source TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL)',
    )
  }

  invalidateEffect(source: string): Effect.Effect<void, RuntimeFailure> {
    return runtimeOperation(() => {
      this.versions.set(source, (this.versions.get(source) ?? 0) + 1)
      this.db.prepare('DELETE FROM forge_work_cache WHERE source=?').run(source)
    })
  }

  invalidate(source: string): Promise<void> {
    return runClientEffect(this.invalidateEffect(source))
  }

  readEffect<T extends CacheResult, I>(options: {
    key: string
    source: string
    schema: Schema.Schema<T, I>
    refresh: boolean
    load: () => Promise<T>
    validateSource: () => void
  }): Effect.Effect<
    T & { cachedAt: string; stale?: boolean; refreshError?: string },
    RuntimeFailure
  > {
    return Effect.gen(this, function* () {
      const { key, source, schema, refresh, load, validateSource } = options
      const row = yield* runtimeOperation(() =>
        decode(
          Schema.UndefinedOr(rowSchema),
          this.db.prepare('SELECT value,updated FROM forge_work_cache WHERE key=?').get(key),
        ),
      )
      let cached: T | undefined
      if (row) {
        const parsed = yield* Effect.either(
          runtimeOperation(() => decode(schema, JSON.parse(row.value))),
        )
        if (parsed._tag === 'Right') cached = parsed.right
        else
          yield* runtimeOperation(() =>
            this.db.prepare('DELETE FROM forge_work_cache WHERE key=?').run(key),
          )
      }

      yield* runtimeOperation(validateSource)
      if (row && cached && !refresh && Date.now() - row.updated < 30_000)
        return {
          ...cached,
          cachedAt: new Date(row.updated).toISOString(),
        }

      const version = this.versions.get(source) ?? 0
      const refreshed = yield* Effect.either(
        runtimeOperation(load).pipe(
          Effect.flatMap((value) => runtimeOperation(() => decode(schema, value))),
          Effect.flatMap((value) =>
            runtimeOperation(() => {
              validateSource()
              const updated = Date.now()
              if (version === (this.versions.get(source) ?? 0)) {
                this.db
                  .prepare(
                    'INSERT OR REPLACE INTO forge_work_cache(key,source,value,updated) VALUES(?,?,?,?)',
                  )
                  .run(key, source, JSON.stringify(value), updated)
                this.db
                  .prepare(
                    'DELETE FROM forge_work_cache WHERE key IN (SELECT key FROM forge_work_cache ORDER BY updated DESC LIMIT -1 OFFSET 500)',
                  )
                  .run()
              }
              return {
                ...value,
                cachedAt: new Date(updated).toISOString(),
                stale: version !== (this.versions.get(source) ?? 0),
              }
            }),
          ),
        ),
      )
      if (refreshed._tag === 'Right') return refreshed.right

      yield* runtimeOperation(validateSource)
      if (cached && row)
        return {
          ...cached,
          cachedAt: new Date(row.updated).toISOString(),
          stale: true,
          refreshError: errorMessage(refreshed.left),
        }
      return yield* Effect.fail(refreshed.left)
    })
  }
}
