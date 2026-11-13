import { useRuntime } from '../runtime/connection/provider'
import {
  useCarMode,
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import type { HeaderAction } from '../ui/layout/screen-header'
import type { StudioNavigation } from './navigation'

export function useMoreActions(navigate: StudioNavigation['navigate']): HeaderAction[] {
  const { overviews } = useRuntime()
  const car = useCarMode()
  const {
    browserWorkspaceEnabled,
    terminalWorkspaceEnabled,
    unifiedWorkspaceEnabled,
    unifiedWorkspaceActive,
    hideNormalWorkspaceModes,
  } = useMobilePreferences()
  const normal =
    !car && !(unifiedWorkspaceEnabled && unifiedWorkspaceActive && hideNormalWorkspaceModes)
  const destinations: HeaderAction[] = [
    ...(!car && unifiedWorkspaceEnabled
      ? [
          {
            label: 'Unified',
            icon: 'stack' as const,
            onPress: () => {
              updateMobilePreferences({ unifiedWorkspaceActive: true })
              navigate('tasks')
            },
          },
        ]
      : []),
    ...(normal
      ? [
          {
            label: 'Threads',
            icon: 'tasks' as const,
            onPress: () => {
              updateMobilePreferences({ unifiedWorkspaceActive: false })
              navigate('tasks')
            },
          },
        ]
      : []),
    ...(normal && terminalWorkspaceEnabled
      ? [
          {
            label: 'Terminals',
            icon: 'terminal' as const,
            onPress: () => {
              updateMobilePreferences({ unifiedWorkspaceActive: false })
              navigate('terminal')
            },
          },
        ]
      : []),
    ...(normal && browserWorkspaceEnabled
      ? [
          {
            label: 'Browser',
            icon: 'web' as const,
            onPress: () => {
              updateMobilePreferences({ unifiedWorkspaceActive: false })
              navigate('browser')
            },
          },
        ]
      : []),
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
