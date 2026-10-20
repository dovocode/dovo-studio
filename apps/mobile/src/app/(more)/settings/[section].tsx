import type { ComponentType } from 'react'
import SettingsScreen from '../../../screens/settings'
import TaskDefaultsScreen from '../../../screens/task-defaults'
import AppUpdates from '../../../screens/app-updates'
import UsageScreen from '../../../screens/usage'
import GeneralScreen, {
  BatterySettingsScreen,
  ConversationSettingsScreen,
  SpeechSettingsScreen,
  TaskPreferencesScreen,
} from '../../../screens/general'
import NotificationsSettingsScreen from '../../../screens/settings-notifications'
import {
  TaskBehaviorSettingsScreen,
  PullSettingsScreen,
  RuntimeToolsSettingsScreen,
  ArtifactSettingsScreen,
  MemorySettingsScreen,
  WorktreeSettingsScreen,
  ActivitySettingsScreen,
} from '../../../screens/settings-computer'
import AppearanceScreen from '../../../screens/appearance'
import { router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import AgentsScreen from '../../../screens/agents'
import DevicesScreen from '../../../screens/devices'
import DeviceHostsScreen from '../../../screens/device-host-settings'
import ResourcesScreen from '../../../screens/resources'
import SourceControlSettings from '../../../scm/connections/connections'
import { WorkbenchDetailRoute } from '../../../shell/workbench'
import { Action } from '../../../ui/controls/action'
import { ScreenBackContext, ScreenHeader } from '../../../ui/layout/screen-header'
import { useTheme } from '../../../ui/theme'

const screens: Readonly<Partial<Record<string, ComponentType>>> = {
  'app-preferences': () => <SettingsScreen categorySlug="app-preferences" />,
  'agent-settings': () => <SettingsScreen categorySlug="agent-settings" />,
  'task-settings': () => <SettingsScreen categorySlug="task-settings" />,
  'computer-settings': () => <SettingsScreen categorySlug="computer-settings" />,
  'history-settings': () => <SettingsScreen categorySlug="history-settings" />,
  'device-hosts': DeviceHostsScreen,
  appearance: AppearanceScreen,
  'task-defaults': TaskDefaultsScreen,
  updates: AppUpdates,
  general: GeneralScreen,
  devices: DevicesScreen,
  agents: AgentsScreen,
  resources: ResourcesScreen,
  'source-control': SourceControlSettings,
  usage: UsageScreen,
  notifications: NotificationsSettingsScreen,
  battery: BatterySettingsScreen,
  'task-behavior': TaskBehaviorSettingsScreen,
  'pull-requests': PullSettingsScreen,
  'runtime-tools': RuntimeToolsSettingsScreen,
  artifacts: ArtifactSettingsScreen,
  memory: MemorySettingsScreen,
  worktrees: WorktreeSettingsScreen,
  'activity-retention': ActivitySettingsScreen,
  conversation: ConversationSettingsScreen,
  speech: SpeechSettingsScreen,
  'task-preferences': TaskPreferencesScreen,
}

export default function SettingsSection() {
  const { styles } = useTheme()

  const { section } = useLocalSearchParams<{ section: string }>()
  const Screen = Object.hasOwn(screens, section) ? screens[section] : undefined
  return (
    <WorkbenchDetailRoute tab="settings" bottomInset>
      {Screen ? (
        <ScreenBackContext.Provider
          value={() => {
            if (router.canGoBack()) router.back()
            else router.dismissTo('/settings')
          }}
        >
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
