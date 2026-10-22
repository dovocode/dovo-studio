import { useSettingsDraftState } from '../../../runtime/preferences/settings-target'
import { usePreventRemove } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'
import { SettingsSearchContext } from '../../../screens/settings-search'
import TaskLifecycleScreen from '../../../screens/task-lifecycle'
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
  'new-task-defaults': () => <SettingsScreen categorySlug="new-task-defaults" />,
  'running-task-settings': () => <SettingsScreen categorySlug="running-task-settings" />,
  'agent-settings': () => <SettingsScreen categorySlug="agent-settings" />,
  'task-settings': () => <SettingsScreen categorySlug="task-settings" />,
  'computer-settings': () => <SettingsScreen categorySlug="computer-settings" />,
  'history-settings': () => <SettingsScreen categorySlug="history-settings" />,
  'device-hosts': DeviceHostsScreen,
  appearance: AppearanceScreen,
  'task-defaults': TaskDefaultsScreen,
  'task-lifecycle': TaskLifecycleScreen,
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
  const draftFlags = useSettingsDraftState()
  const [leaving, setLeaving] = useState(false)
  usePreventRemove(!!draftFlags && !leaving, ({ repeat }) => {
    if (draftFlags & 2) return
    Alert.alert('Unsaved settings', 'Discard unsaved settings changes?', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setLeaving(true)
          repeat()
        },
      },
    ])
  })

  const { section, setting } = useLocalSearchParams<{ section: string; setting?: string }>()
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
          <SettingsSearchContext.Provider value={setting ?? ''}>
            <Screen />
          </SettingsSearchContext.Provider>
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
