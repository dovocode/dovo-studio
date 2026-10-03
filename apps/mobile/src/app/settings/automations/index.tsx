import { router } from 'expo-router'
import JobsScreen from '../../../screens/jobs'
import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { ScreenBackContext } from '../../../ui/layout/screen-header'
export default function AutomationsRoute() {
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      <ScreenBackContext.Provider value={() => router.dismissTo('/settings')}>
        <JobsScreen />
      </ScreenBackContext.Provider>
    </WorkbenchDetailRoute>
  )
}
