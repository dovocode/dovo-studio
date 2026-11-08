import { reportedUsageAccount } from '../../tasks/usage-account.js'
import { mergePlanLimits, planLimitKey, reportedPlanLimits, type PlanLimit } from '@dovo/protocol'

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** A warm app-server can repeat its cached windows after a newer account probe. */
export function codexRateLimitUpdates() {
  let previous: PlanLimit[] = []
  let accountId: string | undefined
  return (name: string, payload: unknown): unknown => {
    if (name === 'account/read') {
      const next = reportedUsageAccount('codex', name, payload)?.id
      // Quota values are snapshots for an account, not a property of the process.
      if (next !== accountId) previous = []
      accountId = next
      return payload
    }
    if (name !== 'account/rateLimits/updated' && name !== 'account/rateLimits/read') return payload
    const incoming = reportedPlanLimits('codex', name, payload)
    const merged = mergePlanLimits(previous, incoming)
    const old = new Map(previous.map((limit) => [planLimitKey(limit), limit]))
    const latest = new Map(merged.map((limit) => [planLimitKey(limit), limit]))
    const changed = new Set(
      incoming.flatMap((limit) => {
        const key = planLimitKey(limit)
        const before = old.get(key)
        const after = latest.get(key)!
        return !before ||
          before.usedPercent !== after.usedPercent ||
          before.resetsAt !== after.resetsAt ||
          before.durationMins !== after.durationMins
          ? [JSON.stringify([limit.bucketId, limit.windowId])]
          : []
      }),
    )
    previous = merged
    if (!changed.size) return undefined
    const value = record(payload)
    const named = record(value.rateLimitsByLimitId)
    const buckets = Object.keys(named).length
      ? Object.entries(named)
      : [[undefined, value.rateLimits ?? value] as const]
    return {
      ...value,
      rateLimitsByLimitId: Object.fromEntries(
        buckets.flatMap(([id, raw]) => {
          const bucket = record(raw)
          const bucketId = typeof bucket.limitId === 'string' ? bucket.limitId : (id ?? 'codex')
          const windows = (['primary', 'secondary'] as const).filter((windowId) =>
            changed.has(JSON.stringify([bucketId, windowId])),
          )
          return windows.length
            ? [
                [
                  bucketId,
                  {
                    ...bucket,
                    primary: undefined,
                    secondary: undefined,
                    ...Object.fromEntries(windows.map((key) => [key, bucket[key]])),
                  },
                ],
              ]
            : []
        }),
      ),
    }
  }
}
