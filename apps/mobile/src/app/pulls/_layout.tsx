import { NavigationStack } from '../../ui/layout/navigation-stack'
export { RouteError as ErrorBoundary } from '../../ui/layout/route-error'

export const unstable_settings = { anchor: 'index' }

export default function Layout() {
  return <NavigationStack title="Pull requests" />
}
