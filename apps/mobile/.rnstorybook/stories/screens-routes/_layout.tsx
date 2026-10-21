import { CatalogNavigationTheme } from '../../../src/catalog/screens-navigation-theme'
import { Stack, useGlobalSearchParams } from 'expo-router'
import { MobileScreenProviders } from '../../../src/catalog/screens-runtime'
/** A real native stack gives production ScreenHeader its actual UIKit navigation owner. */
export default function CatalogScreenLayout() {
  const { state } = useGlobalSearchParams<{ state?: string }>()
  const fixtureState =
    state === 'offline' || state === 'populated' || state === 'error' || state === 'loading'
      ? state
      : 'empty'
  return (
    <MobileScreenProviders state={fixtureState}>
      <CatalogNavigationTheme>
        <Stack
          screenOptions={{
            title: 'Component preview',
            headerShown: true,
            headerTransparent: false,
            animation: 'none',
          }}
        />
      </CatalogNavigationTheme>
    </MobileScreenProviders>
  )
}
