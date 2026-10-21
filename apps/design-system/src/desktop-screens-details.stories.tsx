import type { Meta, StoryObj } from '@storybook/react-vite'
import { within, userEvent } from 'storybook/test'
import { useMemo, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { encodeWorkTarget } from '../../../packages/protocol/src'
import type { TaskLauncherBridge } from '../../../packages/protocol/src'
import { Button } from '@dovo/studio-ui'
import { CommandPalette } from '../../../packages/studio-shell/src/command-palette'
import { TaskLauncherForm } from '../../../packages/studio-shell/src/task-launcher'
import { PullDetail } from '../../../packages/extension-scm/src/pulls/detail/detail'
import { WorkContent } from '../../../packages/extension-scm/src/work/content'
import { PipelineDetail } from '../../../packages/extension-scm/src/work/pipeline-detail'
import { screenPipeline } from './desktop-screens-data'
import { AutomationDetail } from '../../../packages/extension-jobs/src/automation-detail'
import { DesktopScreen } from './desktop-screens.stories'

const meta = {
  title: 'Dovo/Screens/Desktop detail and overlays',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real selected-page compositions and shell overlays under the same isolated workspace as desktop route stories. Task detail includes the real project panel, thread navigation, conversation, composer and interactive right-side tools rail. PR overview/changes/checks use the production detail controller and synthetic read responses. Automation uses real canvas, runs and node inspector. Runtime mutations fail locally; editor changes stay in memory.',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const SelectedThread: Story = {
  render: () => <DesktopScreen route="tasks" entityId="preview-task" state="populated" />,
}
export const SelectedThreadOffline: Story = {
  render: () => <DesktopScreen route="tasks" entityId="preview-task" state="offline" />,
}
export const PullOverview: Story = {
  render: () => (
    <DesktopScreen route="pulls" state="populated">
      <PullDetail
        repositoryId="preview-project"
        number={42}
        onBack={() => undefined}
        onChanged={() => undefined}
      />
    </DesktopScreen>
  ),
}
export const PullChanges: Story = {
  render: () => (
    <DesktopScreen route="pulls" state="populated">
      <PullDetail
        repositoryId="preview-project"
        number={42}
        initialTab="changes"
        onBack={() => undefined}
        onChanged={() => undefined}
      />
    </DesktopScreen>
  ),
}
export const PullChecks: Story = {
  render: () => (
    <DesktopScreen route="pulls" state="populated">
      <PullDetail
        repositoryId="preview-project"
        number={42}
        initialTab="checks"
        onBack={() => undefined}
        onChanged={() => undefined}
      />
    </DesktopScreen>
  ),
}
function SelectedIssueContent() {
  const { request, connected } = useWorkspace()
  return (
    <WorkContent
      repositoryId="preview-project"
      repositoryName="Dovo Studio"
      collectionHeader={<span>Issues</span>}
      initialSelected="27"
      mode="issues"
      request={request}
      connected={connected}
    />
  )
}
export const SelectedIssue: Story = {
  render: () => (
    <DesktopScreen route="issues" state="populated">
      <SelectedIssueContent />
    </DesktopScreen>
  ),
}
export const AutomationRuns: Story = {
  render: () => (
    <DesktopScreen route="jobs" state="populated">
      <AutomationDetail automationId="preview-automation" onBack={() => undefined} />
    </DesktopScreen>
  ),
}
export const AutomationCanvas: Story = {
  render: () => (
    <DesktopScreen route="jobs" state="populated">
      <AutomationDetail
        automationId="preview-automation"
        initialSurface="canvas"
        onBack={() => undefined}
      />
    </DesktopScreen>
  ),
}
function Commands() {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState('')
  const commands = useMemo(
    () =>
      [
        'New task',
        'Open projects',
        'Settings: Appearance',
        'Settings: Devices & runtime',
        'Review pull requests',
        'Show artifacts',
      ].map((title) => ({ id: title, title, run: () => setSelected(title) })),
    [],
  )
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open command palette</Button>
      <p role="status" className="mt-4 text-sm">
        {selected ? `Selected locally: ${selected}` : 'Choose a synthetic navigation command.'}
      </p>
      <CommandPalette open={open} onOpenChange={setOpen} commands={commands} />
    </div>
  )
}
export const CommandPaletteOverlay: Story = {
  render: () => (
    <DesktopScreen route="tasks" state="populated">
      <Commands />
    </DesktopScreen>
  ),
}
function Launcher() {
  const { runtimeRegistry } = useWorkspace()
  const [dismissed, setDismissed] = useState(false)
  const bridge = useMemo<TaskLauncherBridge>(
    () => ({
      current: async () => runtimeRegistry,
      configure: async () => ({ registered: false, error: null }),
      sync: async () => undefined,
      open: async () => setDismissed(false),
      dismiss: async () => setDismissed(true),
      subscribe: () => () => undefined,
    }),
    [runtimeRegistry],
  )
  return dismissed ? (
    <div className="p-6">
      <p role="status">Launcher dismissed.</p>
      <Button onClick={() => setDismissed(false)}>Open quick task</Button>
    </div>
  ) : (
    <TaskLauncherForm bridge={bridge} />
  )
}
export const TaskLauncherWindow: Story = {
  render: () => (
    <DesktopScreen route="tasks" state="populated">
      <Launcher />
    </DesktopScreen>
  ),
}

