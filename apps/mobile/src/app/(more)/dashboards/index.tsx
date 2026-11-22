import { SettingsDraftRoute } from '../../../runtime/preferences/settings-draft-route'
import { WorkbenchScene } from '../../../shell/workbench'

export default function DashboardsRoute() {
  return (
    <SettingsDraftRoute>
      <WorkbenchScene tab="dashboards" />
    </SettingsDraftRoute>
  )
}
