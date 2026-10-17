import { router } from 'expo-router'
import DoScreen from '../../screens/do'
import { WorkbenchDetailRoute } from '../../shell/workbench'
import { ScreenBackContext } from '../../ui/layout/screen-header'

export default function DoRoute() {
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      <ScreenBackContext.Provider value={() => router.dismissTo('/settings')}>
        <DoScreen />
      </ScreenBackContext.Provider>
    </WorkbenchDetailRoute>
  )
}
