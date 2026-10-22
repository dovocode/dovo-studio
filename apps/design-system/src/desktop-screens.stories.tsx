import type { Meta, StoryObj } from '@storybook/react-vite'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { SettingsTargetProvider, type StudioView } from '@dovo/studio-core'
import { ErrorBoundary, SidebarHeaderLayout, HeaderFallback } from '@dovo/studio-ui'
import { ActivityBar } from '../../../packages/studio-shell/src/activity-bar'
import { SettingsNav } from '../../../packages/studio-shell/src/settings-nav'
import { TitleBar } from '../../../packages/studio-shell/src/title-bar'
import { appSettingsExtension } from '../../../packages/studio-shell/src/app-extension'
import { tasksExtension } from '../../../packages/extension-tasks/src'
import { scmExtension } from '../../../packages/extension-scm/src'
import { agentsExtension } from '../../../packages/extension-agents/src'
import { jobsExtension } from '../../../packages/extension-jobs/src'
import { runtimeExtension } from '../../../packages/extension-runtime/src'
import { DesktopScreenFixture, type DesktopScreenState } from './desktop-screens-fixture'

export const desktopScreenViews: readonly StudioView[] = [
  tasksExtension,
  scmExtension,
  agentsExtension,
  jobsExtension,
  runtimeExtension,
  appSettingsExtension,
]
  .flatMap((extension) => extension.views)
  .sort((a, b) => a.order - b.order)
