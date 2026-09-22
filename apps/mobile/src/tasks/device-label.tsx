import { View } from 'react-native'
import { Text } from '../ui/text'
import type { Task } from '@dovo/protocol'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'

export function DeviceLabel({
  task,
  runtimeHost,
  compact = false,
}: {
  task: Task
  runtimeHost?: string
  compact?: boolean
}) {
  const turn = task.turns?.at(-1)
  const host = turn ? turn.runtimeHost : runtimeHost
  const prefix = turn ? (turn.status === 'running' ? 'Running on' : 'Last ran on') : 'Runs on'
  const label = host ? `${prefix} ${host}` : 'Execution device unknown'
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}
    >
      <Icon name="device" size={13} color={colors.muted} />
      <Text numberOfLines={compact ? 1 : 2} style={[styles.muted, { flexShrink: 1 }]}>
        {compact ? (host ?? 'Unknown device') : label}
      </Text>
    </View>
  )
}
