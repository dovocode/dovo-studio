import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import type { Task, RuntimeIcon as RuntimeIconName } from '@dovo/protocol'
import { RuntimeIcon } from '../../ui/content/runtime-icon'
import { useTheme } from '../../ui/theme'

export function DeviceLabel({
  task,
  runtimeHost,
  runtimeIcon,
  compact = false,
}: {
  task: Task
  runtimeIcon?: RuntimeIconName
  runtimeHost?: string
  compact?: boolean
}) {
  const { colors, styles } = useTheme()

  const turn = task.turns?.at(-1)
  const host = runtimeHost ?? turn?.runtimeHost
  const prefix = turn ? (turn.status === 'running' ? 'Running on' : 'Last ran on') : 'Runs on'
  const label = host ? `${prefix} ${host}` : 'Execution device unknown'
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}
    >
      <RuntimeIcon icon={runtimeIcon} size={13} color={colors.muted} />
      <Text numberOfLines={compact ? 1 : 2} style={[styles.muted, { flexShrink: 1 }]}>
        {compact ? (host ?? 'Unknown device') : label}
      </Text>
    </View>
  )
}
