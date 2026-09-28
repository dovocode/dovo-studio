import { WorkbenchTaskRoute } from '../../shell/workbench'
import { NewTaskScreen } from '../../tasks/detail/task-route-screen'
export default function NewTaskRoute() {
  return (
    <WorkbenchTaskRoute>
      <NewTaskScreen />
    </WorkbenchTaskRoute>
  )
}
