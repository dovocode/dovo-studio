import { decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError, errorMessage } from '../../errors.js'
import { ProcessError } from '../../process.js'

const resource = mutableStruct({ remaining: Schema.Number, reset: Schema.Number })
const quota = mutableStruct({
  resources: mutableStruct({
    core: Schema.optional(resource),
    graphql: Schema.optional(resource),
  }),
})
const graphqlReading = mutableStruct({
  data: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        rateLimit: Schema.optional(
          Schema.NullOr(
            mutableStruct({
              limit: Schema.Number,
              remaining: Schema.Number,
              resetAt: Schema.String,
            }),
          ),
        ),
      }),
    ),
  ),
})
export type GithubQuota = { limit: number; remaining: number; resetAt: number }

/** Share admission and cooldown across every GitHub call using the same credentials. Background
 * refreshes stop below a reserve so interactive reads and actions keep working near the limit. */
export class GithubBudget {
  private accounts = new Map<
    string,
    {
      active: number
      waiting: Array<() => void>
      until: number
      failures: number
      quota?: GithubQuota
    }
  >()
  private entry(key: string) {
    let account = this.accounts.get(key)
    if (!account) {
      // Do not remove active/cooling accounts when bounding credential rotations.
      if (this.accounts.size >= 100)
        for (const [oldKey, entry] of this.accounts)
          if (!entry.active && !entry.waiting.length && entry.until <= Date.now())
            this.accounts.delete(oldKey)
      account = { active: 0, waiting: [], until: 0, failures: 0 }
      this.accounts.set(key, account)
    }
    return account
  }
  /** GraphQL documents report their own quota; keep it current without extra probes. A
   * reading from an earlier reset window never replaces a later one. */
  observe(key: string, reading: GithubQuota) {
    const entry = this.entry(key)
    if (entry.quota && entry.quota.resetAt > reading.resetAt) return
    entry.quota = reading
  }
  /** Read a GraphQL response's in-band quota, when the document requested it. */
  observeGraphql(key: string, response: string) {
    try {
      const parsed = decodeResult(graphqlReading, JSON.parse(response))
      const limit = parsed.success ? parsed.data.data?.rateLimit : undefined
      if (!limit) return
      const resetAt = Date.parse(limit.resetAt)
      if (Number.isFinite(resetAt))
        this.observe(key, { limit: limit.limit, remaining: limit.remaining, resetAt })
    } catch {
      // Not a JSON document; the caller handles the response.
    }
  }
  /** The share of the quota kept for interactive work while background refreshes pause. */
  reserve(key: string) {
    const quota = this.entry(key).quota
    if (!quota || quota.resetAt <= Date.now()) return undefined
    return quota.remaining < Math.max(50, Math.ceil(quota.limit * 0.1)) ? quota : undefined
  }
  async run<T>(
    key: string,
    request: () => Promise<T>,
    readQuota: () => Promise<string>,
    options: { background?: boolean } = {},
  ): Promise<T> {
    const entry = this.entry(key)
    if (entry.active >= 4) await new Promise<void>((resolve) => entry.waiting.push(resolve))
    else entry.active++
    try {
      if (entry.until > Date.now())
        throw new HttpError(
          429,
          `GitHub requests paused until ${new Date(entry.until).toISOString()} because the account reached its rate limit. Cached PR data remains available.`,
        )
      const reserved = options.background ? this.reserve(key) : undefined
      if (reserved)
        throw new HttpError(
          429,
          `GitHub quota is reserved for interactive use until ${new Date(reserved.resetAt).toISOString()}. Background refresh resumes after the reset; cached PR data remains available.`,
        )
      try {
        const result = await request()
        entry.failures = 0
        return result
      } catch (error) {
        const text = error instanceof ProcessError ? String(error.stderr) : errorMessage(error)
        if (!/rate limit|abuse detection|too many requests|HTTP 429/i.test(text)) throw error
        entry.failures++
        const secondary = /secondary|abuse detection|too many requests|HTTP 429/i.test(text)
        const retryAfter = text.match(/retry-after:\s*(\d+)/i)
        entry.until = Math.max(
          entry.until,
          Date.now() +
            (retryAfter
              ? Number(retryAfter[1]) * 1000
              : secondary
                ? Math.min(60_000 * 2 ** (entry.failures - 1), 3_600_000)
                : entry.until > Date.now()
                  ? 0
                  : 3_600_000),
        )
        if (!secondary && entry.failures === 1) {
          try {
            const result = decodeResult(quota, JSON.parse(await readQuota()))
            if (result.success) {
              const exhausted = Object.values(result.data.resources).filter(
                (value): value is Schema.Schema.Type<typeof resource> =>
                  value !== undefined && value.remaining === 0,
              )
              if (exhausted.length)
                entry.until = Math.max(
                  Date.now() + 60_000,
                  ...exhausted.map((value) => value.reset * 1000),
                )
            }
          } catch {
            // Keep the conservative cooldown if GitHub cannot report the reset time.
          }
        }
        throw new HttpError(
          429,
          `GitHub rate limit reached. Requests resume after ${new Date(entry.until).toISOString()}.`,
        )
      }
    } finally {
      const next = entry.waiting.shift()
      if (next) next()
      else entry.active--
    }
  }
}
