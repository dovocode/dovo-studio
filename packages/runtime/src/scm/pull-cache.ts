import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { retainUnavailableSections } from './cached-detail.js'
import type Database from 'better-sqlite3'
import { Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { pullPageSchema, pullDetailSchema } from '@dovo/protocol'
import type { PullRequests } from './pulls.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import { errorMessage, runtimeOperation, runtimeFailure, type RuntimeFailure } from '../errors.js'
const rowSchema = mutableStruct({
  value: Schema.String,
  updated: Schema.Number.pipe(Schema.finite()),
})
export class PullCache {
  private pending = new Map<string, Fiber.RuntimeFiber<unknown, RuntimeFailure>>()
  private executor = ManagedRuntime.make(Layer.empty)
  private invalidated = new Set<string>()
  private failedAt = new Map<string, number>()
  private errors = new Map<string, string>()
  private scheduler?: ReturnType<typeof startPolling>
  private stopped = false
  constructor(
    private db: Database.Database,
    private pulls: Pick<PullRequests, 'list' | 'detail'>,
    private store: WorkspaceStore,
    private identity?: (cwd: string, refresh: boolean) => Promise<string>,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS pull_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)',
    )
  }
  private readEffect<T extends { cachedAt?: string; stale?: boolean; refreshError?: string }, I>(
    key: string,
    schema: Schema.Schema<T, I>,
    fetch: () => Promise<T>,
    force: boolean,
    reconcile?: (fresh: T, cached?: T) => T,
  ): Effect.Effect<T, RuntimeFailure> {
    return Effect.gen(this, function* () {
      if (this.stopped && force)
        return yield* Effect.fail(runtimeFailure(new Error('Pull cache is closed')))
      const row = yield* runtimeOperation(() =>
        decode(
          Schema.UndefinedOr(rowSchema),
          this.db.prepare('SELECT value,updated FROM pull_cache WHERE key=?').get(key),
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
            this.db.prepare('DELETE FROM pull_cache WHERE key=?').run(key),
          )
      }
      const refresh = Effect.suspend(() => {
        if (this.stopped) return Effect.fail(runtimeFailure(new Error('Pull cache is closed')))
        const existing = this.pending.get(key)
        if (existing)
          return Fiber.join(existing).pipe(
            Effect.flatMap((value) => runtimeOperation(() => decode(schema, value))),
          )
        const worker = Effect.gen(this, function* () {
          // Register ownership before a synchronous SDK failure can finish this worker.
          yield* Effect.yieldNow()
          const fetched = yield* runtimeOperation(fetch)
          return yield* runtimeOperation(() => {
            const value = {
              ...(reconcile ? reconcile(fetched, cached) : fetched),
              cachedAt: new Date().toISOString(),
              stale: this.invalidated.has(key),
            }
            this.db
              .prepare('INSERT OR REPLACE INTO pull_cache(key,value,updated) VALUES(?,?,?)')
              .run(key, JSON.stringify(value), Date.now())
            this.db
              .prepare(
                'DELETE FROM pull_cache WHERE key IN (SELECT key FROM pull_cache ORDER BY updated DESC LIMIT -1 OFFSET 500)',
              )
              .run()
            this.errors.delete(key)
            this.failedAt.delete(key)
            return value
          })
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              this.errors.set(key, errorMessage(error))
              this.failedAt.set(key, Date.now())
              if (this.errors.size > 500) {
                const oldest = this.errors.keys().next().value
                if (oldest) {
                  this.errors.delete(oldest)
                  this.failedAt.delete(oldest)
                }
              }
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              this.pending.delete(key)
              this.invalidated.delete(key)
            }),
          ),
          Effect.uninterruptible,
        )
        const fiber = this.executor.runFork(worker)
        this.pending.set(key, fiber)
        return Fiber.join(fiber)
      })
      const stale = !!cached?.stale || (!!row && Date.now() - row.updated >= 60000)
      if (cached && row && !force) {
        if (!this.stopped && stale && Date.now() - (this.failedAt.get(key) ?? 0) >= 60000)
          this.executor.runFork(refresh.pipe(Effect.ignore)) // Failure is retained for the next cached response.
        return {
          ...cached,
          cachedAt: new Date(row.updated).toISOString(),
          stale,
          refreshError: this.errors.get(key),
        }
      }
      const failedAt = this.failedAt.get(key)
      if (!cached && !force && failedAt !== undefined && Date.now() - failedAt < 60000)
        return yield* Effect.fail(
          runtimeFailure(new Error(this.errors.get(key) ?? 'PR refresh temporarily unavailable')),
        )
      return yield* refresh.pipe(
        Effect.catchAll((error) =>
          cached && row
            ? Effect.succeed({
                ...cached,
                cachedAt: new Date(row.updated).toISOString(),
                stale: true,
                refreshError: errorMessage(error),
              })
            : Effect.fail(error),
        ),
      )
    })
  }
  listEffect(cwd: string, state: 'open' | 'closed' | 'all', page: number, force = false) {
    return Effect.gen(this, function* () {
      const identify = this.identity
      const identity = identify ? [yield* runtimeOperation(() => identify(cwd, force))] : []
      return yield* this.readEffect(
        JSON.stringify(['list', cwd, state, page, ...identity]),
        pullPageSchema,
        () => this.pulls.list(cwd, state, page),
        force,
      )
    })
  }
  list(cwd: string, state: 'open' | 'closed' | 'all', page: number, force = false) {
    return runClientEffect(this.listEffect(cwd, state, page, force))
  }
  detailEffect(cwd: string, number: number, force = false) {
    return Effect.gen(this, function* () {
      const identify = this.identity
      const identity = identify ? [yield* runtimeOperation(() => identify(cwd, force))] : []
      return yield* this.readEffect(
        JSON.stringify(['detail', cwd, number, ...identity]),
        pullDetailSchema,
        () => this.pulls.detail(cwd, number),
        force,
        retainUnavailableSections,
      )
    })
  }
  detail(cwd: string, number: number, force = false) {
    return runClientEffect(this.detailEffect(cwd, number, force))
  }
  invalidate(cwd: string, number?: number) {
    const matches = (key: string) => {
      try {
        const parsed = decodeResult(
          Schema.Tuple([Schema.String, Schema.String, Schema.Unknown], Schema.Unknown),
          JSON.parse(key),
        )
        return (
          parsed.success &&
          parsed.data[1] === cwd &&
          (parsed.data[0] === 'list' ||
            (parsed.data[0] === 'detail' && (number === undefined || parsed.data[2] === number)))
        )
      } catch {
        return false // Ignore corrupt cache keys; they are not workspace records.
      }
    }
    const rows = decode(
      mutableArray(
        mutableStruct({
          key: Schema.String,
          value: Schema.String,
        }),
      ),
      this.db.prepare('SELECT key,value FROM pull_cache').all(),
    )
    for (const row of rows) {
      if (!matches(row.key)) continue
      try {
        const value = decode(
          Schema.Struct(mutableStruct({}).fields, {
            key: Schema.String,
            value: Schema.Unknown,
          }),
          JSON.parse(row.value),
        )
        this.db.prepare('UPDATE pull_cache SET value=? WHERE key=?').run(
          JSON.stringify({
            ...value,
            stale: true,
          }),
          row.key,
        )
      } catch {
        this.db.prepare('DELETE FROM pull_cache WHERE key=?').run(row.key)
      }
      this.errors.delete(row.key)
      this.failedAt.delete(row.key)
    }
    for (const key of this.pending.keys()) if (matches(key)) this.invalidated.add(key)
  }
  start() {
    if (this.scheduler || this.stopped) return
    const tick = Effect.gen(this, function* () {
      const repos = yield* runtimeOperation(() => this.store.get().repositories)
      yield* Effect.forEach(
        repos,
        (repository) =>
          Effect.gen(this, function* () {
            yield* this.listEffect(repository.path, 'open', 1).pipe(Effect.either)
            // Include stale-cache refreshes before admitting another repository.
            const pending = [...this.pending].filter(([key]) => {
              try {
                return JSON.parse(key)[1] === repository.path
              } catch {
                return false
              }
            })
            yield* Effect.forEach(pending, ([, fiber]) => Fiber.await(fiber), { discard: true })
          }),
        { concurrency: 3, discard: true },
      )
    })
    this.scheduler = startPolling(tick, {
      interval: 60000,
      immediate: false,
      onError: (error) => console.error('Pull cache refresh failed', error),
    })
  }
  disposeEffect() {
    return Effect.gen(this, function* () {
      this.stopped = true
      const scheduler = this.scheduler
      if (scheduler) yield* runtimeOperation(() => scheduler.stop())
      this.scheduler = undefined
      yield* Effect.forEach(this.pending.values(), (fiber) => Fiber.await(fiber), { discard: true })
      yield* runtimeOperation(() => this.executor.dispose())
    }).pipe(Effect.uninterruptible)
  }
  dispose() {
    return runClientEffect(this.disposeEffect())
  }
}
