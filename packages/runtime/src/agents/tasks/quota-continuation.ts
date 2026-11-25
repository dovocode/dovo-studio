import type { PlanLimit, TaskBehavior, Task } from '@dovo/protocol'

/** Use a provider-confirmed reset for this failure or a fresh exhausted provider window. */
export function quotaContinuation(
  error: string,
  limits: readonly PlanLimit[],
  policy: TaskBehavior | undefined,
  turnId: string,
  now = Date.now(),
  providerResetAt?: number,
): Task['quotaContinuation'] {
  if (!policy?.quotaResume && !policy?.quotaSnooze) return undefined
  if (
    !/(?:usage|rate|quota|plan)\s*(?:limit|exceed|exhaust)|(?:limit|quota).*(?:reached|exceed|exhaust)|too many requests|rate_limit|usage_limit|insufficient_quota/i.test(
      error,
    )
  )
    return undefined
  const exhausted = limits.filter((limit) => limit.usedPercent >= 100)
  if (exhausted.some((limit) => !limit.resetsAt || limit.resetsAt * 1000 <= now)) return undefined
  const latest = Math.max(
    providerResetAt ?? 0,
    ...exhausted.map((limit) => (limit.resetsAt ?? 0) * 1000),
  )
  if (!Number.isFinite(latest) || latest <= now) return undefined
  const at = new Date(latest).toISOString()
  return { turnId, at, resume: policy.quotaResume === true }
}
