import { HttpError, RuntimeOperationError, errorMessage } from '../../errors.js'

export type ProviderFailureKind =
  | 'authentication'
  | 'configuration'
  | 'capacity'
  | 'quota'
  | 'unavailable'
  | 'unknown'
export function providerQuotaResetAt(message: string, now = Date.now()) {
  const timestamp =
    /\b(?:resets? at|retry after)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))/i.exec(
      message,
    )?.[1]
  if (timestamp) {
    const time = Date.parse(timestamp)
    if (Number.isFinite(time)) return time
  }
  const seconds =
    /\b(?:retry-after:\s*(\d+(?:\.\d+)?)\b(?!\.)|(?:retry|try again) (?:in|after)\s+(\d+(?:\.\d+)?)\s*seconds?\b)/i.exec(
      message,
    )
  if (seconds) return now + Math.ceil(Number(seconds[1] ?? seconds[2]) * 1000)
  const compact =
    /\b(?:resets? in|(?:retry|try again) (?:in|after))\s+(?=\d)(?:(\d{1,3})h)?(?:(\d{1,3})m)?(?:(\d{1,3}(?:\.\d+)?)s)?(?=[.,;\s)]|$)/i.exec(
      message,
    )
  if (!compact) return undefined
  const [, hours, minutes, remainder] = compact
  const delay =
    (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(remainder ?? 0)) * 1000
  return delay > 0 ? now + Math.ceil(delay) : undefined
}
export function providerFailureKind(error: unknown): ProviderFailureKind {
  if (error instanceof ProviderFailure) return error.kind
  const message = errorMessage(error)
  if (
    /\b(?:401|invalid_api_key|authentication_required|authRequired|auth_not_found|UNAUTHENTICATED)\b|(?:access|refresh) token (?:expired|revoked)|authentication (?:failed|required)/i.test(
      message,
    )
  )
    return 'authentication'
  if (
    /reasoning start before end|unsupported.{0,30}(?:reasoning|effort)|invalid.{0,20}(?:model|configuration)|model.{0,20}not found/i.test(
      message,
    )
  )
    return 'configuration'
  if (
    /\b529\b|MODEL_CAPACITY_EXHAUSTED|No capacity available for model|overloaded_error|model (?:is )?(?:busy|overloaded)/i.test(
      message,
    )
  )
    return 'capacity'
  if (
    /\b(?:429|insufficient_quota|rate_limit_exceeded)\b|(?:quota|usage limit).*(?:exhaust|reach|exceed)/i.test(
      message,
    )
  )
    return 'quota'
  if (/\b(?:502|503|504)\b|provider (?:is )?unavailable|ECONNREFUSED|ETIMEDOUT/i.test(message))
    return 'unavailable'
  return 'unknown'
}
const guidance: Record<Exclude<ProviderFailureKind, 'unknown'>, string> = {
  authentication: 'The provider refused its sign-in. Reconnect that provider account.',
  configuration:
    'The provider rejected this model or reasoning setting. Review the selection before retrying.',
  capacity:
    'The provider has no capacity for this model. This does not establish that your quota is spent.',
  quota:
    'The provider reported a rate or usage limit. Review its allowance or use the configured backup.',
  unavailable: 'The provider is temporarily unavailable. Your saved sign-in is kept.',
}
export class ProviderFailure extends Error {
  constructor(
    readonly kind: Exclude<ProviderFailureKind, 'unknown'>,
    cause: unknown,
    readonly quotaResetAt?: number,
  ) {
    const reset =
      quotaResetAt === undefined ? '' : `\nQuota resets at ${new Date(quotaResetAt).toISOString()}.`
    super(`${guidance[kind]}\n${errorMessage(cause)}${reset}`, { cause })
  }
}
export function explainProviderFailure(error: unknown): unknown {
  if (error instanceof RuntimeOperationError) {
    const cause = explainProviderFailure(error.cause)
    return cause === error.cause ? error : new RuntimeOperationError({ cause })
  }
  if (error instanceof HttpError || error instanceof ProviderFailure) return error
  const kind = providerFailureKind(error)
  return kind === 'unknown' ? error : new ProviderFailure(kind, error)
}
