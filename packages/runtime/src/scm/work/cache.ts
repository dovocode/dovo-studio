import { mutableStruct, decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { errorMessage, runtimeOperation, type RuntimeFailure } from '../../errors.js'

const rowSchema = mutableStruct({
  value: Schema.String,
  updated: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})

type CacheResult = {
  cachedAt?: string
  stale?: boolean
  refreshError?: string
}
type Loaded<T> = T & { cachedAt: string; stale?: boolean; refreshError?: string }

/** Fresh entries are served as is. Entries older than the fresh window are served at once and
 * refreshed behind the response, so several clients polling one source share one load. */
const FRESH_TTL = 30_000
const STALE_TTL = 300_000

export class ForgeWorkCache {
  private versions = new Map<string, number>()
  private loads = new Map<string, { promise: Promise<unknown>; interest: number; keep: boolean }>()

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

  private read<T extends CacheResult, I>(key: string, schema: Schema.Codec<T, I>) {
    const row = decode(
      Schema.UndefinedOr(rowSchema),
      this.db.prepare('SELECT value,updated FROM forge_work_cache WHERE key=?').get(key),
    )
    if (!row) return undefined
    try {
      return { updated: row.updated, value: decode(schema, JSON.parse(row.value)) }
    } catch {
      this.db.prepare('DELETE FROM forge_work_cache WHERE key=?').run(key)
      return undefined
    }
  }

  /** The stored entry without loading, for callers that decide how much to fetch. */
  peek<T extends CacheResult, I>(key: string, schema: Schema.Codec<T, I>) {
    return this.read(key, schema)
  }

  /** One in-flight load per key. A result is persisted while a caller still waits for it or
   * a background refresh asked for it; an interrupted foreground read leaves nothing behind.
   * Late results stay out of an invalidated source. */
  private start<T extends CacheResult, I>(
    options: {
      key: string
      source: string
      schema: Schema.Codec<T, I>
      load: () => Promise<T>
      validateSource: () => void
    },
    background: boolean,
  ) {
    const { key, source, schema, validateSource } = options
    let entry = this.loads.get(key) as
      | { promise: Promise<Loaded<T>>; interest: number; keep: boolean }
      | undefined
    if (!entry) {
      const version = this.versions.get(source) ?? 0
      const created = { interest: 0, keep: false } as {
        promise: Promise<Loaded<T>>
        interest: number
        keep: boolean
      }
      created.promise = (async () => {
        const value = decode(schema, await options.load())
        validateSource()
        const updated = Date.now()
        const current = version === (this.versions.get(source) ?? 0)
        if (current && (created.interest > 0 || created.keep)) {
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
        return { ...value, cachedAt: new Date(updated).toISOString(), stale: !current }
      })().finally(() => {
        if (this.loads.get(key) === created) this.loads.delete(key)
      })
      entry = created
      this.loads.set(key, created)
    }
    if (background) entry.keep = true
    else entry.interest++
    return entry
  }

  readEffect<T extends CacheResult, I>(options: {
    key: string
    source: string
    schema: Schema.Codec<T, I>
    refresh: boolean
    load: () => Promise<T>
    validateSource: () => void
  }): Effect.Effect<Loaded<T>, RuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      const { key, schema, refresh, validateSource } = options
      const cached = yield* runtimeOperation(() => this.read(key, schema))
      yield* runtimeOperation(validateSource)
      const age = cached ? Date.now() - cached.updated : Infinity
      if (cached && !refresh && age < FRESH_TTL)
        return { ...cached.value, cachedAt: new Date(cached.updated).toISOString() }
      if (cached && !refresh && age < STALE_TTL) {
        // Serve what is known and refresh behind it; the next read sees the result.
        void this.start(options, true).promise.catch(() => undefined)
        return {
          ...cached.value,
          cachedAt: new Date(cached.updated).toISOString(),
          stale: true,
        }
      }
      const entry = this.start(options, false)
      const refreshed = yield* Effect.result(runtimeOperation(() => entry.promise)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.interest--
          }),
        ),
      )
      if (refreshed._tag === 'Success') return refreshed.success

      yield* runtimeOperation(validateSource)
      if (cached)
        return {
          ...cached.value,
          cachedAt: new Date(cached.updated).toISOString(),
          stale: true,
          refreshError: errorMessage(refreshed.failure),
        }
      return yield* Effect.fail(refreshed.failure)
    })
  }
}
