import { decodeResult, mutableStruct, mutableArray } from '@dovo/protocol'
import { Schema } from 'effect'

/** Provider-reported quota metadata. Never includes credentials, bodies or query variables. */
export type GithubQuota = { limit: number; remaining: number; resetAt: number }
export type GithubResponseInfo = {
  resource: string
  status: number
  cached: boolean
  quota?: GithubQuota
  cost?: number
  used?: number
}
export type GithubRateLimit = {
  resource?: string
  secondary: boolean
  resetAt?: number
  retryAfter?: number
}

export function githubResponseInfo(response: Response, graphql: boolean): GithubResponseInfo {
  const number = (name: string) => {
    const value = response.headers.get(name)
    return value !== null && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : undefined
  }
  const limit = number('x-ratelimit-limit')
  const remaining = number('x-ratelimit-remaining')
  const reset = number('x-ratelimit-reset')
  return {
    resource: response.headers.get('x-ratelimit-resource') ?? (graphql ? 'graphql' : 'core'),
    status: response.status,
    cached: response.status === 304,
    used: number('x-ratelimit-used'),
    ...(limit !== undefined && remaining !== undefined && reset !== undefined
      ? { quota: { limit, remaining, resetAt: reset * 1000 } }
      : {}),
  }
}

const graphqlResponse = mutableStruct({
  data: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        rateLimit: Schema.optional(
          Schema.NullOr(
            mutableStruct({
              limit: Schema.Number,
              remaining: Schema.Number,
              resetAt: Schema.String,
              cost: Schema.optional(Schema.Number),
            }),
          ),
        ),
      }),
    ),
  ),
  errors: Schema.optional(
    mutableArray(
      mutableStruct({
        type: Schema.optional(Schema.String),
        code: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    ),
  ),
})
export function githubGraphqlInfo(text: string) {
  try {
    const result = decodeResult(graphqlResponse, JSON.parse(text))
    if (!result.success) return undefined
    const rate = result.data.data?.rateLimit
    const resetAt = rate ? Date.parse(rate.resetAt) : NaN
    return {
      ...(rate && Number.isFinite(resetAt)
        ? { quota: { limit: rate.limit, remaining: rate.remaining, resetAt }, cost: rate.cost }
        : {}),
      secondary:
        result.data.errors?.some((error) =>
          /secondary|abuse detection|too many requests/i.test(error.message ?? ''),
        ) ?? false,
      limited:
        result.data.errors?.some(
          (error) =>
            error.type === 'RATE_LIMIT' ||
            error.code === 'graphql_rate_limit' ||
            /rate limit/i.test(error.message ?? ''),
        ) ?? false,
    }
  } catch {
    return undefined
  }
}