export const ThreadAgentsSidebar: Story = {
  ...SelectedThread,
  play: async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole(
      'button',
      { name: 'Agents' },
      { timeout: 10_000 },
    )
    const button = buttons.at(-1)
    if (!button) throw new Error('Thread tool button did not mount.')
    await userEvent.click(button)
  },
}
export const ThreadProjectsSidebar: Story = {
  ...SelectedThread,
  play: async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole(
      'button',
      { name: 'Linked projects' },
      { timeout: 10_000 },
    )
    const button = buttons.at(-1)
    if (!button) throw new Error('Thread tool button did not mount.')
    await userEvent.click(button)
  },
}
export const ThreadSideChatsSidebar: Story = {
  ...SelectedThread,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole(
      'heading',
      { name: 'Improve the project landing page' },
      { timeout: 10_000 },
    )
    const tools = within(canvasElement).queryByRole('navigation', { name: 'Thread tools' })
    if (tools) await userEvent.click(within(tools).getByRole('button', { name: 'Side chats' }))
  },
}

const selectThreadTool =
  (label: string): Story['play'] =>
  async ({ canvasElement }) => {
    await within(canvasElement).findByRole(
      'heading',
      { name: 'Improve the project landing page' },
      { timeout: 10_000 },
    )
    const tools = within(canvasElement).queryByRole('navigation', { name: 'Thread tools' })
    if (tools) await userEvent.click(within(tools).getByRole('button', { name: label }))
  }
export const ThreadFilesSidebar: Story = { ...SelectedThread, play: selectThreadTool('Files') }
export const ThreadArtifactsSidebar: Story = {
  ...SelectedThread,
  play: selectThreadTool('Artifacts'),
}
export const ThreadBrowsersSidebar: Story = {
  ...SelectedThread,
  play: selectThreadTool('Browsers'),
}
export const ThreadDevicesSidebar: Story = { ...SelectedThread, play: selectThreadTool('Devices') }

export const SelectedPipeline: Story = {
  render: () => (
    <DesktopScreen route="pipelines" state="populated">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <PipelineDetail
          detail={screenPipeline}
          repositoryId="preview-project"
          disabled
          loading={false}
          onMore={() => undefined}
        />
      </div>
    </DesktopScreen>
  ),
}
export const AutomationStepInspector: Story = {
  ...AutomationCanvas,
  play: async ({ canvasElement }) => {
    const node = await within(canvasElement).findByText(
      'Audit component changes',
      {},
      { timeout: 10_000 },
    )
    await userEvent.click(node)
  },
}
export const ThreadFilePreview: Story = {
  ...SelectedThread,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole(
      'heading',
      { name: 'Improve the project landing page' },
      { timeout: 10_000 },
    )
    const tools = within(canvasElement).queryByRole('navigation', { name: 'Thread tools' })
    if (!tools) return
    await userEvent.click(within(tools).getByRole('button', { name: 'Files' }))
    const file = await within(canvasElement).findByRole(
      'button',
      { name: 'README.md' },
      { timeout: 10_000 },
    )
    await userEvent.click(file)
  },
}

export const SelectedPullPage: Story = {
  render: () => (
    <DesktopScreen
      route="pulls"
      entityId="https://github.com/dovo/studio/pull/42"
      state="populated"
    />
  ),
}
export const SelectedIssuePage: Story = {
  render: () => (
    <DesktopScreen
      route="issues"
      entityId={encodeWorkTarget({
        repositoryId: 'preview-project',
        id: '27',
        url: 'https://github.com/dovo/studio/issues/27',
      })}
      state="populated"
    />
  ),
}
export const SelectedPipelinePage: Story = {
  render: () => (
    <DesktopScreen
      route="pipelines"
      entityId={encodeWorkTarget({
        repositoryId: 'preview-project',
        id: 'preview-run-42',
        url: 'https://github.com/dovo/studio/actions/runs/42',
      })}
      state="populated"
    />
  ),
}
