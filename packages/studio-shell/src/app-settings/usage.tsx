import { ResetCredits } from './reset-credits'
import { useMemo, useState, useEffect } from 'react'
import {
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageCost,
  formatUsageTokens,
  usageSummary,
  useWorkspace,
  type UsageRow,
} from '@dovo/studio-core'
import { SettingsGroup, SettingsPage, Segmented } from './layout'

const periods = { week: 7, month: 30 } as const

function Rows({ rows }: { rows: UsageRow[] }) {
  if (!rows.length) return <p className="py-3 text-xs text-muted-foreground">No agent turns yet.</p>
  return (
    <table className="w-full text-xs">
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
              {row.tokenTurns && row.tokenTurns < row.turns ? '*' : ''}
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
              {row.pricedTurns && row.pricedTurns < row.turns ? '*' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Settings → Usage: agent time, turns and tokens across every connected computer. */
export default function UsageSettings() {
  const { runtimes } = useWorkspace()
  const [period, setPeriod] = useState<keyof typeof periods>('week')
  const summary = useMemo(
    () =>
      usageSummary(
        runtimes.flatMap((entry) =>
          entry.snapshot
            ? [{ computer: entry.profile.name, tasks: entry.snapshot.workspace.tasks }]
            : [],
        ),
        Date.now() - periods[period] * 86_400_000,
      ),
    [runtimes, period],
  )
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
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
      description="Agent turns on your computers. Cost is a local API-equivalent estimate, not your subscription bill. * marks incomplete totals."
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium tabular-nums">{total.turns}</span> turns ·{' '}
          <span className="font-medium tabular-nums">{formatUsageDuration(total.durationMs)}</span>{' '}
          agent time
          {total.tokenTurns ? (
            <>
              {' '}
              · <span className="font-medium tabular-nums">
                {formatUsageTokens(total.tokens)}
              </span>{' '}
              tokens
            </>
          ) : null}
          {total.pricedTurns ? (
            <>
              {' '}
              ·{' '}
              <span className="font-medium tabular-nums">
                {formatUsageCost(total.estimatedCostUsd)}
              </span>{' '}
              estimated
            </>
          ) : null}
        </p>
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
                      const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                      return (
                        <div key={limit.key} className="text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">{limit.window}</span>
                            <span className="font-semibold tabular-nums">
                              {limit.resetsAt && limit.resetsAt * 1000 <= now
                                ? 'Awaiting reading'
                                : `${Math.round(remaining)}% left`}
                            </span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${provider} ${limit.window} remaining for ${limit.accountLabel}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(remaining)}
                            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${remaining}%` }}
                            />
                          </div>
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
      <SettingsGroup title="By account / subscription">
        <Rows rows={summary.accounts} />
      </SettingsGroup>
      <SettingsGroup title="By model">
        <Rows rows={summary.models} />
      </SettingsGroup>
      <SettingsGroup title="Busiest tasks">
        <Rows rows={summary.tasks} />
      </SettingsGroup>
    </SettingsPage>
  )
}
