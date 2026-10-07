import { SettingsTargetProvider } from './runtime/preferences/settings-target'
import { PushNotificationProvider } from './notifications/provider'
import { TaskQuickActions } from './shell/task-quick-actions'
import { useTheme } from './ui/theme'
import { MobileAppearance } from './ui/appearance'
import { RegistryProvider } from '@effect/atom-react'
import { LiveActivityProvider } from './live-activities/provider'
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RuntimeProvider } from './runtime/connection/provider'
import { Workbench } from './shell/workbench'
import { LinkBrowser } from './ui/content/open-link'
import { TaskWidgetProvider } from './widgets/provider'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
export default function App() {
  return (
    <MobileAppearance>
      <ThemedApp />
    </MobileAppearance>
  )
}
function ThemedApp() {
  const { colors, mode } = useTheme()
  const base = mode === 'dark' ? DarkTheme : DefaultTheme
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <ThemeProvider value={theme}>
          <RegistryProvider>
            <RuntimeProvider>
              <SettingsTargetProvider>
                <PushNotificationProvider>
                  <LiveActivityProvider>
                    <TaskWidgetProvider>
                      <Workbench />
                      <TaskQuickActions />
                      <LinkBrowser />
                    </TaskWidgetProvider>
                  </LiveActivityProvider>
                </PushNotificationProvider>
              </SettingsTargetProvider>
            </RuntimeProvider>
          </RegistryProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
