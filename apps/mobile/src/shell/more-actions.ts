import { useRuntime } from '../runtime/connection/provider'
import { useCarMode, useMobilePreferences } from '../runtime/preferences/app-preferences'
import type { HeaderAction } from '../ui/layout/screen-header'
import type { StudioNavigation } from './navigation'

export function useMoreActions(navigate: StudioNavigation['navigate']): HeaderAction[] {
  const { overviews } = useRuntime()
  const car = useCarMode()
  const { browserWorkspaceEnabled } = useMobilePreferences()
  const destinations: HeaderAction[] = [
    ...(!car && browserWorkspaceEnabled
      ? [{ label: 'Browser', icon: 'web' as const, onPress: () => navigate('browser') }]
      : []),
    ...(!car
      ? [{ label: 'Issues', icon: 'issues' as const, onPress: () => navigate('issues') }]
      : []),
    ...(!car && overviews.some((entry) => entry.snapshot?.artifactsEnabled)
      ? [{ label: 'Artifacts', icon: 'artifact' as const, onPress: () => navigate('artifacts') }]
      : []),
    { label: 'Settings', icon: 'settings', onPress: () => navigate('settings') },
  ]
  return destinations.map((action) => ({ ...action, overflow: true, group: 'Navigation' }))
}
