import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { BrowserScreen } from '../../../browser/browser-screen'
export default function Route() {
  return (
    <WorkbenchDetailRoute tab="workspace" bottomInset>
      <BrowserScreen unified />
    </WorkbenchDetailRoute>
  )
}
