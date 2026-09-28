import { WorkbenchDetailRoute } from '../../../../../shell/workbench'
import { PullRouteScreen } from '../../../../../scm/pulls/list/pull-route-screen'

export default function PullRoute() {
  return (
    <WorkbenchDetailRoute tab="pulls">
      <PullRouteScreen />
    </WorkbenchDetailRoute>
  )
}
