import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { NavigationStack } from '../../../ui/layout/navigation-stack'
import { SettingsTheme } from '../../../screens/settings-theme'
export { RouteError as ErrorBoundary } from '../../../ui/layout/route-error'

export const unstable_settings = { anchor: 'index' }

export default function Layout() {
  const uiText = useInterfaceText()

  return (
    <SettingsTheme>
      <NavigationStack title={uiText('Settings')} />
    </SettingsTheme>
  )
}
