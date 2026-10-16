import { decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError, errorMessage } from '../../errors.js'
import { ProcessError } from '../../process.js'
import { GithubApiError } from './github-transport.js'
import { githubGraphqlInfo, type GithubQuota } from './github-rate-limit.js'

const resource = mutableStruct({ remaining: Schema.Number, reset: Schema.Number })
const quota = mutableStruct({
  resources: mutableStruct({
    core: Schema.optional(resource),
    graphql: Schema.optional(resource),
  }),
})
type ResourceBudget = { until: number; quota?: GithubQuota }

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
      resources: Map<string, ResourceBudget>
    }
  >()
  private entry(key: string) {
    let account = this.accounts.get(key)
    if (!account) {
      // Do not remove active/cooling accounts when bounding credential rotations.
      if (this.accounts.size >= 100)
        for (const [oldKey, entry] of this.accounts)
          if (
            !entry.active &&
            !entry.waiting.length &&
            entry.until <= Date.now() &&
            [...entry.resources.values()].every((resource) => resource.until <= Date.now())
          )
            this.accounts.delete(oldKey)
      account = { active: 0, waiting: [], until: 0, failures: 0, resources: new Map() }
      this.accounts.set(key, account)
    }
    return account
  }
  private resource(key: string, name: string) {
    const account = this.entry(key)
    let budget = account.resources.get(name)
    if (!budget) {
      budget = { until: 0 }
      account.resources.set(name, budget)
    }
    return budget
  }
  /** Ignore observations from older windows and out-of-order responses within a window. */
  observe(key: string, reading: GithubQuota, resource = 'graphql') {
    const entry = this.resource(key, resource)
    if (
      entry.quota &&
      (entry.quota.resetAt > reading.resetAt ||
        (entry.quota.resetAt === reading.resetAt && entry.quota.remaining < reading.remaining))
    )
      return
    entry.quota = reading
    entry.until = reading.remaining === 0 ? reading.resetAt : 0
  }
  /** Read a GraphQL response's in-band quota, when the document requested it. */
  observeGraphql(key: string, response: string) {
    const reading = githubGraphqlInfo(response)?.quota
    if (reading) this.observe(key, reading, 'graphql')
  }

  /** The share of the quota kept for interactive work while background refreshes pause. */
  reserve(key: string, resource = 'core') {
    const quota = this.resource(key, resource).quota
    if (!quota || quota.resetAt <= Date.now()) return undefined
    return quota.remaining < Math.max(50, Math.ceil(quota.limit * 0.1)) ? quota : undefined
  }
  async run<T>(
    key: string,
    request: () => Promise<T>,
    readQuota: () => Promise<string>,
    options: { background?: boolean; resource?: string } = {},
  ): Promise<T> {
    const entry = this.entry(key)
    const name = options.resource ?? 'core'
    const resource = this.resource(key, name)
    if (entry.active >= 4) await new Promise<void>((resolve) => entry.waiting.push(resolve))
    else entry.active++
    try {
      const until = Math.max(entry.until, resource.until)
      if (until > Date.now())
        throw new HttpError(
          429,
          `GitHub requests paused until ${new Date(until).toISOString()} because the ${entry.until > Date.now() ? 'account' : name + ' quota'} reached its rate limit. Cached PR data remains available.`,
        )
      const reserved = options.background ? this.reserve(key, name) : undefined
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
        const reported = error instanceof GithubApiError ? error.rateLimit : undefined
        const secondary =
          reported?.secondary ?? /secondary|abuse detection|too many requests|HTTP 429/i.test(text)
        const retryAfter = reported
          ? (reported.retryAfter ?? NaN)
          : Number(text.match(/retry-after:\s*(\d+)/i)?.[1])
        let resetAt = reported?.resetAt
        const limited = this.resource(key, reported?.resource ?? name)
        if (secondary) {
          entry.failures++
          entry.until = Math.max(
            entry.until,
            Date.now() +
              (Number.isFinite(retryAfter)
                ? retryAfter * 1000
                : Math.min(60_000 * 2 ** (entry.failures - 1), 3_600_000)),
          )
        } else {
          // A failed request's own headers are authoritative. /rate_limit can be stale,
          // and an exhausted GraphQL bucket says nothing about REST's core bucket.
          if (!resetAt && !Number.isFinite(retryAfter)) {
            const known = limited.quota
            if (known?.remaining === 0 && known.resetAt > Date.now()) resetAt = known.resetAt
            else
              try {
                const result = decodeResult(quota, JSON.parse(await readQuota()))
                const reading =
                  result.success && ['core', 'graphql'].includes(reported?.resource ?? name)
                    ? (reported?.resource ?? name) === 'graphql'
                      ? result.data.resources.graphql
                      : result.data.resources.core
                    : undefined
                if (reading?.remaining === 0) resetAt = reading.reset * 1000
              } catch {
                // A missing reset uses a short bounded pause, never an assumed hour.
              }
          }
          limited.until = Math.max(
            limited.until,
            Number.isFinite(retryAfter)
              ? Date.now() + retryAfter * 1000
              : (resetAt ?? Date.now() + 60_000),
          )
        }
        const resume = secondary ? entry.until : limited.until
        throw new HttpError(
          429,
          `GitHub rate limit reached. Requests resume after ${new Date(resume).toISOString()}.`,
        )
      }
    } finally {
      const next = entry.waiting.shift()
      if (next) next()
      else entry.active--
    }
  }
}
