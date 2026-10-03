import { WorkbenchDetailRoute } from '../../../../shell/workbench'
import { AutomationRouteScreen } from '../../../../jobs/automation-route-screen'
export default function AutomationRoute() {
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      <AutomationRouteScreen />
    </WorkbenchDetailRoute>
  )
}
