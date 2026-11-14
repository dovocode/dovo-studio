import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { hubPlanLimitSources } from '@dovo/protocol'
import { UsageHubs } from './usage-hubs'
import { UsagePool } from './usage-pool'
import { runtimeComputerName } from '@dovo/protocol'
import { useForegroundInterval } from '../runtime/state/app-active'
import { UsagePrices } from './usage-prices'
import { useUsageData } from './use-usage-data'
import { SettingsAction as Action } from './settings-controls'
import { ResetCredits } from './reset-credits'
import { useMemo, useState, memo } from 'react'
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native'
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
import { SettingsChoice as Choice } from './settings-controls'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { SettingsGroup } from './settings-group'

const periods = { day: 1, week: 7, month: 30, quarter: 90 } as const

const Row = memo(function Row({ row, first }: { row: UsageRow; first: boolean }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const tokens = row.tokenTurns ? ` · ${formatUsageTokens(row.tokens)} tokens` : ''
  return (
    <View
      accessible
      style={{
        padding: 12,
        gap: 2,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      <Text numberOfLines={2} style={styles.text}>
        {row.label}
      </Text>
      <Text style={styles.muted}>
        {row.detail ? `${row.detail} · ` : ''}
        {row.turns} {row.turns === 1 ? uiText('turn') : uiText('turns')}
        {row.failed ? uiText(' ({value0} failed)', { value0: row.failed }) : ''} ·{' '}
        {formatUsageDuration(row.durationMs)}
        {tokens}
        {row.pricedTurns
          ? uiText(' · {value0} est.', { value0: formatUsageCost(row.estimatedCostUsd) })
          : ''}
      </Text>
      {(row.tokenTurns < row.turns || row.pricedTurns < row.turns) && (
        <Text style={styles.muted}>
          <InterfaceText
            values={{
              value0: row.tokenTurns,
              value1: row.turns,
              value2: row.pricedTurns,
              value3: row.turns,
            }}
          >
            {'{value0}/{value1} turns reported tokens · {value2}/{value3} priced'}
          </InterfaceText>
        </Text>
      )}
    </View>
  )
})

/** Agent time, turns and tokens across saved computers. */
export default function UsageScreen() {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { width, fontScale } = useWindowDimensions()
  const stackedMetrics = width / fontScale < 360
  const { overviews } = useRuntime()
  const [computer, setComputer] = useState('all')
  const [view, setView] = useState<'costs' | 'tokens' | 'limits'>('costs')
  const selectedComputer = overviews.length === 1 ? 'all' : computer
  const { hosts, histories, hubs, notices, busy, refresh } = useUsageData(
    selectedComputer,
    view === 'limits' ? 'limits' : 'history',
  )
  const [period, setPeriod] = useState<keyof typeof periods>('week')
  const [now, setNow] = useState(Date.now())
  useForegroundInterval(() => setNow(Date.now()), 60000)
  const projectUsage = useMemo(() => createUsageSummary(), [])
  const summary = useMemo(
    () =>
      projectUsage(
        view === 'limits'
          ? []
          : hosts.flatMap((entry) =>
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
    [hosts, histories, period, now, projectUsage, view],
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
  const chartHasData = chartDays.some((row) =>
    view === 'tokens' ? row.tokens > 0 : row.estimatedCostUsd > 0,
  )
  const chartEmptyMessage = !total.turns
    ? 'No usage in this period.'
    : view === 'tokens'
      ? total.tokenTurns
        ? 'Reported token usage is zero in this period.'
        : 'No tokens reported in this period.'
      : total.pricedTurns
        ? 'Reported cost is $0.00 in this period.'
        : 'No priced usage in this period.'
  const limits = accountPlanLimits(
    hosts.flatMap((entry) => [
      {
        computer: runtimeComputerName(entry),
        sourceId: entry.profile.id,
        connected: entry.connected,
        limits: entry.snapshot?.workspace.planLimits ?? [],
      },
      ...(hubs[entry.profile.id] ?? [])
        .filter((hub) => hub.enabled)
        .flatMap((hub) =>
          hubPlanLimitSources(hub, {
            computer: `${runtimeComputerName(entry)} · ${hub.label}`,
            sourceId: `${entry.profile.id}:hub:${hub.id}`,
            connected: entry.connected,
          }),
        ),
    ]),
    now,
  )
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Usage & limits')} />
      <FlatList
        data={view === 'limits' ? [] : summary[breakdown]}
        keyExtractor={(row) => row.key}
        renderItem={({ item, index }) => (
          <View
            style={{
              backgroundColor: colors.surface,
              paddingHorizontal: 4,
              borderTopLeftRadius: index === 0 ? 24 : 0,
              borderTopRightRadius: index === 0 ? 24 : 0,
              borderBottomLeftRadius: index === summary[breakdown].length - 1 ? 24 : 0,
              borderBottomRightRadius: index === summary[breakdown].length - 1 ? 24 : 0,
            }}
          >
            <Row row={item} first={index === 0} />
          </View>
        )}
        initialNumToRender={10}
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 0 }]}
        ListEmptyComponent={
          view === 'limits' ? undefined : (
            <Text style={[styles.muted, { paddingVertical: 16 }]}>
              <InterfaceText>
                {'No turns in this period. Try the last 30 days or run a new task.'}
              </InterfaceText>
            </Text>
          )
        }
        ListHeaderComponent={
          <View style={{ gap: 28, marginBottom: 28 }}>
            <View style={{ gap: 12 }}>
              <SettingsGroup>
                <Choice
                  label={uiText('Usage view')}
                  value={view}
                  items={[
                    { id: 'costs', name: uiText('Costs') },
                    { id: 'tokens', name: uiText('Tokens') },
                    { id: 'limits', name: uiText('Limits') },
                  ]}
                  onChange={(value) => {
                    if (value === 'costs' || value === 'tokens' || value === 'limits')
                      setView(value)
                  }}
                />
                {overviews.length > 1 && (
                  <Choice
                    label={uiText('Computer')}
                    value={computer}
                    items={[
                      { id: 'all', name: uiText('All computers') },
                      ...overviews.map((entry) => ({
                        id: entry.profile.id,
                        name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
                      })),
                    ]}
                    onChange={setComputer}
                  />
                )}
              </SettingsGroup>
              <Action
                label={busy ? uiText('Refreshing…') : uiText('Refresh usage')}
                onPress={refresh}
                disabled={busy || !hosts.some((entry) => entry.connected)}
                secondary
              />
              {!hosts.length && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  <InterfaceText>
                    {'Connect a computer to see recorded usage and account limits.'}
                  </InterfaceText>
                </Text>
              )}
              {hosts.map(
                (entry) =>
                  notices[entry.profile.id] && (
                    <Text key={entry.profile.id} style={styles.muted}>
                      {runtimeComputerName(entry)}: {notices[entry.profile.id]}
                    </Text>
                  ),
              )}
            </View>
            {view !== 'limits' && (
              <>
                <View style={{ gap: 12 }}>
                  <Choice
                    label={uiText('Period')}
                    value={period}
                    items={[
                      { id: 'day', name: uiText('Last 24 hours') },
                      { id: 'week', name: uiText('Last 7 days') },
                      { id: 'month', name: uiText('Last 30 days') },
                      { id: 'quarter', name: uiText('Last 90 days') },
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
                    <InterfaceText
                      values={{
                        value0: hosts.filter((entry) => entry.snapshot).length,
                        value1:
                          hosts.filter((entry) => entry.snapshot).length === 1
                            ? uiText('computer')
                            : uiText('computers'),
                      }}
                    >
                      {
                        '{value0} {value1} with usage data · Dovo turns and CLI requests · Includes running turns'
                      }
                    </InterfaceText>
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {[
                      {
                        label: uiText('Usage records'),
                        value: String(total.turns),
                        detail: total.failed ? `${total.failed} failed` : 'No failed turns',
                      },
                      {
                        label: uiText('Agent time'),
                        value: formatUsageDuration(total.durationMs),
                        detail: 'Across computers',
                      },
                      {
                        label: uiText('Reported tokens'),
                        value: total.tokenTurns ? formatUsageTokens(total.tokens) : '—',
                        detail: `${total.tokenTurns} of ${total.turns} reported`,
                      },
                      {
                        label: uiText('API-equivalent cost'),
                        value: total.pricedTurns ? formatUsageCost(total.estimatedCostUsd) : '—',
                        detail: `${total.pricedTurns} of ${total.turns} priced`,
                      },
                    ].map((metric) => (
                      <View
                        key={metric.label}
                        style={[
                          styles.card,
                          { flexGrow: 1, flexBasis: stackedMetrics ? '100%' : '45%', minWidth: 0 },
                        ]}
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
                    <InterfaceText>
                      {
                        'Cost estimates use reported tokens and cached API rates, not your subscription bill. Partial totals are lower bounds.'
                      }
                    </InterfaceText>
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={styles.title}>
                    {period === 'day' ? uiText('Hourly') : uiText('Daily')}{' '}
                    {view === 'tokens' ? uiText('tokens') : uiText('API-equivalent cost')}
                  </Text>
                  <View
                    style={[
                      styles.card,
                      {
                        height: 132,
                        flexDirection: 'row',
                        alignItems: chartHasData ? 'flex-end' : 'center',
                        justifyContent: 'center',
                        gap: chartDays.length > 31 ? 1 : 2,
                      },
                    ]}
                  >
                    {chartHasData &&
                      chartDays.map((day) => {
                        const value = view === 'tokens' ? day.tokens : day.estimatedCostUsd
                        const maximum = chartMaximum
                        return (
                          <View
                            key={day.key}
                            accessible
                            accessibilityRole="image"
                            accessibilityLabel={`${day.label}: ${view === 'tokens' ? (day.tokenTurns ? uiText('{value0} tokens', { value0: formatUsageTokens(value) }) : day.turns ? uiText('Tokens not reported') : uiText('No usage')) : day.pricedTurns ? formatUsageCost(value) : day.turns ? uiText('Unpriced') : uiText('No usage')}`}
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
                    {!chartHasData && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[styles.muted, { flex: 1, textAlign: 'center' }]}
                      >
                        {chartEmptyMessage}
                      </Text>
                    )}
                  </View>
                  {view === 'tokens' && (
                    <Text style={styles.muted}>
                      <InterfaceText
                        values={{
                          value0: formatUsageTokens(total.input),
                          value1: formatUsageTokens(total.output),
                          value2: formatUsageTokens(total.cacheRead),
                          value3: formatUsageTokens(total.cacheWrite),
                        }}
                      >
                        {
                          'Input {value0} · Output {value1} · Cache read {value2} · Cache write {value3}. Older turns may report totals only.'
                        }
                      </InterfaceText>
                    </Text>
                  )}
                  <Text style={styles.muted}>
                    <InterfaceText
                      values={{ value0: chartDays[0]?.label, value1: chartDays.at(-1)?.label }}
                    >
                      {'{value0} — {value1} · Recorded usage survives thread deletion.'}
                    </InterfaceText>
                  </Text>
                </View>
              </>
            )}
            {view === 'limits' && (
              <View style={{ gap: 16 }}>
                <UsageHubs computer={selectedComputer} onSaved={refresh} />
                {hosts.flatMap((entry) =>
                  (hubs[entry.profile.id] ?? [])
                    .filter((hub) => hub.enabled)
                    .map((hub) => (
                      <Text key={`${entry.profile.id}:${hub.id}`} style={styles.muted}>
                        {runtimeComputerName(entry)} · {hub.label}:{' '}
                        {hub.error ??
                          (hub.limits.length
                            ? uiText('Updated {value0}', {
                                value0: hub.checkedAt
                                  ? new Date(hub.checkedAt).toLocaleString()
                                  : 'unknown',
                              })
                            : uiText('No supported account limits reported.'))}
                      </Text>
                    )),
                )}
                <UsagePool
                  limits={limits}
                  now={now}
                  accounts={hosts.flatMap((entry) =>
                    (hubs[entry.profile.id] ?? [])
                      .filter((hub) => hub.enabled)
                      .flatMap((hub) => hub.accounts ?? []),
                  )}
                />
                <SettingsGroup
                  title={uiText('Account limits')}
                  footer={uiText(
                    'Limits are reported by Codex, Claude, and OpenCode agents on connected computers. API-key usage may not have subscription windows.',
                  )}
                >
                  {!limits.length && (
                    <Text accessibilityLiveRegion="polite" style={[styles.muted, { padding: 12 }]}>
                      <InterfaceText>
                        {
                          'No account limits reported. Refresh to check connected computers. API-key accounts may not have subscription limits.'
                        }
                      </InterfaceText>
                    </Text>
                  )}
                  {accountLimitGroups(limits).map((group) => {
                    const { provider, windows } = group
                    return (
                      <View key={group.key} style={{ padding: 12, gap: 12 }}>
                        <Text style={[styles.text, { fontWeight: '600' }]}>
                          {provider === 'codex'
                            ? 'Codex'
                            : provider === 'opencode'
                              ? 'OpenCode'
                              : 'Claude'}{' '}
                          · {group.label}
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
                                    ? uiText('Awaiting reading')
                                    : uiText('{value0}% left{value1}', {
                                        value0: Math.round(remaining),
                                        value1: state === 'fresh' ? '' : ` · ${state}`,
                                      })}
                                </Text>
                                {!expired && (
                                  <View
                                    accessibilityRole="progressbar"
                                    accessibilityLabel={uiText('{value0} {value1} remaining', {
                                      value0: provider,
                                      value1: limit.window,
                                    })}
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
                                  <InterfaceText
                                    values={{
                                      value0: limit.computers.join(', '),
                                      value1: new Date(limit.updatedAt).toLocaleString(),
                                      value2: formatQuotaReset(limit.resetsAt, now),
                                    }}
                                  >
                                    {'Reported by {value0} · Updated {value1} · {value2}'}
                                  </InterfaceText>
                                </Text>
                              </View>
                            )
                          })
                        ) : (
                          <Text style={styles.muted}>
                            <InterfaceText>
                              {
                                'No subscription windows reported. Refresh checks the signed-in host account without starting a turn.'
                              }
                            </InterfaceText>
                          </Text>
                        )}
                      </View>
                    )
                  })}
                </SettingsGroup>
              </View>
            )}
            {view !== 'limits' && (
              <UsagePrices
                rows={summary.models}
                computer={selectedComputer}
                histories={histories}
                onSaved={refresh}
              />
            )}
            {view !== 'limits' && (
              <View style={{ gap: 8 }}>
                <Text style={styles.title}>
                  <InterfaceText>{'Usage breakdown'}</InterfaceText>
                </Text>
                <Choice
                  label={uiText('Group usage by')}
                  value={breakdown}
                  items={[
                    { id: 'accounts', name: uiText('Accounts') },
                    { id: 'models', name: uiText('Models') },
                    { id: 'tasks', name: uiText('Threads') },
                  ]}
                  onChange={(value) => {
                    if (value === 'accounts' || value === 'models' || value === 'tasks')
                      setBreakdown(value)
                  }}
                />
                <Text style={styles.muted}>
                  {breakdown === 'tasks'
                    ? uiText('10 busiest threads by agent time')
                    : uiText('Sorted by agent time')}
                </Text>
              </View>
            )}
          </View>
        }
      />
    </SettingsPage>
  )
}
