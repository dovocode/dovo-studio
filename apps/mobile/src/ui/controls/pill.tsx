import { useInterfaceText } from '@dovo/studio-core/interface-language'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native'
import { designTokens } from '@dovo/design'
import { Text } from '../content/text'
import { Icon, type IconName } from './icon'
import { IconButton } from './icon-button'
import { useTheme, type MobileColors } from '../theme'
import { Glass } from '../layout/glass'

const pillStyle = (pressed: boolean, colors: MobileColors): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  minHeight: designTokens.touchTarget,
  paddingHorizontal: 18,
  borderRadius: designTokens.touchTarget / 2,
  backgroundColor: pressed ? colors.selection : 'transparent',
})

/** Floating status capsule. Native glass keeps an opaque accessibility fallback. */
export function Pill({
  label,
  icon,
  busy = false,
  onPress,
  onLongPress,
  onDismiss,
  accessibilityHint,
  testID,
  children,
}: {
  label: string
  icon?: IconName
  busy?: boolean
  onPress: () => void
  onLongPress?: () => void
  onDismiss?: () => void
  accessibilityHint?: string
  testID?: string
  children?: ReactNode
}) {
  const uiText = useInterfaceText()

  const { colors, highContrast } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%' }}>
      <Glass
        interactive
        style={{
          flexShrink: 1,
          borderRadius: designTokens.touchTarget / 2,
          shadowColor: '#000',
          shadowOpacity: highContrast ? 0 : 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={onPress}
          onLongPress={onLongPress}
          style={({ pressed }) => [pillStyle(pressed, colors), { flexShrink: 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            icon && <Icon name={icon} size={16} color={colors.text} />
          )}
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: 16, lineHeight: 20, flexShrink: 1 }}
          >
            {label}
          </Text>
          {children}
        </Pressable>
      </Glass>
      {onDismiss && (
        <IconButton
          icon="close"
          label={uiText('Dismiss {value0}', { value0: label })}
          onPress={onDismiss}
        />
      )}
    </View>
  )
}
