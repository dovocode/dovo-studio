import AppUpdates from '../../screens/app-updates'
import GeneralScreen from '../../screens/general'
import { router, useLocalSearchParams } from 'expo-router'
import { Platform, View } from 'react-native'
import AgentsScreen from '../../screens/agents'
import DevicesScreen from '../../screens/devices'
import ResourcesScreen from '../../screens/resources'
import SourceControlSettings from '../../scm/connections'
import { WorkbenchDetailRoute } from '../../shell/workbench'
import { Action } from '../../ui/action'
import { ScreenHeader } from '../../ui/screen-header'
import { styles } from '../../ui/theme'

export default function SettingsSection() {
  const { section } = useLocalSearchParams<{ section: string }>()
  const Screen =
    section === 'updates'
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
                : undefined
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      {Platform.OS !== 'ios' && (
        <Action secondary label="Back to Settings" onPress={() => router.dismissTo('/settings')} />
      )}
      {Screen ? (
        <Screen />
      ) : (
        <View style={styles.screen}>
          <ScreenHeader title="Settings" />
          <Action label="Back to Settings" onPress={() => router.dismissTo('/settings')} />
        </View>
      )}
    </WorkbenchDetailRoute>
  )
}
