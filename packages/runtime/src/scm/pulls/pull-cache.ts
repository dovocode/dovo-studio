import { retrievalFresh, retrievalWatching } from '../../retrieval/context.js'
import {
  pullStacks,
  pullOverviewStacks,
  stackSummary,
  type PullDetail,
  type PullSummary,
} from '@dovo/protocol'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { retainUnavailableSections } from './cached-detail.js'
import type Database from 'better-sqlite3'
import { Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  pullPageSchema,
  pullStackSchema,
  pullDetailSchema,
  pullRevision,
  type PullDetailSection,
} from '@dovo/protocol'
import type { PullRequests } from './pulls.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import {
  errorMessage,
  HttpError,
  RuntimeOperationError,
  runtimeOperation,
  runtimeFailure,
  type RuntimeFailure,
} from '../../errors.js'
const rowSchema = mutableStruct({
  value: Schema.String,
  updated: Schema.Number.pipe(Schema.check(Schema.isFinite())),
})
type PullReader = {
  list: (
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    background?: boolean,
  ) => ReturnType<PullRequests['list']>
  nativeStack?: (
    cwd: string,
    number: number,
    stackNumber: number,
  ) => ReturnType<PullRequests['nativeStack']>
  detail: (cwd: string, number: number) => ReturnType<PullRequests['detail']>
  section?: (
    cwd: string,
    number: number,
    section: PullDetailSection,
  ) => ReturnType<PullRequests['detail']>
  status?: (cwd: string, number: number, background?: boolean) => ReturnType<PullRequests['detail']>
  feedback?: (cwd: string, number: number) => ReturnType<PullRequests['detail']>
}
export class PullCache {
  private pending = new Map<string, Fiber.Fiber<unknown, RuntimeFailure>>()
  private executor = ManagedRuntime.make(Layer.empty)
  private invalidated = new Set<string>()
  private failedAt = new Map<string, number>()
  private errors = new Map<string, string>()
  private stopped = false
  private scopes = new Map<string, string>()
  constructor(
    private db: Database.Database,
    private pulls: PullReader & { forDestination?: (destination: string) => PullReader },
    _store: WorkspaceStore,
    private identity?: (cwd: string, refresh: boolean) => Promise<string>,
    private onDetail?: (detail: PullDetail) => void,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS pull_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS pull_cache_aliases (cwd TEXT NOT NULL, scope TEXT NOT NULL, PRIMARY KEY(cwd,scope))',
    )
    if (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pull_cache_scopes'")
        .get()
    )
      db.transaction(() => {
        db.exec(
          'INSERT OR IGNORE INTO pull_cache_aliases(cwd,scope) SELECT cwd,scope FROM pull_cache_scopes; DROP TABLE pull_cache_scopes',
        )
      })()
  }
  private rejectCachedFallback(error: unknown): boolean {
    if (error instanceof RuntimeOperationError) return this.rejectCachedFallback(error.cause)
    const parsed = decodeResult(mutableStruct({ status: Schema.Number }), error)
    return parsed.success && [401, 403, 409].includes(parsed.data.status)
  }
  private validateDestination(result: { destination?: string }, scope: string) {
    if (result.destination !== undefined && result.destination !== scope)
      throw new HttpError(
        409,
        'This integration destination changed during the read. Refresh before continuing.',
      )
  }
  private rememberScope(cwd: string, scope: string) {
    if (this.scopes.get(cwd) === scope) return
    this.scopes.set(cwd, scope)
    this.db
      .prepare('INSERT OR IGNORE INTO pull_cache_aliases(cwd,scope) VALUES(?,?)')
      .run(cwd, scope)
  }
  private readEffect<T extends { cachedAt?: string; stale?: boolean; refreshError?: string }, I>(
    key: string,
    schema: Schema.Codec<T, I>,
    fetch: () => Promise<T>,
    force: boolean,
    reconcile?: (fresh: T, cached?: T) => T,
    ttl = 120_000,
    acceptCached?: (value: T) => boolean,
  ): Effect.Effect<T, RuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
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
        const parsed = yield* Effect.result(
          runtimeOperation(() => decode(schema, JSON.parse(row.value))),
        )
        if (parsed._tag === 'Success') cached = parsed.success
        else
          yield* runtimeOperation(() =>
            this.db.prepare('DELETE FROM pull_cache WHERE key=?').run(key),
          )
      }
      if (cached && acceptCached && !acceptCached(cached)) cached = undefined
      const refresh = Effect.suspend(() => {
        if (this.stopped) return Effect.fail(runtimeFailure(new Error('Pull cache is closed')))
        const existing = this.pending.get(key)
        if (existing)
          return Fiber.join(existing).pipe(
            Effect.flatMap((value) => runtimeOperation(() => decode(schema, value))),
          )
        const worker = Effect.gen({ self: this }, function* () {
          // Register ownership before a synchronous SDK failure can finish this worker.
          yield* Effect.yieldNow
          const fetched = yield* runtimeOperation(() => retrievalFresh(force, fetch))
          return yield* runtimeOperation(() => {
            const updated = Date.now()
            const value = {
              ...(reconcile ? reconcile(fetched, cached) : fetched),
              cachedAt: new Date(updated).toISOString(),
              stale: this.invalidated.has(key),
            }
            this.db
              .prepare('INSERT OR REPLACE INTO pull_cache(key,value,updated) VALUES(?,?,?)')
              .run(key, JSON.stringify(value), updated)
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
      const stale = !!cached?.stale || (!!row && Date.now() - row.updated >= ttl)
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
        Effect.catch((error) =>
          cached && row && !this.rejectCachedFallback(error)
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
  listEffect(
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    force = false,
    background = false,
    expectedScope?: string,
    source?: { identity: () => Promise<string>; reader: PullReader },
  ) {
    return Effect.gen({ self: this }, function* () {
      const identify = source?.identity ?? this.identity
      const scope = identify
        ? yield* runtimeOperation(() =>
            identify(cwd, force && !background && expectedScope === undefined),
          )
        : cwd
      if (expectedScope !== undefined && scope !== expectedScope)
        throw new HttpError(
          409,
          'This integration reader account or destination changed. Refresh before continuing.',
        )
      this.rememberScope(cwd, scope)
      return yield* this.readEffect(
        JSON.stringify(['list', scope, state, page]),
        pullPageSchema,
        async () => {
          const result = await (
            source?.reader ??
            this.pulls.forDestination?.(scope) ??
            this.pulls
          ).list(cwd, state, page, background)
          this.validateDestination(result, scope)
          return result
        },
        force,
      )
    })
  }
  /** Reuse bounded, credential-scoped list caches instead of loading every PR detail. */
  stackCatalogEffect(
    cwd: string,
    force = false,
    seed?: typeof pullPageSchema.Type,
    expectedScope?: string,
  ) {
    return Effect.gen({ self: this }, function* () {
      const pulls: PullSummary[] = []
      let complete = false
      let warning: string | undefined
      for (let page = 1; page <= 10; page++) {
        const result = yield* Effect.result(
          page === 1 && seed?.page === 1
            ? Effect.succeed(seed)
            : this.listEffect(cwd, 'open', page, force, false, expectedScope ?? seed?.destination),
        )
        if (result._tag === 'Failure') {
          warning = errorMessage(result.failure)
          break
        }
        const value = result.success
        pulls.push(...value.pulls)
        if (value.stale || value.refreshError)
          warning = value.refreshError ?? 'Stack information is cached.'
        if (!value.hasMore) {
          complete = !warning
          break
        }
        if (!value.pulls.length) break
      }
      if (!complete && !warning)
        warning = 'Stack information is partial. Only the first 10 pages of open PRs were checked.'
      return { pulls, complete, warning }
    })
  }
  overviewEffect(
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    force = false,
    expectedScope?: string,
    source?: { identity: () => Promise<string>; reader: PullReader },
  ) {
    return Effect.gen({ self: this }, function* () {
      // Decorate only this page; overview reads must not fetch a stack catalog.
      const result = yield* this.listEffect(cwd, state, page, force, false, expectedScope, source)
      const pulls = pullOverviewStacks(
        result.pulls,
        state === 'open' && page === 1 && !result.hasMore && !result.stale && !result.refreshError,
      )
      return {
        ...result,
        pulls,
      }
    })
  }
  stackEffect(
    cwd: string,
    number: number,
    force = false,
    expectedScope?: string,
    nativeNumber?: number,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (nativeNumber) {
        const identify = this.identity
        const scope = identify ? yield* runtimeOperation(() => identify(cwd, false)) : cwd
        if (expectedScope !== undefined && scope !== expectedScope)
          throw new HttpError(
            409,
            'This integration reader account or destination changed. Refresh before continuing.',
          )
        const reader = this.pulls.forDestination?.(scope) ?? this.pulls
        const read = reader.nativeStack
        if (read) {
          const result = yield* Effect.result(
            this.readEffect(
              JSON.stringify(['native-stack', scope, number, nativeNumber]),
              mutableStruct({
                stack: Schema.optional(pullStackSchema),
                cachedAt: Schema.optional(Schema.String),
                stale: Schema.optional(Schema.Boolean),
                refreshError: Schema.optional(Schema.String),
              }),
              async () => ({ stack: await read.call(reader, cwd, number, nativeNumber) }),
              force,
              undefined,
              60_000,
            ),
          )
          if (result._tag === 'Failure') {
            if (this.rejectCachedFallback(result.failure)) return yield* Effect.fail(result.failure)
            return {
              stack: undefined,
              warning: `Native stack unavailable: ${errorMessage(result.failure)}`,
            }
          }
          return {
            stack: result.success.stack,
            warning: result.success.stale
              ? (result.success.refreshError ?? 'Stack information is cached.')
              : undefined,
          }
        }
      }
      const catalog = yield* this.stackCatalogEffect(cwd, force, undefined, expectedScope)
      return {
        stack: pullStacks(catalog.pulls, catalog.complete).get(number),
        warning: catalog.warning,
      }
    })
  }
  stack(cwd: string, number: number, force = false) {
    return runClientEffect(this.stackEffect(cwd, number, force))
  }
  detailWithStackEffect(cwd: string, number: number, force = false, expectedScope?: string) {
    return Effect.gen({ self: this }, function* () {
      const detail = yield* this.detailEffect(cwd, number, force, expectedScope)
      if (detail.pull.state !== 'open')
        return { ...detail, stack: undefined, pull: { ...detail.pull, stack: undefined } }
      const { stack, warning } = yield* this.stackEffect(
        cwd,
        number,
        force,
        expectedScope ?? detail.destination,
        detail.pull.stack?.nativeNumber,
      )
      return {
        ...detail,
        stack,
        pull: {
          ...detail.pull,
          stack: stack ? stackSummary(stack) : warning ? detail.pull.stack : undefined,
        },
        warnings: [...detail.warnings, ...(warning ? [warning] : [])],
      }
    })
  }
  list(
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    force = false,
    background = false,
  ) {
    return runClientEffect(this.listEffect(cwd, state, page, force, background))
  }
  detailEffect(cwd: string, number: number, force = false, expectedScope?: string) {
    return Effect.gen({ self: this }, function* () {
      const identify = this.identity
      const scope = identify
        ? yield* runtimeOperation(() => identify(cwd, force && expectedScope === undefined))
        : cwd
      if (expectedScope !== undefined && scope !== expectedScope)
        throw new HttpError(
          409,
          'This integration reader account or destination changed. Refresh before continuing.',
        )
      this.rememberScope(cwd, scope)
      return yield* this.readEffect(
        JSON.stringify(['detail', scope, number]),
        pullDetailSchema,
        async () => {
          const result = await (this.pulls.forDestination?.(scope) ?? this.pulls).detail(
            cwd,
            number,
          )
          this.validateDestination(result, scope)
          return result
        },
        force,
        (fresh, cached) => {
          const detail = retainUnavailableSections(fresh, cached)
          this.onDetail?.(detail)
          return detail
        },
        300_000,
      )
    })
  }
  sectionEffect(
    cwd: string,
    number: number,
    section: PullDetailSection,
    force = false,
    expectedScope?: string,
    revision?: string,
    source?: { identity: () => Promise<string>; reader: PullReader },
  ): Effect.Effect<PullDetail, RuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      const identify = source?.identity ?? this.identity
      const scope = identify
        ? yield* runtimeOperation(() => identify(cwd, force && expectedScope === undefined))
        : cwd
      if (expectedScope !== undefined && scope !== expectedScope)
        throw new HttpError(
          409,
          'This integration reader account or destination changed. Refresh before continuing.',
        )
      this.rememberScope(cwd, scope)
      return yield* this.readEffect(
        JSON.stringify(['section', scope, number, section]),
        pullDetailSchema,
        async () => {
          const reader = source?.reader ?? this.pulls.forDestination?.(scope) ?? this.pulls
          if (section === 'stack') {
            const detail = await runClientEffect(
              this.sectionEffect(cwd, number, 'overview', false, scope, revision, source),
            )
            if (detail.pull.state !== 'open') return detail
            const { stack, warning } = await runClientEffect(
              this.stackEffect(cwd, number, force, scope, detail.pull.stack?.nativeNumber),
            )
            return {
              ...detail,
              stack,
              pull: {
                ...detail.pull,
                stack: stack ? stackSummary(stack) : warning ? detail.pull.stack : undefined,
              },
              warnings: warning ? [warning] : [],
            }
          }
          const result = await (reader.section
            ? reader.section(cwd, number, section)
            : reader.detail(cwd, number))
          this.validateDestination(result, scope)
          return result
        },
        force,
        (fresh, cached) => {
          const detail = retainUnavailableSections(fresh, cached)
          if (section === 'changes') this.onDetail?.(detail)
          return detail
        },
        section === 'changes' ? 300_000 : 60_000,
        revision ? (detail) => pullRevision(detail) === revision : undefined,
      )
    })
  }
  detail(cwd: string, number: number, force = false) {
    return runClientEffect(this.detailEffect(cwd, number, force))
  }
  /** Feedback watches share a credential-scoped cache without loading files or annotations. */
  feedback(cwd: string, number: number, force = false, background = false) {
    return runClientEffect(
      Effect.gen({ self: this }, function* () {
        const identify = this.identity
        const scope = identify ? yield* runtimeOperation(() => identify(cwd, false)) : cwd
        this.rememberScope(cwd, scope)
        return yield* this.readEffect(
          JSON.stringify(['feedback', scope, number]),
          pullDetailSchema,
          () =>
            retrievalWatching(async () => {
              const reader = this.pulls.forDestination?.(scope) ?? this.pulls
              const result = await (reader.feedback
                ? reader.feedback(cwd, number)
                : reader.detail(cwd, number))
              this.validateDestination(result, scope)
              return result
            }, background),
          force,
          retainUnavailableSections,
        )
      }),
    )
  }
  status(cwd: string, number: number, force = false, background = false) {
    return runClientEffect(
      Effect.gen({ self: this }, function* () {
        const identify = this.identity
        const scope = identify ? yield* runtimeOperation(() => identify(cwd, false)) : cwd
        this.rememberScope(cwd, scope)
        return yield* this.readEffect(
          JSON.stringify(['status', scope, number]),
          pullDetailSchema,
          async () => {
            const reader = this.pulls.forDestination?.(scope) ?? this.pulls
            const result = await (reader.status
              ? reader.status(cwd, number, background)
              : reader.detail(cwd, number))
            this.validateDestination(result, scope)
            return result
          },
          force,
        )
      }),
    )
  }
  invalidate(cwd: string, number?: number) {
    // Worktree aliases survive a runtime restart, even before this checkout is read again.
    const saved = decode(
      mutableArray(mutableStruct({ scope: Schema.String })),
      this.db.prepare('SELECT scope FROM pull_cache_aliases WHERE cwd=?').all(cwd),
    )
    const scopes = new Set([cwd, ...saved.map((entry) => entry.scope)])
    const matches = (key: string) => {
      try {
        const parsed = decodeResult(
          Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.String, Schema.Unknown]), [
            Schema.Unknown,
          ]),
          JSON.parse(key),
        )
        return (
          parsed.success &&
          scopes.has(parsed.data[1]) &&
          (parsed.data[0] === 'list' ||
            ((parsed.data[0] === 'section' ||
              parsed.data[0] === 'detail' ||
              parsed.data[0] === 'status' ||
              parsed.data[0] === 'feedback' ||
              parsed.data[0] === 'native-stack') &&
              (number === undefined || parsed.data[2] === number)))
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
          Schema.StructWithRest(Schema.Struct(mutableStruct({}).fields), [
            Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
          ]),
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
  disposeEffect() {
    return Effect.gen({ self: this }, function* () {
      this.stopped = true
      yield* Effect.forEach(this.pending.values(), (fiber) => Fiber.await(fiber), { discard: true })
      yield* runtimeOperation(() => this.executor.dispose())
    }).pipe(Effect.uninterruptible)
  }
  dispose() {
    return runClientEffect(this.disposeEffect())
  }
}
