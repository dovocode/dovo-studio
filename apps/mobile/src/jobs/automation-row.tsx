import type { Automation, RuntimeSnapshot } from '@dovo/protocol'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'
import { triggerSummary } from './linear-flow'
import { automationRuns, automationRunSummary } from './automation-summary'

export function AutomationRow({
  flow,
  snapshot,
  onOpen,
  disabled = false,
  runtimeName,
  online = true,
}: {
  flow: Automation
  snapshot: RuntimeSnapshot
  onOpen: () => void
  disabled?: boolean
  runtimeName?: string
  online?: boolean
}) {
  const { latest } = automationRuns(flow.id, snapshot.runs)
  const summary = latest
    ? automationRunSummary(
        latest,
        new Set([...snapshot.questions, ...snapshot.approvals].map((request) => request.taskId)),
      )
    : null
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')
  const paused = trigger?.data.trigger !== 'manual' && !flow.enabled
  const status = summary?.status ?? 'Not run yet'
  const color =
    summary?.needsInput || latest?.status === 'waiting'
      ? colors.accent
      : latest?.status === 'failed'
        ? colors.error
        : colors.muted
  const steps = flow.nodes.filter((node) => node.data.kind !== 'trigger').length
  const progress = summary
    ? [summary.current?.label, summary.progress].filter(Boolean).join(' · ')
    : `${steps} ${steps === 1 ? 'step' : 'steps'}`
  return (
    <Pressable
      testID={`Automation row ${flow.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${flow.name}. ${runtimeName ? `${runtimeName}${online ? '' : ', offline'}. ` : ''}${status}. ${triggerSummary(flow)}${paused ? ', paused' : ''}. ${progress}`}
      accessibilityHint="Open automation runs and controls."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        minHeight: 84,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="jobs" size={21} color={color} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: 8,
            rowGap: 2,
          }}
        >
          <Text
            numberOfLines={2}
            style={[styles.text, { flexGrow: 1, flexShrink: 1, fontWeight: '600' }]}
          >
            {flow.name}
          </Text>
          <Text style={[styles.muted, { color, fontSize: 13 }]}>{status}</Text>
        </View>
        <Text numberOfLines={1} style={styles.muted}>
          {triggerSummary(flow)}
          {paused ? ' · Paused' : ''}
        </Text>
        <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }]}>
          {progress}
          {runtimeName ? ` · ${runtimeName}${online ? '' : ' · Offline'}` : ''}
        </Text>
      </View>
      <Icon name="next" size={12} color={colors.muted} />
    </Pressable>
  )
}
