import { useMemo, useState } from 'react'
import {
  formatUsageDuration,
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
  const total = summary.total
  const limits = runtimes
    .flatMap((entry) =>
      (entry.snapshot?.workspace.planLimits ?? []).map((limit) => ({
        ...limit,
        computer: entry.profile.name,
      })),
    )
    .filter(
      (limit) =>
        Date.now() - Date.parse(limit.updatedAt) < 24 * 60 * 60 * 1000 &&
        (!limit.resetsAt || limit.resetsAt * 1000 > Date.now()),
    )
  return (
    <SettingsPage
      title="Usage"
      description="Agent turns on your computers. Tokens appear for agents that report them; * marks totals that miss some turns."
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
      {!!limits.length && (
        <SettingsGroup title="Plan limits">
          <div className="space-y-3 py-2">
            {limits.map((limit) => (
              <div key={`${limit.computer}:${limit.provider}:${limit.window}`} className="text-xs">
                <div className="flex justify-between gap-3">
                  <span>
                    {limit.computer} · {limit.provider === 'codex' ? 'Codex' : 'Claude'} ·{' '}
                    {limit.window}
                  </span>
                  <span className="tabular-nums">{Math.round(100 - limit.usedPercent)}% left</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary"
                    style={{ width: `${limit.usedPercent}%` }}
                  />
                </div>
                {limit.resetsAt && (
                  <div className="mt-1 text-muted-foreground">
                    Resets {new Date(limit.resetsAt * 1000).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SettingsGroup>
      )}
      <SettingsGroup title="By model">
        <Rows rows={summary.models} />
      </SettingsGroup>
      <SettingsGroup title="Busiest tasks">
        <Rows rows={summary.tasks} />
      </SettingsGroup>
    </SettingsPage>
  )
}
