import { ResetCredits } from './reset-credits'
import { useMemo, useState, useEffect, memo } from 'react'
import { FlatList, View } from 'react-native'
import {
  formatUsageCost,
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageTokens,
  createUsageSummary,
  type UsageRow,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Choice } from '../ui/controls/choice'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { colors, styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'

const periods = { week: 7, month: 30 } as const

const Row = memo(function Row({ row, first }: { row: UsageRow; first: boolean }) {
  const tokens = row.tokenTurns ? ` · ${formatUsageTokens(row.tokens)} tokens` : ''
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
        {row.pricedTurns ? ` · ${formatUsageCost(row.estimatedCostUsd)} est.` : ''}
      </Text>
      {(row.tokenTurns < row.turns || row.pricedTurns < row.turns) && (
        <Text style={styles.muted}>
          {row.tokenTurns}/{row.turns} turns reported tokens · {row.pricedTurns}/{row.turns} priced
        </Text>
      )}
    </View>
  )
})

/** Agent time, turns and tokens across saved computers. */
export default function UsageScreen() {
  const { overviews } = useRuntime()
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
        overviews.flatMap((entry) =>
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
    [overviews, period, now, projectUsage],
  )
  const [breakdown, setBreakdown] = useState<'accounts' | 'models' | 'tasks'>('accounts')
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
      <FlatList
        data={summary[breakdown]}
        keyExtractor={(row) => row.key}
        renderItem={({ item, index }) => <Row row={item} first={index === 0} />}
        initialNumToRender={10}
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 0 }]}
        ListEmptyComponent={
          <Text style={[styles.muted, { paddingVertical: 16 }]}>
            No turns in this period. Try the last 30 days or run a new task.
          </Text>
        }
        ListHeaderComponent={
          <View style={{ gap: 24, marginBottom: 12 }}>
            <View style={{ gap: 12 }}>
              <Choice
                label="Period"
                value={period}
                items={[
                  { id: 'week', name: 'Last 7 days' },
                  { id: 'month', name: 'Last 30 days' },
                ]}
                onChange={(value) => {
                  if (value === 'week' || value === 'month') setPeriod(value)
                }}
              />
              <Text style={styles.muted}>
                {overviews.filter((entry) => entry.snapshot).length} computers with usage data ·
                Includes running turns
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {[
                  {
                    label: 'Agent turns',
                    value: String(total.turns),
                    detail: total.failed ? `${total.failed} failed` : 'No failed turns',
                  },
                  {
                    label: 'Agent time',
                    value: formatUsageDuration(total.durationMs),
                    detail: 'Across computers',
                  },
                  {
                    label: 'Reported tokens',
                    value: total.tokenTurns ? formatUsageTokens(total.tokens) : '—',
                    detail: `${total.tokenTurns} of ${total.turns} reported`,
                  },
                  {
                    label: 'API-equivalent cost',
                    value: total.pricedTurns ? formatUsageCost(total.estimatedCostUsd) : '—',
                    detail: `${total.pricedTurns} of ${total.turns} priced`,
                  },
                ].map((metric) => (
                  <View key={metric.label} style={[styles.card, { flexGrow: 1, flexBasis: '45%' }]}>
                    <Text style={styles.muted}>{metric.label}</Text>
                    <Text style={[styles.title, { fontVariant: ['tabular-nums'] }]}>
                      {metric.value}
                    </Text>
                    <Text style={styles.muted}>{metric.detail}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.muted}>
                Cost estimates use reported tokens and local API rates, not your subscription bill.
                Partial totals are lower bounds.
              </Text>
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
                        const expired = !!limit.resetsAt && limit.resetsAt * 1000 <= now
                        const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                        return (
                          <View key={limit.key} style={{ gap: 5 }}>
                            <Text style={styles.text}>
                              {limit.window} ·{' '}
                              {expired ? 'Awaiting reading' : `${Math.round(remaining)}% left`}
                            </Text>
                            {!expired && (
                              <View
                                accessibilityRole="progressbar"
                                accessibilityLabel={`${provider} ${limit.window} remaining`}
                                accessibilityValue={{
                                  min: 0,
                                  max: 100,
                                  now: Math.round(remaining),
                                }}
                                style={{
                                  height: 7,
                                  borderRadius: 4,
                                  backgroundColor: colors.border,
                                }}
                              >
                                <View
                                  style={{
                                    height: 7,
                                    borderRadius: 4,
                                    width: `${remaining}%`,
                                    backgroundColor:
                                      remaining <= 10
                                        ? colors.error
                                        : remaining <= 25
                                          ? colors.warning
                                          : colors.accent,
                                  }}
                                />
                              </View>
                            )}
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
            <View style={{ gap: 8 }}>
              <Text style={styles.title}>Usage breakdown</Text>
              <Choice
                label="Group usage by"
                value={breakdown}
                items={[
                  { id: 'accounts', name: 'Accounts' },
                  { id: 'models', name: 'Models' },
                  { id: 'tasks', name: 'Threads' },
                ]}
                onChange={(value) => {
                  if (value === 'accounts' || value === 'models' || value === 'tasks')
                    setBreakdown(value)
                }}
              />
              <Text style={styles.muted}>
                {breakdown === 'tasks'
                  ? '10 busiest threads by agent time'
                  : 'Sorted by agent time'}
              </Text>
            </View>
          </View>
        }
      />
    </View>
  )
}
