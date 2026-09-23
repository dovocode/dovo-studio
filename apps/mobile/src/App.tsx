import { colors } from './ui/theme'
import { RegistryProvider } from '@effect-atom/atom-react'
import { LiveActivityProvider } from './live-activities/provider'
import { DarkTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RuntimeProvider } from './runtime/provider'
import { Workbench } from './shell/workbench'
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
            <LiveActivityProvider>
              <Workbench />
            </LiveActivityProvider>
          </RuntimeProvider>
        </RegistryProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
