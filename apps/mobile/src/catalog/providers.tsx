import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Platform } from 'react-native'
import type { ReactNode } from 'react'
import { RegistryProvider } from '@effect/atom-react'
import { ApplicationStateProvider } from '@dovo/studio-core/state'

/** Runtime state providers shared by the native and web mobile catalogs. */
export function MobileCatalogProviders({
  children,
  width = 390,
}: {
  children: ReactNode
  width?: number
}) {
  return (
    <SafeAreaProvider
      initialMetrics={
        Platform.OS === 'web'
          ? {
              frame: { x: 0, y: 0, width, height: 844 },
              insets: { top: 0, bottom: 0, left: 0, right: 0 },
            }
          : undefined
      }
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RegistryProvider>
          <ApplicationStateProvider>{children}</ApplicationStateProvider>
        </RegistryProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  )
}
