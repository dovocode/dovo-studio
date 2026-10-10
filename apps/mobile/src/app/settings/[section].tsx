import TaskDefaultsScreen from '../../screens/task-defaults'
import AppUpdates from '../../screens/app-updates'
import UsageScreen from '../../screens/usage'
import GeneralScreen from '../../screens/general'
import AppearanceScreen from '../../screens/appearance'
import { router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import AgentsScreen from '../../screens/agents'
import DevicesScreen from '../../screens/devices'
import DeviceHostsScreen from '../../screens/device-host-settings'
import ResourcesScreen from '../../screens/resources'
import SourceControlSettings from '../../scm/connections/connections'
import { WorkbenchDetailRoute } from '../../shell/workbench'
import { Action } from '../../ui/controls/action'
import { ScreenBackContext, ScreenHeader } from '../../ui/layout/screen-header'
import { useTheme } from '../../ui/theme'

export default function SettingsSection() {
  const { styles } = useTheme()

  const { section } = useLocalSearchParams<{ section: string }>()
  const Screen =
    section === 'device-hosts'
      ? DeviceHostsScreen
      : section === 'appearance'
        ? AppearanceScreen
        : section === 'task-defaults'
          ? TaskDefaultsScreen
          : section === 'updates'
            ? AppUpdates
            : section === 'general'
              ? GeneralScreen
              : section === 'devices'
                ? DevicesScreen
                : section === 'agents'
                  ? AgentsScreen
                  : section === 'resources'
                    ? ResourcesScreen
                    : section === 'source-control'
                      ? SourceControlSettings
                      : section === 'usage'
                        ? UsageScreen
                        : undefined
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      {Screen ? (
        <ScreenBackContext.Provider value={() => router.dismissTo('/settings')}>
          <Screen />
        </ScreenBackContext.Provider>
      ) : (
        <View style={styles.screen}>
          <ScreenHeader title="Settings" />
          <Action label="Back to Settings" onPress={() => router.dismissTo('/settings')} />
        </View>
      )}
    </WorkbenchDetailRoute>
  )
}
