import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { formatUsageDuration, formatUsageTokens, usageSummary, type UsageRow } from '@dovo/protocol'
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
  const total = summary.total
  const limits = overviews
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
          {(['codex', 'claude'] as const).map((provider) => {
            const windows = limits.filter((limit) => limit.provider === provider)
            return (
              <View key={provider} style={{ padding: 12, gap: 12 }}>
                <Text style={[styles.text, { fontWeight: '600' }]}>
                  {provider === 'codex' ? 'Codex' : 'Claude'}
                </Text>
                {windows.length ? (
                  windows.map((limit) => {
                    const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                    return (
                      <View key={`${limit.computer}:${limit.window}`} style={{ gap: 5 }}>
                        <Text style={styles.text}>
                          {limit.window} · {Math.round(remaining)}% left
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
                          {limit.computer} · Updated {new Date(limit.updatedAt).toLocaleString()}
                          {limit.resetsAt
                            ? ` · Resets ${new Date(limit.resetsAt * 1000).toLocaleString()}`
                            : ''}
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
