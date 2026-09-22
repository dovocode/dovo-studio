import { WorkbenchDetailRoute } from '../../../../../shell/workbench'
import { WorkItemRoute } from '../../../../../scm/work-item-route'

export default function WorkRoute() {
  return (
    <WorkbenchDetailRoute tab="pulls" bottomInset>
      <WorkItemRoute mode="pipelines" />
    </WorkbenchDetailRoute>
  )
}
