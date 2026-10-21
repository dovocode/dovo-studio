import type { Meta, StoryObj } from '@storybook/react-vite'
import { MobileScreen, mobileCatalogScreens } from '../../mobile/src/catalog/screens'
import { MobilePreview } from './mobile-preview'
const meta = {
  title: 'Dovo/Screens/Mobile',
  component: MobileScreen,
  args: { screen: 'settings', state: 'empty' },
  argTypes: {
    screen: { control: 'select', options: Object.keys(mobileCatalogScreens) },
    state: { control: 'select', options: ['empty', 'offline', 'populated', 'error', 'loading'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Actual mobile screen components with synthetic empty, populated, offline and failed runtime contexts. React Native Web represents content/layout; native headers, sheets, gestures and Markdown need the on-device catalog. No account or runtime provider effects are mounted. Runtime commands reject; preferences are catalog-local.',
      },
    },
  },
  render: (args, context) => (
    <MobilePreview
      mode={context.globals.theme === 'light' ? 'light' : 'dark'}
      label="Actual mobile page content"
    >
      <MobileScreen {...args} />
    </MobilePreview>
  ),
} satisfies Meta<typeof MobileScreen>
export default meta
type Story = StoryObj<typeof meta>
export const Settings: Story = {}
export const Tasks: Story = { args: { screen: 'tasks' } }
export const OfflineTasks: Story = { args: { screen: 'tasks', state: 'offline' } }
export const Archived: Story = { args: { screen: 'archived', state: 'offline' } }
export const Projects: Story = { args: { screen: 'projects', state: 'offline' } }
export const PullRequests: Story = { args: { screen: 'pulls' } }
export const Issues: Story = { args: { screen: 'issues' } }
export const Automations: Story = { args: { screen: 'automations', state: 'offline' } }
export const Artifacts: Story = { args: { screen: 'artifacts' } }
export const Computers: Story = { args: { screen: 'computers' } }
export const AppPreferences: Story = { args: { screen: 'app-preferences' } }
export const AgentSettings: Story = { args: { screen: 'agent-settings' } }
export const TaskSettings: Story = { args: { screen: 'task-settings' } }
export const ComputerSettings: Story = { args: { screen: 'computer-settings' } }
export const HistorySettings: Story = { args: { screen: 'history-settings' } }
export const Appearance: Story = { args: { screen: 'appearance' } }
export const General: Story = { args: { screen: 'general' } }
export const Conversation: Story = { args: { screen: 'conversation' } }
export const Speech: Story = { args: { screen: 'speech' } }
export const Battery: Story = { args: { screen: 'battery' } }
export const TaskPreferences: Story = { args: { screen: 'task-preferences' } }
export const Notifications: Story = { args: { screen: 'notifications' } }
export const TaskDefaults: Story = { args: { screen: 'task-defaults' } }
export const Agents: Story = { args: { screen: 'agents' } }
export const Resources: Story = { args: { screen: 'resources' } }
export const DeviceHosts: Story = { args: { screen: 'device-hosts' } }
export const Usage: Story = { args: { screen: 'usage' } }
export const SourceControl: Story = { args: { screen: 'source-control' } }
export const TaskBehavior: Story = { args: { screen: 'task-behavior', state: 'offline' } }
export const PullPreferences: Story = { args: { screen: 'pull-requests', state: 'offline' } }
export const RuntimeTools: Story = { args: { screen: 'runtime-tools', state: 'offline' } }
export const ArtifactSettings: Story = { args: { screen: 'artifact-settings', state: 'offline' } }
export const Memory: Story = { args: { screen: 'memory', state: 'offline' } }
export const Worktrees: Story = { args: { screen: 'worktrees', state: 'offline' } }
export const Retention: Story = { args: { screen: 'activity-retention', state: 'offline' } }

export const PopulatedTasks: Story = { args: { screen: 'tasks', state: 'populated' } }
export const PopulatedProjects: Story = { args: { screen: 'projects', state: 'populated' } }
export const PopulatedPulls: Story = { args: { screen: 'pulls', state: 'populated' } }
export const PopulatedIssues: Story = { args: { screen: 'issues', state: 'populated' } }
export const PopulatedAutomations: Story = { args: { screen: 'automations', state: 'populated' } }
export const ConnectionFailure: Story = { args: { screen: 'computers', state: 'error' } }

export const ThreadDetail: Story = { args: { screen: 'thread', state: 'offline' } }
export const FullComposer: Story = { args: { screen: 'composer', state: 'offline' } }
export const NewThread: Story = { args: { screen: 'new', state: 'populated' } }
export const ThreadLauncher: Story = { args: { screen: 'launcher', state: 'populated' } }
export const PullDetail: Story = { args: { screen: 'pull-detail', state: 'populated' } }
export const IssueDetail: Story = { args: { screen: 'issue-detail', state: 'populated' } }
export const JiraDetail: Story = { args: { screen: 'jira-detail', state: 'populated' } }
export const PipelineDetail: Story = { args: { screen: 'pipeline-detail', state: 'populated' } }
export const PipelineRuns: Story = { args: { screen: 'pipeline-runs', state: 'populated' } }
export const AutomationDetail: Story = { args: { screen: 'automation-detail', state: 'populated' } }

export const Updates: Story = { args: { screen: 'updates' } }
export const LoadingTasks: Story = { args: { screen: 'tasks', state: 'loading' } }
export const PullReadFailure: Story = { args: { screen: 'pulls', state: 'error' } }

export const PopulatedArtifacts: Story = { args: { screen: 'artifacts', state: 'populated' } }

export const NewThreadNoComputer: Story = { args: { screen: 'new-offline', state: 'empty' } }

export const RuntimeToolsConfigured: Story = {
  args: { screen: 'runtime-tools', state: 'populated' },
}
export const ArtifactPreferencesConfigured: Story = {
  args: { screen: 'artifact-settings', state: 'populated' },
}
