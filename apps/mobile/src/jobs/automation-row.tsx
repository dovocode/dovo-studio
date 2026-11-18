import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  automationBotJobSummary,
  type Automation,
  type RuntimeReachability,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/content/text'
import { Icon } from '../ui/controls/icon'
import { useTheme } from '../ui/theme'
import { triggerSummary } from './linear-flow'
import type { automationRowState } from './automation-summary'
import { Action } from '../ui/controls/action'

export function AutomationRow({
  flow,
  snapshot,
  onOpen,
  onOpenRun,
  state,
  disabled = false,
  runtimeName,
  reachability = 'online',
}: {
  flow: Automation
  snapshot: RuntimeSnapshot
  onOpen: () => void
  onOpenRun: (runId: string) => void
  state: ReturnType<typeof automationRowState>
  disabled?: boolean
  runtimeName?: string
  reachability?: RuntimeReachability
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const botJob = automationBotJobSummary(flow, snapshot.workspace.tasks)

  const { latest, summary, needsAttention } = state
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')
  const paused = trigger?.data.trigger !== 'manual' && !flow.enabled
  const policy = paused ? uiText('Triggers paused') : triggerSummary(flow)
  const status =
    latest?.status === 'failed' && !latest.interrupted && !summary?.needsInput
      ? uiText('Last run failed')
      : uiText(summary?.status ?? 'Not run yet')
  const sourceStatus =
    reachability === 'offline'
      ? uiText('Offline')
      : reachability === 'connecting'
        ? uiText('Connecting…')
        : ''
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Pressable
        testID={`Automation row ${flow.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${flow.name}. ${botJob ? `${botJob}. ` : ''}${runtimeName ? `${runtimeName}${sourceStatus ? `, ${sourceStatus}` : ''}. ` : ''}${status}. ${policy}. ${progress}`}
        accessibilityHint={uiText('Open automation runs and controls.')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 10,
          minHeight: 64,
          flex: 1,
          minWidth: 0,
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
          {botJob && (
            <Text numberOfLines={2} style={styles.muted}>
              {botJob}
            </Text>
          )}
          <Text numberOfLines={1} style={styles.muted}>
            {policy}
          </Text>
          <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }]}>
            {progress}
            {runtimeName ? ` · ${runtimeName}` : ''}
            {sourceStatus ? ` · ${sourceStatus}` : ''}
          </Text>
        </View>
        {!needsAttention && <Icon name="next" size={12} color={colors.muted} />}
      </Pressable>
      {needsAttention && latest && (
        <Action
          secondary
          disabled={disabled}
          label={uiText('View run')}
          onPress={() => onOpenRun(latest.id)}
        />
      )}
    </View>
  )
}
