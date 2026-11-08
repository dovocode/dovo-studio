import { View } from 'react-native'
import type { Task, RuntimeIcon as RuntimeIconName } from '@dovo/protocol'
import { RuntimeIcon } from '../../ui/content/runtime-icon'
import { useTheme } from '../../ui/theme'

export function DeviceLabel({
  task,
  runtimeHost,
  runtimeIcon,
  size = 12,
}: {
  task: Task
  runtimeIcon?: RuntimeIconName
  runtimeHost?: string
  size?: number
}) {
  const { colors } = useTheme()

  const turn = task.turns?.at(-1)
  const host = runtimeHost ?? turn?.runtimeHost
  const prefix = turn ? (turn.status === 'running' ? 'Running on' : 'Last ran on') : 'Runs on'
  const label = host ? `${prefix} ${host}` : 'Execution device unknown'
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <RuntimeIcon icon={runtimeIcon} size={size} color={colors.muted} />
    </View>
  )
}
