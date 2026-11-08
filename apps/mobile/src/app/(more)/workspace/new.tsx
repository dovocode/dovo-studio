import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { WorkspaceStarter } from '../../../workspace/workspace-starter'
export default function Route() {
  return (
    <WorkbenchDetailRoute tab="workspace" bottomInset>
      <WorkspaceStarter initialMode="auto" />
    </WorkbenchDetailRoute>
  )
}
