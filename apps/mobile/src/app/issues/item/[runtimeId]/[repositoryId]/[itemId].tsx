import { WorkbenchDetailRoute } from '../../../../../shell/workbench'
import { WorkItemRoute } from '../../../../../scm/work-item-route'

export default function WorkRoute() {
  return (
    <WorkbenchDetailRoute tab="issues" bottomInset>
      <WorkItemRoute mode="issues" />
    </WorkbenchDetailRoute>
  )
}
