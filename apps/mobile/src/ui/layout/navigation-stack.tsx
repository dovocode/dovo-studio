import { Stack } from 'expo-router'
import { Platform } from 'react-native'
import { useTheme } from '../theme'

export function NavigationStack({
  title,
  headerShown = Platform.OS === 'ios',
}: {
  title: string
  headerShown?: boolean
}) {
  const { colors, mode } = useTheme()

  return (
    <Stack
      screenOptions={{
        title,
        headerShown,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        statusBarStyle: mode === 'dark' ? 'light' : 'dark',
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        gestureEnabled: true,
        // Keep UIKit's default content-pop gesture on iOS 26+, including edge swipes.
        keyboardHandlingEnabled: true,
      }}
    />
  )
}
