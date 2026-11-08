import { NavigationStack } from '../../../ui/layout/navigation-stack'
import { SettingsTheme } from '../../../screens/settings-theme'
export { RouteError as ErrorBoundary } from '../../../ui/layout/route-error'

export const unstable_settings = { anchor: 'index' }

export default function Layout() {
  return (
    <SettingsTheme>
      <NavigationStack title="Settings" />
    </SettingsTheme>
  )
}
