import { RegistryProvider } from '@effect/atom-react'
import type { Preview } from '@storybook/react-native'
import { ApplicationStateProvider } from '@dovo/studio-core/state'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ScrollView, useColorScheme } from 'react-native'
import type { ReactNode } from 'react'
import { MobileThemeContext, createMobileTheme } from '../src/ui/theme'

function NativePreview({ children }: { children: ReactNode }) {
  const mode = useColorScheme() === 'light' ? 'light' : 'dark'
  const theme = createMobileTheme('dovo', mode)
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RegistryProvider>
          <ApplicationStateProvider>
            <MobileThemeContext.Provider value={theme}>
              <ScrollView
                style={{ flex: 1, backgroundColor: theme.colors.background }}
                contentContainerStyle={{ flexGrow: 1, padding: 16 }}
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>
            </MobileThemeContext.Provider>
          </ApplicationStateProvider>
        </RegistryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
const preview: Preview = {
  decorators: [
    (Story) => (
      <NativePreview>
        <Story />
      </NativePreview>
    ),
  ],
}
export default preview
