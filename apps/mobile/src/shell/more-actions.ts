import { useRuntime } from '../runtime/connection/provider'
import { useCarMode } from '../runtime/preferences/app-preferences'
import type { HeaderAction } from '../ui/layout/screen-header'
import type { StudioNavigation } from './navigation'

export function useMoreActions(navigate: StudioNavigation['navigate']): HeaderAction[] {
  const { overviews } = useRuntime()
  const car = useCarMode()
  const destinations: HeaderAction[] = [
    { label: 'Tasks', icon: 'tasks', onPress: () => navigate('tasks') },
    ...(!car && overviews.some((entry) => entry.snapshot?.botsSupported)
      ? [{ label: 'Bots', icon: 'bot' as const, onPress: () => navigate('bots') }]
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
