import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { useNavigation } from '../../shell/navigation'

const subscribe = (notify: () => void) => {
  const subscription = AppState.addEventListener('change', notify)
  return () => subscription.remove()
}
// Native prompts temporarily mark the app inactive; preserve the preview through those.
const foreground = () => AppState.currentState === 'active' || AppState.currentState === 'inactive'

export function usePreviewActive(keepWhilePicking = false) {
  const { focused } = useNavigation()
  const appForeground = useSyncExternalStore(subscribe, foreground, foreground)
  return focused && (appForeground || keepWhilePicking)
}
