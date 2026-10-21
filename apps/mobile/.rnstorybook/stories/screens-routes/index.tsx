import { useLocalSearchParams } from 'expo-router'
import { MobileScreen, isMobileCatalogScreen } from '../../../src/catalog/screens'
export default function CatalogScreenRoute() {
  const { screen, state } = useLocalSearchParams<{ screen?: string; state?: string }>()
  return (
    <MobileScreen
      screen={screen && isMobileCatalogScreen(screen) ? screen : 'settings'}
      state={
        state === 'offline' || state === 'populated' || state === 'error' || state === 'loading'
          ? state
          : 'empty'
      }
    />
  )
}
