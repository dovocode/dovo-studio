import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Alert, Pressable } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
export type WorkMenuAction = {
  label: string
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
}
export function WorkMenu({
  actions,
  label: labelOverride,
}: {
  actions: WorkMenuAction[]
  label?: string
}) {
  const uiText = useInterfaceText()
  const label = labelOverride ?? uiText('Work actions')

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
        Alert.alert(uiText('Actions'), undefined, [
          ...actions
            .filter((action) => !action.disabled)
            .map(({ label, onPress, destructive }) => ({
              text: label,
              onPress,
              style: destructive ? ('destructive' as const) : ('default' as const),
            })),
          { text: uiText('Cancel'), style: 'cancel' },
        ])
      }
    >
      <Text style={{ color: colors.text, fontSize: 22 }}>···</Text>
    </Pressable>
  )
}
