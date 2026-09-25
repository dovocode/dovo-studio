import { NavigationStack } from '../../ui/navigation-stack'
export { RouteError as ErrorBoundary } from '../../ui/route-error'

export const unstable_settings = { anchor: 'index' }

export default function Layout() {
  return <NavigationStack title="Issues" />
}
