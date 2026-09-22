import { LiveActivityProvider } from './live-activities/provider'
import { DarkTheme, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RuntimeProvider } from './runtime/provider'
import { Workbench } from './shell/workbench'
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ThemeProvider value={DarkTheme}>
        <RuntimeProvider>
          <LiveActivityProvider>
            <Workbench />
          </LiveActivityProvider>
        </RuntimeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
