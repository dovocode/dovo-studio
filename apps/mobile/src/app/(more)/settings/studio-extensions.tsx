import { SettingsDraftRoute } from '../../../runtime/preferences/settings-draft-route'
import { router } from 'expo-router'
import StudioExtensionsScreen from '../../../screens/studio-extensions'
import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { ScreenBackContext } from '../../../ui/layout/screen-header'

export default function StudioExtensionsRoute() {
  return (
    <SettingsDraftRoute>
      <WorkbenchDetailRoute tab="settings" bottomInset>
        <ScreenBackContext.Provider
          value={() => {
            if (router.canGoBack()) router.back()
            else router.dismissTo('/settings')
          }}
        >
          <StudioExtensionsScreen />
        </ScreenBackContext.Provider>
      </WorkbenchDetailRoute>
    </SettingsDraftRoute>
  )
}
