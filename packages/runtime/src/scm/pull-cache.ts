import { retainUnavailableSections } from './cached-detail.js'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { pullPageSchema, pullDetailSchema } from '@dovo/protocol'
import type { PullRequests } from './pulls.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import { errorMessage } from '../errors.js'
const rowSchema = z.object({ value: z.string(), updated: z.number() })
export class PullCache {
  private pending = new Map<string, Promise<unknown>>()
  private invalidated = new Set<string>()
  private failedAt = new Map<string, number>()
  private errors = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private watching: Promise<void> | undefined
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
  private async read<T extends { cachedAt?: string; stale?: boolean; refreshError?: string }>(
    key: string,
    schema: z.ZodType<T>,
    fetch: () => Promise<T>,
    force: boolean,
    reconcile?: (fresh: T, cached?: T) => T,
  ): Promise<T> {
    const row = rowSchema
      .optional()
      .parse(this.db.prepare('SELECT value,updated FROM pull_cache WHERE key=?').get(key))
    let cached: T | undefined
    if (row) {
      try {
        cached = schema.parse(JSON.parse(row.value))
      } catch {
        this.db.prepare('DELETE FROM pull_cache WHERE key=?').run(key)
      }
    }
    const refresh = () => {
      const existing = this.pending.get(key)
      if (existing) return existing.then((value) => schema.parse(value))
      const promise = fetch()
        .then((fetched) => {
          const value = {
            ...(reconcile ? reconcile(fetched, cached) : fetched),
            cachedAt: new Date().toISOString(),
            // A comment may have been posted while this older request was in flight.
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
        .catch((error) => {
          this.errors.set(key, errorMessage(error))
          this.failedAt.set(key, Date.now())
          if (this.errors.size > 500) {
            const oldest = this.errors.keys().next().value
            if (oldest) {
              this.errors.delete(oldest)
              this.failedAt.delete(oldest)
            }
          }
          throw error
        })
        .finally(() => {
          this.pending.delete(key)
          this.invalidated.delete(key)
        })
      this.pending.set(key, promise)
      return promise
    }
    const stale = !!cached?.stale || (!!row && Date.now() - row.updated >= 60000)
    if (cached && row && !force) {
      if (stale && Date.now() - (this.failedAt.get(key) ?? 0) >= 60000)
        void refresh().catch(() => {
          /* Error retained for the next cached response. */
        })
      return {
        ...cached,
        cachedAt: new Date(row.updated).toISOString(),
        stale,
        refreshError: this.errors.get(key),
      }
    }
    const failedAt = this.failedAt.get(key)
    if (!cached && !force && failedAt !== undefined && Date.now() - failedAt < 60000)
      throw new Error(this.errors.get(key) ?? 'PR refresh temporarily unavailable')
    try {
      return await refresh()
    } catch (error) {
      if (cached && row)
        return {
          ...cached,
          cachedAt: new Date(row.updated).toISOString(),
          stale: true,
          refreshError: errorMessage(error),
        }
      throw error
    }
  }
  async list(cwd: string, state: 'open' | 'closed' | 'all', page: number, force = false) {
    const identity = this.identity ? [await this.identity(cwd, force)] : []
    return this.read(
      JSON.stringify(['list', cwd, state, page, ...identity]),
      pullPageSchema,
      () => this.pulls.list(cwd, state, page),
      force,
    )
  }
  async detail(cwd: string, number: number, force = false) {
    const identity = this.identity ? [await this.identity(cwd, force)] : []
    return this.read(
      JSON.stringify(['detail', cwd, number, ...identity]),
      pullDetailSchema,
      () => this.pulls.detail(cwd, number),
      force,
      retainUnavailableSections,
    )
  }
  invalidate(cwd: string, number?: number) {
    const matches = (key: string) => {
      try {
        const parsed = z
          .tuple([z.string(), z.string(), z.unknown()])
          .rest(z.unknown())
          .safeParse(JSON.parse(key))
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
    const rows = z
      .array(z.object({ key: z.string(), value: z.string() }))
      .parse(this.db.prepare('SELECT key,value FROM pull_cache').all())
    for (const row of rows) {
      if (!matches(row.key)) continue
      try {
        const value = z.object({}).passthrough().parse(JSON.parse(row.value))
        this.db
          .prepare('UPDATE pull_cache SET value=? WHERE key=?')
          .run(JSON.stringify({ ...value, stale: true }), row.key)
      } catch {
        this.db.prepare('DELETE FROM pull_cache WHERE key=?').run(row.key)
      }
      this.errors.delete(row.key)
      this.failedAt.delete(row.key)
    }
    for (const key of this.pending.keys()) if (matches(key)) this.invalidated.add(key)
  }
  start() {
    const tick = async () => {
      const repos = this.store.get().repositories
      for (let i = 0; i < repos.length && !this.stopped; i += 3)
        await Promise.allSettled(
          repos.slice(i, i + 3).map(async (r) => {
            await this.list(r.path, 'open', 1)
            // Respect cache freshness and failure backoff, while bounding upstream concurrency.
            await Promise.allSettled(
              [...this.pending]
                .filter(([key]) => {
                  try {
                    return JSON.parse(key)[1] === r.path
                  } catch {
                    return false
                  }
                })
                .map(([, value]) => value),
            )
          }),
        )
      if (!this.stopped)
        this.timer = setTimeout(() => {
          this.watching = tick()
        }, 60000)
    }
    this.timer = setTimeout(() => {
      this.watching = tick()
    }, 60000)
  }
  async dispose() {
    this.stopped = true
    clearTimeout(this.timer)
    await this.watching
    await Promise.allSettled(this.pending.values())
  }
}
