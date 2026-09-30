import { WorkbenchTaskRoute } from '../../shell/workbench'
import { TaskLauncherScreen } from '../../tasks/creation/task-launcher-screen'
export default function TaskLauncherRoute() {
  return (
    <WorkbenchTaskRoute>
      <TaskLauncherScreen />
    </WorkbenchTaskRoute>
  )
}
