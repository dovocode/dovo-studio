import { WorkbenchTaskRoute } from '../../shell/workbench'
import { NewTaskScreen } from '../../tasks/task-route-screen'
export default function NewTaskRoute() {
  return (
    <WorkbenchTaskRoute>
      <NewTaskScreen />
    </WorkbenchTaskRoute>
  )
}
