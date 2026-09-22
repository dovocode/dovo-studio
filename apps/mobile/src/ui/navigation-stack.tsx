import { Stack } from 'expo-router'
import { Platform } from 'react-native'
import { colors } from './theme'

export function NavigationStack({ title }: { title: string }) {
  return (
    <Stack
      screenOptions={{
        title,
        headerShown: Platform.OS === 'ios',
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
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
