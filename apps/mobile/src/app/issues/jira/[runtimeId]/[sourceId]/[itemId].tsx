import { WorkbenchDetailRoute } from '../../../../../shell/workbench'
import { WorkItemRoute } from '../../../../../scm/work/work-item-route'

export default function JiraIssueRoute() {
  return (
    <WorkbenchDetailRoute tab="issues" bottomInset>
      <WorkItemRoute mode="issues" jira />
    </WorkbenchDetailRoute>
  )
}
