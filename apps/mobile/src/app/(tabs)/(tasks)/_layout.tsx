import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { TaskPaneLayout } from '../../../shell/task-pane-layout'
import { NavigationStack } from '../../../ui/layout/navigation-stack'
export { RouteError as ErrorBoundary } from '../../../ui/layout/route-error'

export const unstable_settings = { anchor: 'index' }

export default function Layout() {
  const uiText = useInterfaceText()

  return (
    <TaskPaneLayout>
      <NavigationStack title={uiText('Threads')} />
    </TaskPaneLayout>
  )
}
