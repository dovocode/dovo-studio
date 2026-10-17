import { router, useLocalSearchParams } from 'expo-router'
import DoPlansScreen from '../../screens/do-plans'
import { WorkbenchDetailRoute } from '../../shell/workbench'
import { ScreenBackContext } from '../../ui/layout/screen-header'

export default function DoPlansRoute() {
  const { runtimeId, runId } = useLocalSearchParams<{
    runtimeId?: string | string[]
    runId?: string | string[]
  }>()
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      <ScreenBackContext.Provider
        value={() => (router.canGoBack() ? router.back() : router.replace('/settings/do'))}
      >
        <DoPlansScreen
          key={JSON.stringify([runtimeId, runId])}
          runtimeId={typeof runtimeId === 'string' ? runtimeId : undefined}
          runId={typeof runId === 'string' ? runId : undefined}
        />
      </ScreenBackContext.Provider>
    </WorkbenchDetailRoute>
  )
}
