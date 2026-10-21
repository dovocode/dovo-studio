import type { ComponentType } from 'react'
import { MobileScreenParamsContext, mobileScreenRouteParams } from './screens-params'
import { MobileComposerScreen, MobileThreadScreen, MobileNewThreadScreen } from './screens-composer'
import { PullRouteScreen } from '../scm/pulls/list/pull-route-screen'
import { WorkItemRoute } from '../scm/work/work-item-route'
import { WorkScreen } from '../scm/work/work'
import { AutomationRouteScreen } from '../jobs/automation-route-screen'
import { TaskLauncherScreen } from '../tasks/creation/task-launcher-screen'
import { NewTaskScreen } from '../tasks/detail/task-route-screen'
import AppUpdates from '../screens/app-updates'
import SettingsScreen from '../screens/settings'
import TasksScreen from '../screens/tasks'
import PullsScreen from '../screens/pulls'
import IssuesScreen from '../screens/issues'
import JobsScreen from '../screens/jobs'
import RepositoriesScreen from '../screens/repositories'
import ArtifactsScreen from '../screens/artifacts'
import DevicesScreen from '../screens/devices'
import AppearanceScreen from '../screens/appearance'
import GeneralScreen, {
  BatterySettingsScreen,
  ConversationSettingsScreen,
  SpeechSettingsScreen,
  TaskPreferencesScreen,
} from '../screens/general'
import NotificationsSettingsScreen from '../screens/settings-notifications'
import TaskDefaultsScreen from '../screens/task-defaults'
import AgentsScreen from '../screens/agents'
import ResourcesScreen from '../screens/resources'
import DeviceHostsScreen from '../screens/device-host-settings'
import UsageScreen from '../screens/usage'
import SourceControlSettings from '../scm/connections/connections'
import {
  TaskBehaviorSettingsScreen,
  PullSettingsScreen,
  RuntimeToolsSettingsScreen,
  ArtifactSettingsScreen,
  MemorySettingsScreen,
  WorktreeSettingsScreen,
  ActivitySettingsScreen,
} from '../screens/settings-computer'
import { MobileScreenProviders, type MobileScreenState } from './screens-runtime'

/** Actual routed screen components. Route wrappers only add production workbench chrome. */
export const mobileCatalogScreens = {
  tasks: TasksScreen,
  thread: MobileThreadScreen,
  composer: MobileComposerScreen,
  new: MobileNewThreadScreen,
  'new-offline': NewTaskScreen,
  launcher: TaskLauncherScreen,
  'pull-detail': PullRouteScreen,
  'issue-detail': () => <WorkItemRoute mode="issues" />,
  'jira-detail': () => <WorkItemRoute mode="issues" jira />,
  'pipeline-detail': () => <WorkItemRoute mode="pipelines" />,
  'pipeline-runs': () => (
    <WorkScreen
      mode="pipelines"
      repositoryId={JSON.stringify(['catalog-computer', 'catalog-project'])}
    />
  ),
  'automation-detail': AutomationRouteScreen,
  archived: () => <TasksScreen archived />,
  projects: RepositoriesScreen,
  pulls: PullsScreen,
  issues: IssuesScreen,
  automations: JobsScreen,
  artifacts: ArtifactsScreen,
  computers: DevicesScreen,
  settings: SettingsScreen,
  'app-preferences': () => <SettingsScreen categorySlug="app-preferences" />,
  'agent-settings': () => <SettingsScreen categorySlug="agent-settings" />,
  'task-settings': () => <SettingsScreen categorySlug="task-settings" />,
  'computer-settings': () => <SettingsScreen categorySlug="computer-settings" />,
  'history-settings': () => <SettingsScreen categorySlug="history-settings" />,
  appearance: AppearanceScreen,
  updates: AppUpdates,
  general: GeneralScreen,
  conversation: ConversationSettingsScreen,
  speech: SpeechSettingsScreen,
  battery: BatterySettingsScreen,
  'task-preferences': TaskPreferencesScreen,
  notifications: NotificationsSettingsScreen,
  'task-defaults': TaskDefaultsScreen,
  agents: AgentsScreen,
  resources: ResourcesScreen,
  'device-hosts': DeviceHostsScreen,
  usage: UsageScreen,
  'source-control': SourceControlSettings,
  'task-behavior': TaskBehaviorSettingsScreen,
  'pull-requests': PullSettingsScreen,
  'runtime-tools': RuntimeToolsSettingsScreen,
  'artifact-settings': ArtifactSettingsScreen,
  memory: MemorySettingsScreen,
  worktrees: WorktreeSettingsScreen,
  'activity-retention': ActivitySettingsScreen,
} satisfies Record<string, ComponentType>
export type MobileCatalogScreen = keyof typeof mobileCatalogScreens
export function isMobileCatalogScreen(value: string): value is MobileCatalogScreen {
  return Object.hasOwn(mobileCatalogScreens, value)
}
export function MobileScreen({
  screen = 'settings',
  state = 'empty',
}: {
  screen?: MobileCatalogScreen
  state?: MobileScreenState
}) {
  const Screen = mobileCatalogScreens[screen]
  const localOnlyConversation = screen === 'thread' || screen === 'composer'
  return (
    <MobileScreenParamsContext.Provider
      value={{
        ...mobileScreenRouteParams,
        ...(screen === 'jira-detail' ? { itemId: 'CAT-17' } : {}),
      }}
    >
      <MobileScreenProviders
        state={localOnlyConversation ? 'offline' : state}
        suppressTaskWatch={screen === 'thread'}
      >
        <Screen />
      </MobileScreenProviders>
    </MobileScreenParamsContext.Provider>
  )
}
