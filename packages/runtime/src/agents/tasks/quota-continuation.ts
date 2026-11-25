import type { PlanLimit, TaskBehavior, Task } from '@dovo/protocol'
import { providerQuotaResetAt } from '../execution/provider-failure.js'

/** Use a provider-confirmed reset for this failure or a fresh exhausted provider window. */
export function quotaFailureTiming(
  error: string,
  limits: readonly PlanLimit[],
  policy: TaskBehavior | undefined,
  turnId: string,
  now = Date.now(),
  providerResetAt?: number,
): { quotaRetryAt?: string; continuation?: Task['quotaContinuation'] } {
  if (
    !/\b429\b|(?:usage|rate|quota|plan)\s*(?:limit|exceed|exhaust)|(?:limit|quota).*(?:reached|exceed|exhaust)|(?:hit|reached|exceeded) (?:your|the) limit|too many requests|rate_limit|usage_limit|insufficient_quota/i.test(
      error,
    )
  )
    return {}
  const exhausted = limits.filter((limit) => limit.usedPercent >= 100)
  if (exhausted.some((limit) => !limit.resetsAt || limit.resetsAt * 1000 <= now)) return {}
  const latest = Math.max(
    providerResetAt ?? providerQuotaResetAt(error, now) ?? 0,
    ...exhausted.map((limit) => (limit.resetsAt ?? 0) * 1000),
  )
  const reset = new Date(latest)
  if (!Number.isFinite(reset.getTime()) || latest <= now) return {}
  const at = reset.toISOString()
  return {
    quotaRetryAt: at,
    continuation:
      policy?.quotaResume || policy?.quotaSnooze
        ? { turnId, at, resume: policy.quotaResume === true }
        : undefined,
  }
}
