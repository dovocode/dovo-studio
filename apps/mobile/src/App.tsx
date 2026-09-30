import { PushNotificationProvider } from './notifications/provider'
import { colors } from './ui/theme'
import { RegistryProvider } from '@effect-atom/atom-react'
import { LiveActivityProvider } from './live-activities/provider'
import { DarkTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RuntimeProvider } from './runtime/connection/provider'
import { Workbench } from './shell/workbench'
import { LinkBrowser } from './ui/content/open-link'
import { TaskWidgetProvider } from './widgets/provider'
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
}
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ThemeProvider value={theme}>
        <RegistryProvider>
          <RuntimeProvider>
            <PushNotificationProvider>
              <LiveActivityProvider>
                <TaskWidgetProvider>
                  <Workbench />
                  <LinkBrowser />
                </TaskWidgetProvider>
              </LiveActivityProvider>
            </PushNotificationProvider>
          </RuntimeProvider>
        </RegistryProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
