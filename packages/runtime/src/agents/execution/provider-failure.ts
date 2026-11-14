import { HttpError, RuntimeOperationError, errorMessage } from '../../errors.js'

export type ProviderFailureKind =
  | 'authentication'
  | 'configuration'
  | 'capacity'
  | 'quota'
  | 'unavailable'
  | 'unknown'
export function providerFailureKind(error: unknown): ProviderFailureKind {
  const message = errorMessage(error)
  if (
    /\b(?:401|invalid_api_key|authentication_required|authRequired)\b|(?:access|refresh) token (?:expired|revoked)|authentication (?:failed|required)/i.test(
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
    /MODEL_CAPACITY_EXHAUSTED|No capacity available for model|overloaded_error|model (?:is )?(?:busy|overloaded)/i.test(
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
  ) {
    super(`${guidance[kind]}\n${errorMessage(cause)}`, { cause })
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
