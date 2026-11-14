import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { NavigationStack } from '../../../ui/layout/navigation-stack'
export { RouteError as ErrorBoundary } from '../../../ui/layout/route-error'
export const unstable_settings = { anchor: 'index' }
export default function Layout() {
  const uiText = useInterfaceText()

  return <NavigationStack title={uiText('Artifacts')} />
}