const loadedViews = new Map(desktopScreenViews.map((view) => [view.id, lazy(view.load)]))
const meta = {
  title: 'Dovo/Screens/Desktop',
  excludeStories: ['desktopScreenViews', 'DesktopScreen'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Every registered desktop extension route, rendered from the production page module with the real activity rail, title bar and settings navigation. This is an isolated composition of shell primitives, not the live Workbench/network provider. Page-owned sidebars remain real. Populated means the small synthetic workspace, not full fixtures for every remote integration. Unsupported reads display production unavailable/error states; mutations are blocked. Device-local appearance preferences affect this isolated catalog origin only. Specialized detail flows remain covered by component stories, not every page interaction.',
      },
    },
  },
  args: { route: 'tasks', state: 'populated' },
  argTypes: {
    route: { control: 'select', options: desktopScreenViews.map((view) => view.id) },
    state: { control: 'select', options: ['populated', 'empty', 'loading', 'error', 'offline'] },
  },
  render: (args) => <DesktopScreen key={`${args.route}:${args.state}`} {...args} />,
} satisfies Meta<{ route: string; state: DesktopScreenState }>
export default meta
type Story = StoryObj<typeof meta>
export function DesktopScreen({
  route,
  state,
  entityId,
  children,
}: {
  route: string
  state: DesktopScreenState
  entityId?: string
  children?: ReactNode
}) {
  const [activeId, setActiveId] = useState(route)
  const [collapsed, setCollapsed] = useState(false)
  const view = desktopScreenViews.find((entry) => entry.id === activeId)
  const View = loadedViews.get(activeId)
  const settings = view?.navigationGroup === 'settings'
  const title = (sidebar = false) => (
    <TitleBar
      sidebar={sidebar}
      section={settings ? 'Settings' : view?.title}
      online={state === 'offline' ? 0 : 1}
      devices={1}
      onDevices={() => setActiveId('runtime')}
      onSearch={() => setActiveId('general')}
    />
  )
  return (
    <DesktopScreenFixture state={state} navigate={setActiveId}>
      <SettingsTargetProvider>
        <div style={{ height: 'min(900px, calc(100vh - 48px))', minHeight: 560 }}>
          <SidebarHeaderLayout
            brand={title(true)}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          >
            <div className="studio" style={{ height: '100%', position: 'relative' }}>
              <HeaderFallback>{title()}</HeaderFallback>
              <div className="studio-body">
                <ActivityBar
                  views={desktopScreenViews}
                  activeId={activeId}
                  onSelect={setActiveId}
                />
                <main className="studio-main" aria-label={`${view?.title ?? 'Desktop'} page`}>
                  <div
                    className={`flex min-h-0 min-w-0 flex-1 ${settings ? 'flex-col md:flex-row' : ''}`}
                  >
                    {settings && (
                      <SettingsNav
                        views={desktopScreenViews.filter(
                          (entry) => entry.navigationGroup === 'settings',
                        )}
                        activeId={activeId}
                        onSelect={setActiveId}
                      />
                    )}
                    <div
                      data-settings-content={settings ? '' : undefined}
                      className="flex min-h-0 min-w-0 flex-1 flex-col"
                    >
                      <ErrorBoundary key={activeId}>
                        <Suspense
                          fallback={
                            <p role="status" className="p-6 text-xs text-muted-foreground">
                              Loading extension…
                            </p>
                          }
                        >
                          {children ??
                            (state === 'loading' ? (
                              <p role="status" className="p-6 text-xs text-muted-foreground">
                                Opening workspace…
                              </p>
                            ) : View ? (
                              <View entityId={entityId} />
                            ) : (
                              <p role="alert">Unknown desktop route.</p>
                            ))}
                        </Suspense>
                      </ErrorBoundary>
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </SidebarHeaderLayout>
        </div>
      </SettingsTargetProvider>
    </DesktopScreenFixture>
  )
}
export const Tasks: Story = {}
export const TasksEmpty: Story = { args: { state: 'empty' } }
export const WorkspaceLoading: Story = { args: { state: 'loading' } }
export const WorkspaceError: Story = { args: { route: 'activity', state: 'error' } }
export const WorkspaceOffline: Story = { args: { state: 'offline' } }
export const Artifacts: Story = { args: { route: 'artifacts' } }
export const ArchivedTasks: Story = { args: { route: 'archived-tasks' } }
export const Issues: Story = { args: { route: 'issues' } }
export const Jira: Story = { args: { route: 'jira' } }
export const Pipelines: Story = { args: { route: 'pipelines' } }
export const SourceControl: Story = { args: { route: 'source-control' } }
export const Pulls: Story = { args: { route: 'pulls' } }
export const Resources: Story = { args: { route: 'resources' } }
export const TextGeneration: Story = { args: { route: 'text-generation' } }
export const Agents: Story = { args: { route: 'agents' } }
export const Jobs: Story = { args: { route: 'jobs' } }
export const Runtime: Story = { args: { route: 'runtime' } }
export const TaskDefaults: Story = { args: { route: 'task-defaults' } }
export const TaskLifecycle: Story = { args: { route: 'task-behavior' } }
export const Commands: Story = { args: { route: 'commands' } }
export const ComputerUse: Story = { args: { route: 'computer-use' } }
export const RemoteDesktop: Story = { args: { route: 'remote-desktop' } }
export const DevicePreviews: Story = { args: { route: 'device-previews' } }
export const PullRequestMonitoringSettings: Story = {
  args: { route: 'pull-request-monitoring-settings' },
}
export const StudioToolsSettings: Story = { args: { route: 'studio-tools-settings' } }
export const ArtifactSettings: Story = { args: { route: 'artifact-settings' } }
export const Memory: Story = { args: { route: 'memory' } }
export const Worktrees: Story = { args: { route: 'worktrees' } }
export const RunningTasks: Story = { args: { route: 'running-tasks' } }
export const Activity: Story = { args: { route: 'activity' } }
export const General: Story = { args: { route: 'general' } }
export const TaskListSettings: Story = { args: { route: 'task-list-settings' } }
export const ConversationSettings: Story = { args: { route: 'conversation-settings' } }
export const UpdatesSettings: Story = { args: { route: 'updates-settings' } }
export const BrowserSettings: Story = { args: { route: 'browser-settings' } }
export const Notifications: Story = { args: { route: 'notifications' } }
export const Appearance: Story = { args: { route: 'appearance' } }
export const Diffs: Story = { args: { route: 'diffs' } }
export const Usage: Story = { args: { route: 'usage' } }
export const Shortcuts: Story = { args: { route: 'shortcuts' } }
