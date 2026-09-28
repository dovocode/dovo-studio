import { WorkbenchTaskRoute } from '../../../../shell/workbench'
import { TaskRouteScreen } from '../../../../tasks/detail/task-route-screen'
export default function ThreadRoute() {
  return (
    <WorkbenchTaskRoute>
      <TaskRouteScreen />
    </WorkbenchTaskRoute>
  )
}
