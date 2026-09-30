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

/** Share admission and cooldown across every GitHub call using the same credentials. */
export class GithubBudget {
  private accounts = new Map<
    string,
    { active: number; waiting: Array<() => void>; until: number; failures: number }
  >()
  async run<T>(
    key: string,
    request: () => Promise<T>,
    readQuota: () => Promise<string>,
  ): Promise<T> {
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
    const entry = account
    if (entry.active >= 4) await new Promise<void>((resolve) => entry.waiting.push(resolve))
    else entry.active++
    try {
      if (entry.until > Date.now())
        throw new HttpError(
          429,
          `GitHub requests paused until ${new Date(entry.until).toISOString()} because the account reached its rate limit. Cached PR data remains available.`,
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
