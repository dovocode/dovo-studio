import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { aggregateRuntimeTasks, type RuntimeOverview } from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { colors, styles } from '../ui/theme'
import { Icon } from '../ui/icon'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'

function status(entry: RuntimeOverview) {
  return entry.connected ? 'Online' : entry.lastSeen || entry.error ? 'Offline' : 'Connecting'
}

function activity(entry: RuntimeOverview) {
  if (!entry.snapshot) return entry.error ? 'Activity unavailable' : 'Loading activity…'
  const tasks = aggregateRuntimeTasks([entry])
  const input = tasks.filter((item) => item.needsInput).length
  const working = tasks.filter((item) => item.task.status === 'running').length
  return [
    input ? `${input} need input` : '',
    working ? `${working} ${entry.connected ? 'working' : 'last seen working'}` : '',
    !input && !working ? `${tasks.length} active` : '',
    entry.pulls?.needsAttention ? `${entry.pulls.needsAttention} PRs need action` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function FleetOverview({
  entries,
  onSelectSource,
  compact = false,
  source = 'all',
}: {
  entries: RuntimeOverview[]
  onSelectSource: (id: string) => void
  compact?: boolean
  source?: string
}) {
  const { navigate } = useNavigation()
  const [viewportWidth, setViewportWidth] = useState(0)
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const detail = entries.find((entry) => entry.profile.id === selected)
  const sourceEntry =
    source === 'all'
      ? entries.length === 1
        ? entries[0]
        : undefined
      : entries.find((entry) => entry.profile.id === source)
  const compactSummary = sourceEntry
    ? `${sourceEntry.profile.name} · ${status(sourceEntry)}`
    : `${entries.length} computers · ${entries.filter((entry) => entry.connected).length} online`
  if (!entries.length) return null
  const summary = (entry: RuntimeOverview, compact: boolean) => (
    <Pressable
      key={entry.profile.id}
      testID={`Runtime summary ${entry.profile.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${entry.profile.name}, ${status(entry)}, ${activity(entry)}`}
      accessibilityHint="Show device activity and connection details."
      onPress={() => setSelected(entry.profile.id)}
      style={({ pressed }) => ({
        width: compact ? undefined : Math.min(248, viewportWidth || 248),
        minHeight: compact ? 44 : 76,
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: compact ? 8 : 10,
        borderRadius: 12,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={[styles.row, { flexWrap: 'nowrap', gap: 6 }]}>
        <Icon name="device" size={15} color={entry.connected ? colors.accent : colors.muted} />
        <Text numberOfLines={1} style={[styles.muted, { flex: 1, color: colors.text }]}>
          {entry.profile.name}
        </Text>
        <Text style={[styles.muted, { fontSize: 12 }]}>{status(entry)}</Text>
        <Icon name="next" size={11} color={colors.muted} />
      </View>
      {!compact && (
        <Text numberOfLines={2} style={[styles.muted, { fontSize: 12 }]}>
          {activity(entry)}
        </Text>
      )}
    </Pressable>
  )
  return (
    <View onLayout={(event) => setViewportWidth(Math.floor(event.nativeEvent.layout.width))}>
      {compact ? (
        <Pressable
          testID="Device overview"
          accessibilityRole="button"
          accessibilityLabel="Device overview"
          accessibilityValue={{ text: compactSummary }}
          accessibilityHint="Show activity across your computers."
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.row,
            { minHeight: 44, flexWrap: 'nowrap', opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Icon name="device" size={14} color={colors.muted} />
          <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>
            {compactSummary}
          </Text>
          <Icon name="next" size={11} color={colors.muted} />
        </Pressable>
      ) : entries.length === 1 ? (
        summary(entries[0], true)
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {entries.map((entry) => summary(entry, false))}
        </ScrollView>
      )}
      {(open || detail) && (
        <Sheet
          title={detail?.profile.name ?? 'Your computers'}
          onClose={() => {
            setOpen(false)
            setSelected('')
          }}
        >
          {!detail && (
            <Action
              label="Show all devices"
              secondary
              onPress={() => {
                onSelectSource('all')
                setOpen(false)
              }}
            />
          )}
          {!detail ? (
            entries.map((entry) => (
              <Pressable
                key={entry.profile.id}
                testID={`Runtime summary ${entry.profile.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${entry.profile.name}, ${status(entry)}, ${activity(entry)}`}
                onPress={() => setSelected(entry.profile.id)}
                style={({ pressed }) => [
                  styles.listItem,
                  styles.row,
                  { minHeight: 64, flexWrap: 'nowrap', opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Icon
                  name="device"
                  size={20}
                  color={entry.connected ? colors.accent : colors.muted}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={styles.text}>{entry.profile.name}</Text>
                  <Text style={styles.muted}>
                    {status(entry)} · {activity(entry)}
                  </Text>
                </View>
                <Icon name="next" size={12} color={colors.muted} />
              </Pressable>
            ))
          ) : (
            <View style={{ gap: 12 }} testID="Runtime details">
              {compact && (
                <Action label="All computers" secondary onPress={() => setSelected('')} />
              )}
              <View style={[styles.row, { flexWrap: 'nowrap' }]}>
                <Icon
                  name="device"
                  size={22}
                  color={detail.connected ? colors.accent : colors.muted}
                />
                <Text style={styles.text}>{status(detail)}</Text>
              </View>
              <Text style={styles.text}>{activity(detail)}</Text>
              {!detail.connected && detail.snapshot && (
                <Text style={styles.muted}>Showing saved activity</Text>
              )}
              {!!detail.lastSeen && !detail.connected && (
                <Text style={styles.muted}>
                  Last connected {new Date(detail.lastSeen).toLocaleString()}
                </Text>
              )}
              <Text selectable style={styles.muted}>
                {detail.profile.connection.address}
              </Text>
              {!!detail.error && <Text style={styles.error}>{detail.error}</Text>}
              <View style={styles.separator} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open pull requests"
                onPress={() => {
                  setSelected('')
                  setOpen(false)
                  navigate('pulls')
                }}
                style={[styles.row, { minHeight: 48, flexWrap: 'nowrap' }]}
              >
                <Icon name="pulls" size={18} color={colors.accent} />
                <Text style={[styles.text, { flex: 1 }]}>
                  {detail.pulls
                    ? `${detail.pulls.needsAttention} PRs need action · ${detail.pulls.total} open${detail.pulls.partial ? '+' : ''}`
                    : 'Pull requests'}
                </Text>
                <Icon name="next" size={13} color={colors.muted} />
              </Pressable>
              {!!detail.pullError && <Text style={styles.muted}>PR summary could not refresh</Text>}
              {detail.pulls?.partial && (
                <Text style={styles.muted}>Partial results · open PRs to load more</Text>
              )}
              <View style={styles.separator} />
              <Action
                label="View tasks on this device"
                secondary
                onPress={() => {
                  onSelectSource(detail.profile.id)
                  setSelected('')
                  setOpen(false)
                }}
              />
              <Action
                label="Manage computers"
                secondary
                onPress={() => {
                  setSelected('')
                  setOpen(false)
                  navigate('settings')
                }}
              />
            </View>
          )}
        </Sheet>
      )}
    </View>
  )
}
