import { ResetCredits } from './reset-credits'
import { useMemo, useState, useEffect } from 'react'
import { ScrollView, View } from 'react-native'
import {
  formatUsageCost,
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageTokens,
  usageSummary,
  type UsageRow,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Choice } from '../ui/controls/choice'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { colors, styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'

const periods = { week: 7, month: 30 } as const

function Row({ row, first }: { row: UsageRow; first: boolean }) {
  const tokens = row.tokenTurns
    ? ` · ${formatUsageTokens(row.tokens)} tokens${row.tokenTurns < row.turns ? '*' : ''}`
    : ''
  return (
    <View
      accessible
      style={{
        padding: 12,
        gap: 2,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <Text numberOfLines={1} style={styles.text}>
        {row.label}
      </Text>
      <Text style={styles.muted}>
        {row.detail ? `${row.detail} · ` : ''}
        {row.turns} {row.turns === 1 ? 'turn' : 'turns'}
        {row.failed ? ` (${row.failed} failed)` : ''} · {formatUsageDuration(row.durationMs)}
        {tokens}
        {row.pricedTurns
          ? ` · ${formatUsageCost(row.estimatedCostUsd)} est.${row.pricedTurns < row.turns ? '*' : ''}`
          : ''}
      </Text>
    </View>
  )
}

/** Agent time, turns and tokens across saved computers. */
export default function UsageScreen() {
  const { overviews } = useRuntime()
  const [period, setPeriod] = useState<keyof typeof periods>('week')
  const summary = useMemo(
    () =>
      usageSummary(
        overviews.flatMap((entry) =>
          entry.snapshot
            ? [{ computer: entry.profile.name, tasks: entry.snapshot.workspace.tasks }]
            : [],
        ),
        Date.now() - periods[period] * 86_400_000,
      ),
    [overviews, period],
  )
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const total = summary.total
  const limits = accountPlanLimits(
    overviews.map((entry) => ({
      computer: entry.profile.name,
      sourceId: entry.profile.id,
      limits: entry.snapshot?.workspace.planLimits ?? [],
    })),
    now,
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Usage & limits" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>
            {total.turns} turns · {formatUsageDuration(total.durationMs)}
          </Text>
          {!!total.tokenTurns && (
            <Text style={styles.muted}>{formatUsageTokens(total.tokens)} tokens reported</Text>
          )}
          {!!total.pricedTurns && (
            <Text style={styles.muted}>
              {formatUsageCost(total.estimatedCostUsd)} API-equivalent estimate
            </Text>
          )}
          <Text style={styles.muted}>
            Estimated cost uses local token counts and standard API rates. It is not your
            subscription bill; * marks incomplete totals.
          </Text>
          <Choice
            label="Period"
            value={period}
            items={[
              { id: 'week', name: 'Last 7 days' },
              { id: 'month', name: 'Last 30 days' },
            ]}
            onChange={(value) => setPeriod(value as keyof typeof periods)}
          />
        </View>
        <SettingsGroup
          title="Account limits"
          footer="Limits are reported by Codex and Claude agents on connected computers. API-key usage may not have subscription windows."
        >
          {accountLimitGroups(limits).map((group) => {
            const { provider, windows } = group
            return (
              <View key={group.key} style={{ padding: 12, gap: 12 }}>
                <Text style={[styles.text, { fontWeight: '600' }]}>
                  {provider === 'codex' ? 'Codex' : 'Claude'} · {group.label}
                </Text>
                {group.windows[0] && <ResetCredits window={group.windows[0]} />}
                {windows.length ? (
                  windows.map((limit) => {
                    const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                    return (
                      <View key={limit.key} style={{ gap: 5 }}>
                        <Text style={styles.text}>
                          {limit.window} ·{' '}
                          {limit.resetsAt && limit.resetsAt * 1000 <= now
                            ? 'Awaiting reading'
                            : `${Math.round(remaining)}% left`}
                        </Text>
                        <View
                          style={{ height: 7, borderRadius: 4, backgroundColor: colors.border }}
                        >
                          <View
                            style={{
                              height: 7,
                              borderRadius: 4,
                              width: `${remaining}%`,
                              backgroundColor: colors.accent,
                            }}
                          />
                        </View>
                        <Text style={styles.muted}>
                          Reported by {limit.computers.join(', ')} · Updated{' '}
                          {new Date(limit.updatedAt).toLocaleString()} ·{' '}
                          {formatQuotaReset(limit.resetsAt, now)}
                        </Text>
                      </View>
                    )
                  })
                ) : (
                  <Text style={styles.muted}>
                    No recent limits reported. Run a {provider === 'codex' ? 'Codex' : 'Claude'}{' '}
                    turn to receive them.
                  </Text>
                )}
              </View>
            )
          })}
        </SettingsGroup>
        <SettingsGroup title="By account / subscription">
          {summary.accounts.map((row, index) => (
            <Row key={row.key} row={row} first={index === 0} />
          ))}
          {!summary.accounts.length && (
            <Text style={[styles.muted, { padding: 12 }]}>No agent turns yet.</Text>
          )}
        </SettingsGroup>
        <SettingsGroup
          title="By model"
          footer="Tokens appear for agents that report them; * marks totals that miss some turns."
        >
          {summary.models.length ? (
            summary.models.map((row, index) => <Row key={row.key} row={row} first={!index} />)
          ) : (
            <Text style={[styles.muted, { padding: 12 }]}>No agent turns yet.</Text>
          )}
        </SettingsGroup>
        {!!summary.tasks.length && (
          <SettingsGroup title="Busiest tasks">
            {summary.tasks.map((row, index) => (
              <Row key={row.key} row={row} first={!index} />
            ))}
          </SettingsGroup>
        )}
      </ScrollView>
    </View>
  )
}
