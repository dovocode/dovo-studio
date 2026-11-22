import { openExtensionPage } from './extension-page-route'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { useCarMode, useMobilePreferences } from '../runtime/preferences/app-preferences'
import type { HeaderAction } from '../ui/layout/screen-header'
import type { StudioNavigation } from './navigation'

export function useMoreActions(navigate: StudioNavigation['navigate']): HeaderAction[] {
  const uiText = useInterfaceText()

  const { overviews, activeId, snapshot } = useRuntime()
  const car = useCarMode()
  const { botsOverviewEnabled } = useMobilePreferences()
  const destinations: HeaderAction[] = [
    { label: uiText('Threads'), icon: 'tasks', onPress: () => navigate('tasks') },
    ...(!car && botsOverviewEnabled && overviews.some((entry) => entry.snapshot?.botsSupported)
      ? [{ label: uiText('Bots'), icon: 'bot' as const, onPress: () => navigate('bots') }]
      : []),
    ...(!car
      ? [{ label: uiText('Issues'), icon: 'issues' as const, onPress: () => navigate('issues') }]
      : []),
    ...(!car && overviews.some((entry) => entry.snapshot?.artifactsEnabled)
      ? [
          {
            label: uiText('Artifacts'),
            icon: 'artifact' as const,
            onPress: () => navigate('artifacts'),
          },
        ]
      : []),
    ...(!car && overviews.some((entry) => entry.snapshot?.dashboardsSupported)
      ? [
          {
            label: uiText('Dashboards'),
            icon: 'artifact' as const,
            onPress: () => navigate('dashboards'),
          },
        ]
      : []),
    ...(!car && activeId
      ? (snapshot?.studioExtensionPinnedPages ?? []).map((page) => ({
          label: page.title,
          icon: 'artifact' as const,
          onPress: () => openExtensionPage(activeId, page.extensionId, page.pageId),
        }))
      : []),
    { label: uiText('Settings'), icon: 'settings', onPress: () => navigate('settings') },
  ]
  return destinations.map((action) => ({ ...action, overflow: true, group: 'Navigation' }))
}
