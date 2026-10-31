import { Schema } from 'effect'
import { decodeResult, mutableStruct } from '../../shared/schema.js'

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const providerRetrySchema = mutableStruct({
  attempt: count,
  maxRetries: count,
  delayMs: count,
  httpStatus: Schema.optional(count),
  state: Schema.Literals(['waiting', 'recovered']),
})
export type ProviderRetry = Schema.Schema.Type<typeof providerRetrySchema>

const claudeRetrySchema = mutableStruct({
  type: Schema.Literal('system'),
  subtype: Schema.Literal('api_retry'),
  attempt: count,
  max_retries: count,
  retry_delay_ms: count,
  error_status: Schema.NullOr(count),
  parent_tool_use_id: Schema.optional(Schema.NullOr(Schema.String)),
})

/** Display provider-owned retries without starting another retry loop. */
export function claudeProviderRetry(payload: unknown): ProviderRetry | undefined {
  const decoded = decodeResult(claudeRetrySchema, payload)
  if (!decoded.success) return undefined
  const event = decoded.data
  if (event.parent_tool_use_id != null) return undefined
  return {
    attempt: event.attempt,
    maxRetries: event.max_retries,
    delayMs: event.retry_delay_ms,
    ...(event.error_status === null ? {} : { httpStatus: event.error_status }),
    state: 'waiting',
  }
}

export function providerRetryLabel(turn: {
  providerRetry?: ProviderRetry
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}): string | undefined {
  const retry = turn.providerRetry
  if (!retry) return undefined
  if (turn.status === 'cancelled') return 'Stopped after automatic retry'
  if (turn.status === 'failed') return 'Turn failed after automatic retry'
  if (turn.status === 'completed' || retry.state === 'recovered')
    return 'Connection recovered after automatic retry'
  const reason = retry.httpStatus ? `HTTP ${retry.httpStatus}` : 'Connection interrupted'
  return `${reason} · automatic retry ${retry.attempt} of ${retry.maxRetries} · retry delay ${Math.ceil(retry.delayMs / 1000)}s`
}
