import { Pressable } from 'react-native'
import { Text } from '../../ui/content/text'
import type { Task } from '@dovo/protocol'
import type { TaskLifecycle } from '../detail/use-task-lifecycle'
import { useTheme } from '../../ui/theme'

export type TaskRowMenuProps = {
  task: Task
  actions: TaskLifecycle
  testID: string
  disabled: boolean
  onOpen: () => void
  onDetails: () => void
}

export function TaskRowMenu({ task, testID, disabled, onDetails }: TaskRowMenuProps) {
  const { colors, styles } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityLabel={`Actions for ${task.title}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onDetails}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surface : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={[styles.muted, { fontSize: 14 }]}>•••</Text>
    </Pressable>
  )
}
