import { ResetCredits } from './reset-credits'
import { useMemo, useState, useEffect, memo } from 'react'
import {
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageCost,
  formatUsageTokens,
  createUsageSummary,
  useWorkspace,
  type UsageRow,
} from '@dovo/studio-core'
import { SettingsGroup, SettingsPage, Segmented } from './layout'

const periods = { week: 7, month: 30 } as const

const Rows = memo(function Rows({ rows }: { rows: UsageRow[] }) {
  if (!rows.length)
    return (
      <p className="py-3 text-xs text-muted-foreground">
        No turns in this period. Try the last 30 days or run a new task.
      </p>
    )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-xs">
        <thead className="text-left text-[0.6875rem] text-muted-foreground">
          <tr>
            <th className="py-1.5 font-normal">Name</th>
            <th className="py-1.5 text-right font-normal">Turns</th>
            <th className="py-1.5 text-right font-normal">Agent time</th>
            <th className="py-1.5 text-right font-normal">Tokens</th>
            <th className="py-1.5 text-right font-normal">Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/60">
              <td className="max-w-64 py-1.5 pr-2">
                <span className="block truncate">{row.label}</span>
                {row.detail && (
                  <span className="block truncate text-[0.6875rem] text-muted-foreground">
                    {row.detail}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {row.turns}
                {row.failed ? (
                  <span className="text-muted-foreground"> · {row.failed} failed</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatUsageDuration(row.durationMs)}
              </td>
              <td
                className="py-1.5 text-right tabular-nums"
                title={
                  row.tokenTurns < row.turns
                    ? `${row.turns - row.tokenTurns} turns did not report tokens`
                    : undefined
                }
              >
                {row.tokenTurns ? formatUsageTokens(row.tokens) : '—'}
                {row.tokenTurns < row.turns && (
                  <span className="block text-[10px] text-muted-foreground">
                    {row.tokenTurns}/{row.turns} reported
                  </span>
                )}
              </td>
              <td
                className="py-1.5 text-right tabular-nums"
                title={
                  row.pricedTurns < row.turns
                    ? `${row.turns - row.pricedTurns} turns could not be priced`
                    : undefined
                }
              >
                {row.pricedTurns ? formatUsageCost(row.estimatedCostUsd) : '—'}
                {row.pricedTurns < row.turns && (
                  <span className="block text-[10px] text-muted-foreground">
                    {row.pricedTurns}/{row.turns} priced
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

/** Settings → Usage: agent time, turns and tokens across every connected computer. */
export default function UsageSettings() {
  const { runtimes } = useWorkspace()
  const [period, setPeriod] = useState<keyof typeof periods>('week')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const projectUsage = useMemo(() => createUsageSummary(), [])
  const summary = useMemo(
    () =>
      projectUsage(
        runtimes.flatMap((entry) =>
          entry.snapshot
            ? [
                {
                  id: entry.profile.id,
                  computer: entry.profile.name,
                  tasks: entry.snapshot.workspace.tasks,
                },
              ]
            : [],
        ),
        now - periods[period] * 86_400_000,
        now,
      ),
    [runtimes, period, now, projectUsage],
  )
  const [breakdown, setBreakdown] = useState<'accounts' | 'models' | 'tasks'>('accounts')
  const total = summary.total
  const limits = accountPlanLimits(
    runtimes.map((entry) => ({
      computer: entry.profile.name,
      sourceId: entry.profile.id,
      limits: entry.snapshot?.workspace.planLimits ?? [],
    })),
    now,
  )
  return (
    <SettingsPage
      title="Usage & limits"
      description="Usage across your computers. API-equivalent cost is an estimate, separate from subscription limits."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Activity overview</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {runtimes.filter((entry) => entry.snapshot).length} computers with usage data · Includes
            running turns
          </p>
        </div>
        <Segmented
          label="Period"
          value={period}
          options={[
            ['week', 'Last 7 days'],
            ['month', 'Last 30 days'],
          ]}
          onChange={setPeriod}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Agent turns',
            value: String(total.turns),
            detail: total.failed ? `${total.failed} failed` : 'No failed turns',
          },
          {
            label: 'Agent time',
            value: formatUsageDuration(total.durationMs),
            detail: 'Combined across computers',
          },
          {
            label: 'Reported tokens',
            value: total.tokenTurns ? formatUsageTokens(total.tokens) : '—',
            detail: `${total.tokenTurns} of ${total.turns} turns reported`,
          },
          {
            label: 'API-equivalent cost',
            value: total.pricedTurns ? formatUsageCost(total.estimatedCostUsd) : '—',
            detail: `${total.pricedTurns} of ${total.turns} turns priced`,
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border bg-card/60 p-3">
            <p className="text-[0.6875rem] text-muted-foreground">{metric.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{metric.value}</p>
            <p className="mt-1 text-[0.625rem] leading-4 text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
      </div>
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-medium">Account limits</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Codex and Claude subscription windows reported by connected agents.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {accountLimitGroups(limits).map((group) => {
            const { provider, windows } = group
            return (
              <div key={group.key} className="rounded-xl border bg-card/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {provider === 'codex' ? 'Codex' : 'Claude'} · {group.label}
                  </h3>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {windows.length
                      ? `${windows.length} ${windows.length === 1 ? 'window' : 'windows'}`
                      : 'No reading'}
                  </span>
                </div>
                {group.windows[0] && <ResetCredits window={group.windows[0]} />}
                {windows.length ? (
                  <div className="mt-4 space-y-4">
                    {windows.map((limit) => {
                      const expired = !!limit.resetsAt && limit.resetsAt * 1000 <= now
                      const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                      return (
                        <div key={limit.key} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">{limit.window}</span>
                            <span className="font-semibold tabular-nums">
                              {expired ? 'Awaiting reading' : `${Math.round(remaining)}% left`}
                            </span>
                          </div>
                          {!expired && (
                            <div
                              role="progressbar"
                              aria-label={`${provider} ${limit.window} remaining for ${limit.accountLabel}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(remaining)}
                              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                            >
                              <div
                                className={`h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none ${remaining <= 10 ? 'bg-destructive' : remaining <= 25 ? 'bg-amber-400' : 'bg-primary'}`}
                                style={{ width: `${remaining}%` }}
                              />
                            </div>
                          )}
                          <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-[0.6875rem] text-muted-foreground">
                            <span>
                              Reported by {limit.computers.join(', ')} · Updated{' '}
                              {new Date(limit.updatedAt).toLocaleString()}
                            </span>
                            <span>{formatQuotaReset(limit.resetsAt, now)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    No recent limits reported. Run a {provider === 'codex' ? 'Codex' : 'Claude'}{' '}
                    turn on a connected computer to receive its account limits. API-key usage may
                    not have subscription windows.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Usage breakdown</h2>
          <Segmented
            label="Group usage by"
            value={breakdown}
            options={[
              ['accounts', 'Accounts'],
              ['models', 'Models'],
              ['tasks', 'Threads'],
            ]}
            onChange={setBreakdown}
          />
        </div>
        <SettingsGroup
          title={
            breakdown === 'tasks'
              ? '10 busiest threads by agent time'
              : breakdown === 'models'
                ? 'Models by agent time'
                : 'Accounts and subscriptions'
          }
        >
          <Rows rows={summary[breakdown]} />
        </SettingsGroup>
        <p className="text-xs text-muted-foreground">
          Cost uses reported tokens and local API rates. Missing usage is excluded, so partial
          totals are lower bounds.
        </p>
      </section>
    </SettingsPage>
  )
}
