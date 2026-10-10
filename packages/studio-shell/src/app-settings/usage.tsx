import { runtimeComputerName } from '@dovo/protocol'
import { UsagePrices } from './usage-prices'
import { useUsageData } from './use-usage-data'
import { ResetCredits } from './reset-credits'
import { useMemo, useState, useEffect, memo } from 'react'
import {
  accountPlanLimits,
  quotaReadingState,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageCost,
  formatUsageTokens,
  createUsageSummary,
  usageChartDays,
  usageChartHours,
  useWorkspace,
  type UsageRow,
} from '@dovo/studio-core'
import { Button, ChoicePicker } from '@dovo/studio-ui'
import { SettingsSelect } from './settings-select'
import { SettingsGroup, SettingsPage, Segmented } from './layout'

const periods = { day: 1, week: 7, month: 30, quarter: 90 } as const

const Rows = memo(function Rows({ rows }: { rows: UsageRow[] }) {
  if (!rows.length)
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No turns in this period. Try the last 30 days or run a new task.
      </p>
    )
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full min-w-[32rem] text-xs">
        <caption className="sr-only">
          Usage by name, requests, agent time, tokens and estimated cost
        </caption>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1.5 font-normal">
              Name
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              Turns / requests
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              Agent time
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              Tokens
            </th>
            <th scope="col" className="py-1.5 text-right font-normal">
              Est. cost
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/60">
              <td className="max-w-64 py-1.5 pr-2">
                <span className="block truncate" title={row.label}>
                  {row.label}
                </span>
                {row.detail && (
                  <span title={row.detail} className="block truncate text-xs text-muted-foreground">
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
  const [computer, setComputer] = useState('all')
  const [view, setView] = useState<'costs' | 'tokens' | 'limits'>('costs')
  const { hosts, histories, notices, busy, refresh } = useUsageData(computer)
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
        hosts.flatMap((entry) =>
          entry.snapshot
            ? [
                {
                  id: entry.profile.id,
                  sourceId: histories[entry.profile.id]?.sourceId,
                  records: histories[entry.profile.id]?.records,
                  computer: runtimeComputerName(entry),
                  tasks: entry.snapshot.workspace.tasks,
                },
              ]
            : [],
        ),
        now - periods[period] * 86_400_000,
        now,
      ),
    [hosts, histories, period, now, projectUsage],
  )
  const [breakdown, setBreakdown] = useState<'accounts' | 'models' | 'tasks'>('accounts')
  const total = summary.total
  const chartDays =
    period === 'day'
      ? usageChartHours(summary.hours, now - 86400000, now)
      : usageChartDays(summary.days, now - periods[period] * 86400000, now)
  const chartMaximum = Math.max(
    1e-9,
    ...chartDays.map((row) => (view === 'tokens' ? row.tokens : row.estimatedCostUsd)),
  )
  const limits = accountPlanLimits(
    hosts.map((entry) => ({
      computer: runtimeComputerName(entry),
      sourceId: entry.profile.id,
      connected: entry.connected,
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
        <Segmented
          label="Usage view"
          value={view}
          options={[
            ['costs', 'Costs'],
            ['tokens', 'Tokens'],
            ['limits', 'Limits'],
          ]}
          onChange={setView}
        />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <ChoicePicker
            aria-label="Computer"
            value={computer}
            onValueChange={setComputer}
            className="sm:w-48"
          >
            <option value="all">All computers</option>
            {runtimes.map((entry) => (
              <option key={entry.profile.id} value={entry.profile.id}>
                {runtimeComputerName(entry)}
                {entry.connected ? '' : ' · Offline'}
              </option>
            ))}
          </ChoicePicker>
          <Button
            variant="outline"
            disabled={busy || !hosts.some((entry) => entry.connected)}
            onClick={refresh}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      {!hosts.length && (
        <p
          role="status"
          className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
        >
          Connect a computer to see recorded usage and account limits.
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Refreshing usage and account limits…
        </p>
      )}
      {hosts.map(
        (entry) =>
          notices[entry.profile.id] && (
            <p
              key={entry.profile.id}
              role="status"
              className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {runtimeComputerName(entry)}: {notices[entry.profile.id]}
            </p>
          ),
      )}
      {view !== 'limits' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Activity overview</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {hosts.filter((entry) => entry.snapshot).length}{' '}
                {hosts.filter((entry) => entry.snapshot).length === 1 ? 'computer' : 'computers'}{' '}
                with usage data · Includes running turns and CLI requests
              </p>
            </div>
            <SettingsSelect
              label="Period"
              value={period}
              options={[
                ['day', 'Last 24 hours'],
                ['week', 'Last 7 days'],
                ['month', 'Last 30 days'],
                ['quarter', 'Last 90 days'],
              ]}
              onChange={setPeriod}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Usage records',
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
              <div key={metric.label} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">{metric.value}</p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{metric.detail}</p>
              </div>
            ))}
          </div>
          <section className="space-y-3" aria-label="Daily usage">
            <h2 className="text-sm font-medium">
              {period === 'day' ? 'Hourly' : 'Daily'}{' '}
              {view === 'tokens' ? 'tokens' : 'API-equivalent cost'}
            </h2>
            <div className="flex items-end gap-1 rounded-lg border p-3" style={{ height: 128 }}>
              {chartDays.map((day) => {
                const value = view === 'tokens' ? day.tokens : day.estimatedCostUsd
                const maximum = chartMaximum
                const label = `${day.label}: ${view === 'tokens' ? formatUsageTokens(value) + ' tokens' : day.pricedTurns ? formatUsageCost(value) : day.turns ? 'Unpriced' : 'No usage'}`
                return (
                  <div
                    key={day.key}
                    aria-label={label}
                    title={label}
                    className="flex h-full min-w-0 flex-1 items-end"
                  >
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(value ? 2 : 0, (value / maximum) * 100)}%` }}
                    />
                  </div>
                )
              })}
              {!summary.days.length && (
                <p className="self-center text-xs text-muted-foreground">
                  No usage in this period.
                </p>
              )}
            </div>
            {view === 'tokens' && (
              <p className="text-xs text-muted-foreground">
                Input {formatUsageTokens(total.input)} · Output {formatUsageTokens(total.output)} ·
                Cache read {formatUsageTokens(total.cacheRead)} · Cache write{' '}
                {formatUsageTokens(total.cacheWrite)}. Older turns may report totals only.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {chartDays[0]?.label} {summary.days.length ? '—' : ''} {chartDays.at(-1)?.label} ·
              Recorded usage remains available after deleting a thread.
            </p>
          </section>
        </>
      )}
      {view === 'limits' && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-medium">Account limits</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Codex and Claude subscription windows reported by connected agents.
            </p>
          </div>
          {!limits.length && (
            <p
              role="status"
              className="rounded-lg border p-4 text-xs leading-relaxed text-muted-foreground"
            >
              No account limits reported. Refresh to check connected computers. API-key accounts may
              not have subscription limits.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {accountLimitGroups(limits).map((group) => {
              const { provider, windows } = group
              return (
                <div key={group.key} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      {provider === 'codex' ? 'Codex' : 'Claude'} · {group.label}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {windows.length
                        ? `${windows.length} ${windows.length === 1 ? 'window' : 'windows'}`
                        : 'No reading'}
                    </span>
                  </div>
                  {group.windows[0] && <ResetCredits window={group.windows[0]} />}
                  {windows.length ? (
                    <div className="mt-4 space-y-4">
                      {windows.map((limit) => {
                        const state = quotaReadingState(limit, limit.connected, now)
                        const expired = state === 'awaiting'
                        const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                        return (
                          <div key={limit.key} className="text-xs">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium">{limit.window}</span>
                              <span className="font-semibold tabular-nums">
                                {expired
                                  ? 'Awaiting reading'
                                  : `${Math.round(remaining)}% left${state === 'fresh' ? '' : ` · ${state}`}`}
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
                            <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
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
                      No subscription windows reported. Refresh checks the signed-in host account
                      without starting a turn. API-key usage may not have subscription windows.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
      {view !== 'limits' && (
        <UsagePrices
          rows={summary.models}
          computer={computer}
          histories={histories}
          onSaved={refresh}
        />
      )}
      {view !== 'limits' && (
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
            Cost uses reported tokens and cached API rates. Unreported usage is excluded, so actual
            usage may be higher.
          </p>
        </section>
      )}
    </SettingsPage>
  )
}
