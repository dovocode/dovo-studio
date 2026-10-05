import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, type ViewStyle } from 'react-native'
import { Text } from '../content/text'
import { Icon, type IconName } from './icon'
import { useTheme, type MobileColors } from '../theme'

const pillStyle = (pressed: boolean, colors: MobileColors): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  minHeight: 38,
  paddingHorizontal: 18,
  borderRadius: 19,
  backgroundColor: pressed ? colors.selection : colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
  // Lift off the conversation without a glow.
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
})

/** Floating status capsule above the composer or tab bar: solid, hairline-bordered and short. */
export function Pill({
  label,
  icon,
  busy = false,
  onPress,
  onLongPress,
  accessibilityHint,
  testID,
  children,
}: {
  label: string
  icon?: IconName
  busy?: boolean
  onPress: () => void
  onLongPress?: () => void
  accessibilityHint?: string
  testID?: string
  children?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => pillStyle(pressed, colors)}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        icon && <Icon name={icon} size={16} color={colors.text} />
      )}
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, lineHeight: 20 }}>
        {label}
      </Text>
      {children}
    </Pressable>
  )
}
