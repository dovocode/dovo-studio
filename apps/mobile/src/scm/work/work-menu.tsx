import { Alert, Pressable } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
export type WorkMenuAction = { label: string; onPress: () => void; disabled?: boolean }
export function WorkMenu({
  actions,
  label = 'Work actions',
}: {
  actions: WorkMenuAction[]
  label?: string
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      testID={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.55 : 1,
      })}
      onPress={() =>
        Alert.alert('Actions', undefined, [
          ...actions
            .filter((action) => !action.disabled)
            .map(({ label, onPress }) => ({ text: label, onPress })),
          { text: 'Cancel', style: 'cancel' },
        ])
      }
    >
      <Text style={{ color: colors.text, fontSize: 22 }}>···</Text>
    </Pressable>
  )
}
