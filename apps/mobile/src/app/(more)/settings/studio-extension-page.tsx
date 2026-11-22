import { SettingsDraftRoute } from '../../../runtime/preferences/settings-draft-route'
import { router, useLocalSearchParams } from 'expo-router'
import { StudioExtensionPage } from '../../../screens/studio-extension-page'
import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { ScreenBackContext } from '../../../ui/layout/screen-header'

export default function StudioExtensionPageRoute() {
  const { runtimeId, extensionId, pageId } = useLocalSearchParams<{
    runtimeId?: string
    extensionId?: string
    pageId?: string
  }>()
  return (
    <SettingsDraftRoute>
      <WorkbenchDetailRoute tab="settings" bottomInset>
        <ScreenBackContext.Provider
          value={() => {
            if (router.canGoBack()) router.back()
            else router.dismissTo('/settings')
          }}
        >
          <StudioExtensionPage runtimeId={runtimeId} extensionId={extensionId} pageId={pageId} />
        </ScreenBackContext.Provider>
      </WorkbenchDetailRoute>
    </SettingsDraftRoute>
  )
}
