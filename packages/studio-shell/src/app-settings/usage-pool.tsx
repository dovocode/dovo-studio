import {
  pooledPlanLimits,
  formatQuotaReset,
  type UsageHubAccount,
  type accountPlanLimits,
} from '@dovo/protocol'
export function UsagePool({
  limits,
  now,
  accounts = [],
}: {
  limits: ReturnType<typeof accountPlanLimits>
  now: number
  accounts?: UsageHubAccount[]
}) {
  const pools = pooledPlanLimits(limits, now, accounts)
  if (!pools.length) return null
  return (
    <section aria-label="Pooled account availability" className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Pooled availability</h2>
        <p className="text-xs text-muted-foreground">
          Each segment is one account. Plans have different capacities; percentages are not
          combined.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {pools.map((pool) => (
          <div key={pool.key} className="rounded-lg border bg-card p-4 space-y-2">
            <h3 className="text-sm font-medium">
              {pool.provider === 'codex' ? 'Codex' : 'Claude'} · {pool.window}
            </h3>
            <p className="text-xs text-muted-foreground">
              {pool.available} of {pool.segments.length} accounts available
              {pool.unknown ? ` · ${pool.unknown} without a fresh reading` : ''}
            </p>
            <div className="flex gap-1">
              {pool.segments.map((segment) => (
                <div
                  key={segment.accountKey}
                  role="img"
                  aria-label={`${segment.label}: ${segment.remaining === null ? segment.state : `${Math.round(segment.remaining)}% left`}${segment.gatedByWeekly ? ' · Weekly limit reached' : ''}`}
                  title={`${segment.label} · ${segment.remaining === null ? segment.state : `${Math.round(segment.remaining)}% left`}${segment.gatedByWeekly ? ' · Weekly limit reached' : ''}`}
                  className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-muted"
                >
                  <div
                    className={
                      segment.remaining === null
                        ? 'h-full bg-muted-foreground/20'
                        : 'h-full bg-primary'
                    }
                    style={{ width: segment.remaining === null ? '100%' : `${segment.remaining}%` }}
                  />
                </div>
              ))}
            </div>
            {pool.nextReset && (
              <p className="text-xs text-muted-foreground">
                Next depleted account: {formatQuotaReset(pool.nextReset, now)}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
