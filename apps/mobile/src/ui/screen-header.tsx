import { useContext, type ReactNode } from 'react'
import { Stack } from 'expo-router'
import { Platform, View } from 'react-native'
import { NavigationContext } from '../shell/navigation'
import { useInsideSheet } from './sheet'
import { symbols, type IconName } from './icon'
import { IconButton } from './icon-button'
import { Text } from './text'
import { colors } from './theme'

export type HeaderAction = {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}

/** UIKit owns navigation sizing, button grouping and back gestures on iOS. */
export function ScreenHeader({
  title,
  subtitle,
  leading,
  actions,
  buttons,
  testID,
  onBack,
  gestureEnabled = true,
  hidden = false,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  actions?: ReactNode
  buttons?: HeaderAction[]
  testID?: string
  onBack?: () => void
  gestureEnabled?: boolean
  hidden?: boolean
}) {
  const navigation = useContext(NavigationContext)
  const inSheet = useInsideSheet()
  if (Platform.OS === 'ios' && !inSheet) {
    // PRs and pipelines keep their content mounted; only the visible collection owns the bar.
    if (navigation && !navigation.focused) return null
    if (hidden)
      return (
        <Stack.Screen
          options={{ headerShown: false, gestureEnabled: false, fullScreenGestureEnabled: false }}
        />
      )
    return (
      <>
        <Stack.Screen
          options={{
            title,
            headerShown: true,
            headerBackVisible: !onBack,
            gestureEnabled,
            fullScreenGestureEnabled: gestureEnabled ? undefined : false,
          }}
        />
        {!!onBack && (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Back" onPress={onBack}>
              Back
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        )}
        <Stack.Toolbar placement="right">
          {buttons?.map((button) => (
            <Stack.Toolbar.Button
              key={button.label}
              icon={symbols[button.icon][0]}
              accessibilityLabel={button.label}
              disabled={button.disabled}
              selected={button.selected}
              tintColor={button.selected ? colors.accent : colors.text}
              onPress={button.onPress}
            >
              {button.label}
            </Stack.Toolbar.Button>
          ))}
          {!!actions && (
            <Stack.Toolbar.View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{actions}</View>
            </Stack.Toolbar.View>
          )}
        </Stack.Toolbar>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={{ color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 6 }}
          >
            {subtitle}
          </Text>
        )}
      </>
    )
  }
  if (hidden) return null
  return (
    <View
      testID="Screen header"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 6,
        gap: 10,
      }}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          testID={testID}
          accessibilityRole="header"
          numberOfLines={2}
          style={{ color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 }}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            accessibilityLabel={subtitle}
            style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {(!!actions || !!buttons?.length) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 2 }}>
          {buttons?.map((button) => (
            <IconButton key={button.label} {...button} />
          ))}
          {actions}
        </View>
      )}
    </View>
  )
}
