import { useForegroundInterval } from '../runtime/state/app-active'
import { UsagePrices } from './usage-prices'
import { useUsageData } from './use-usage-data'
import { Action } from '../ui/controls/action'
import { ResetCredits } from './reset-credits'
import { useMemo, useState, memo } from 'react'
import { FlatList, View } from 'react-native'
import {
  formatUsageCost,
  accountPlanLimits,
  quotaReadingState,
  accountLimitGroups,
  formatQuotaReset,
  formatUsageDuration,
  formatUsageTokens,
  createUsageSummary,
  usageChartDays,
  usageChartHours,
  type UsageRow,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Choice } from '../ui/controls/choice'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { colors, styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'

const periods = { day: 1, week: 7, month: 30, quarter: 90 } as const

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
  const [computer, setComputer] = useState('all')
  const [view, setView] = useState<'costs' | 'tokens' | 'limits'>('costs')
  const { hosts, histories, notices, busy, refresh } = useUsageData(computer)
  const [period, setPeriod] = useState<keyof typeof periods>('week')
  const [now, setNow] = useState(Date.now())
  useForegroundInterval(() => setNow(Date.now()), 60000)
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
                  computer: entry.profile.name,
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
      computer: entry.profile.name,
      sourceId: entry.profile.id,
      connected: entry.connected,
      limits: entry.snapshot?.workspace.planLimits ?? [],
    })),
    now,
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Usage & limits" />
      <FlatList
        data={view === 'limits' ? [] : summary[breakdown]}
        keyExtractor={(row) => row.key}
        renderItem={({ item, index }) => <Row row={item} first={index === 0} />}
        initialNumToRender={10}
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 0 }]}
        ListEmptyComponent={
          view === 'limits' ? null : (
            <Text style={[styles.muted, { paddingVertical: 16 }]}>
              No turns in this period. Try the last 30 days or run a new task.
            </Text>
          )
        }
        ListHeaderComponent={
          <View style={{ gap: 24, marginBottom: 12 }}>
            <View style={{ gap: 12 }}>
              <Choice
                label="Usage view"
                value={view}
                items={[
                  { id: 'costs', name: 'Costs' },
                  { id: 'tokens', name: 'Tokens' },
                  { id: 'limits', name: 'Limits' },
                ]}
                onChange={(value) => {
                  if (value === 'costs' || value === 'tokens' || value === 'limits') setView(value)
                }}
              />
              <Choice
                label="Computer"
                value={computer}
                items={[
                  { id: 'all', name: 'All computers' },
                  ...overviews.map((entry) => ({
                    id: entry.profile.id,
                    name: `${entry.profile.name}${entry.connected ? '' : ' · Offline'}`,
                  })),
                ]}
                onChange={setComputer}
              />
              <Action
                label={busy ? 'Refreshing…' : 'Refresh usage'}
                onPress={refresh}
                disabled={busy || !hosts.some((entry) => entry.connected)}
                secondary
              />
              {hosts.map(
                (entry) =>
                  notices[entry.profile.id] && (
                    <Text key={entry.profile.id} style={styles.muted}>
                      {entry.profile.name}: {notices[entry.profile.id]}
                    </Text>
                  ),
              )}
            </View>
            {view !== 'limits' && (
              <>
                <View style={{ gap: 12 }}>
                  <Choice
                    label="Period"
                    value={period}
                    items={[
                      { id: 'day', name: 'Last 24 hours' },
                      { id: 'week', name: 'Last 7 days' },
                      { id: 'month', name: 'Last 30 days' },
                      { id: 'quarter', name: 'Last 90 days' },
                    ]}
                    onChange={(value) => {
                      if (
                        value === 'day' ||
                        value === 'week' ||
                        value === 'month' ||
                        value === 'quarter'
                      )
                        setPeriod(value)
                    }}
                  />
                  <Text style={styles.muted}>
                    {overviews.filter((entry) => entry.snapshot).length} computers with usage data ·
                    Dovo turns and CLI requests · Includes running turns
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {[
                      {
                        label: 'Usage records',
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
                      <View
                        key={metric.label}
                        style={[styles.card, { flexGrow: 1, flexBasis: '45%' }]}
                      >
                        <Text style={styles.muted}>{metric.label}</Text>
                        <Text style={[styles.title, { fontVariant: ['tabular-nums'] }]}>
                          {metric.value}
                        </Text>
                        <Text style={styles.muted}>{metric.detail}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.muted}>
                    Cost estimates use reported tokens and cached API rates, not your subscription
                    bill. Partial totals are lower bounds.
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={styles.title}>
                    {period === 'day' ? 'Hourly' : 'Daily'}{' '}
                    {view === 'tokens' ? 'tokens' : 'API-equivalent cost'}
                  </Text>
                  <View
                    style={[
                      styles.card,
                      { height: 132, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
                    ]}
                  >
                    {chartDays.map((day) => {
                      const value = view === 'tokens' ? day.tokens : day.estimatedCostUsd
                      const maximum = chartMaximum
                      return (
                        <View
                          key={day.key}
                          accessible
                          accessibilityLabel={`${day.label}: ${view === 'tokens' ? formatUsageTokens(value) + ' tokens' : day.pricedTurns ? formatUsageCost(value) : day.turns ? 'Unpriced' : 'No usage'}`}
                          style={{
                            flex: 1,
                            height: `${Math.max(value ? 2 : 0, (value / maximum) * 100)}%`,
                            backgroundColor: colors.accent,
                            borderTopLeftRadius: 3,
                            borderTopRightRadius: 3,
                          }}
                        />
                      )
                    })}
                    {!summary.days.length && (
                      <Text style={styles.muted}>No usage in this period.</Text>
                    )}
                  </View>
                  {view === 'tokens' && (
                    <Text style={styles.muted}>
                      Input {formatUsageTokens(total.input)} · Output{' '}
                      {formatUsageTokens(total.output)} · Cache read{' '}
                      {formatUsageTokens(total.cacheRead)} · Cache write{' '}
                      {formatUsageTokens(total.cacheWrite)}. Older turns may report totals only.
                    </Text>
                  )}
                  <Text style={styles.muted}>
                    {chartDays[0]?.label} {summary.days.length ? '—' : ''} {chartDays.at(-1)?.label}{' '}
                    · Recorded usage survives thread deletion.
                  </Text>
                </View>
              </>
            )}
            {view === 'limits' && (
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
                          const state = quotaReadingState(limit, limit.connected, now)
                          const expired = state === 'awaiting'
                          const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent))
                          return (
                            <View key={limit.key} style={{ gap: 5 }}>
                              <Text style={styles.text}>
                                {limit.window} ·{' '}
                                {expired
                                  ? 'Awaiting reading'
                                  : `${Math.round(remaining)}% left${state === 'fresh' ? '' : ` · ${state}`}`}
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
                          No subscription windows reported. Refresh checks the signed-in host
                          account without starting a turn.
                        </Text>
                      )}
                    </View>
                  )
                })}
              </SettingsGroup>
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
            )}
          </View>
        }
      />
    </View>
  )
}
