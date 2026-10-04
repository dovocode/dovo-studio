import type { PlanLimit, TaskBehavior, Task } from '@dovo/protocol'

/** A quota error and a fresh, exhausted provider window must both confirm the stop. */
export function quotaContinuation(
  error: string,
  limits: readonly PlanLimit[],
  policy: TaskBehavior | undefined,
  turnId: string,
  now = Date.now(),
): Task['quotaContinuation'] {
  if (!policy?.quotaResume && !policy?.quotaSnooze) return undefined
  if (
    !/(?:usage|rate|quota|plan)\s*(?:limit|exceed|exhaust)|(?:limit|quota).*(?:reached|exceed|exhaust)|too many requests|rate_limit|usage_limit|insufficient_quota/i.test(
      error,
    )
  )
    return undefined
  const exhausted = limits.filter((limit) => limit.usedPercent >= 100)
  // Every exhausted window must report a future reset; wait for the latest one.
  if (
    !exhausted.length ||
    exhausted.some((limit) => !limit.resetsAt || limit.resetsAt * 1000 <= now)
  )
    return undefined
  const at = new Date(
    Math.max(...exhausted.map((limit) => (limit.resetsAt ?? 0) * 1000)),
  ).toISOString()
  return { turnId, at, resume: policy.quotaResume === true }
}
