import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  decode,
  taskSchema,
  workspaceSchema,
  threadNativeAgents,
  type Subagent,
  type Task,
  type Workspace,
} from '../../../packages/protocol/src'
import { WorkspaceValueProvider, type WorkspaceContextValue } from '@dovo/studio-core'
import {
  TaskListRow,
  type TaskListRowActions,
} from '../../../packages/extension-tasks/src/list/task-list-row'
import type {
  TaskOwner,
  TaskSource,
} from '../../../packages/extension-tasks/src/list/task-collection'
import type { NestedThread } from '../../../packages/extension-tasks/src/list/thread-tree'
import { ComposerFixtureProvider } from './composer-fixture'
import { useWorkspace } from '@dovo/studio-core'

type ThreadStoryArgs = {
  selectedId: string
  needsInput: boolean
  offline: boolean
  density: 'comfortable' | 'compact'
  showNested: boolean
  focusTitle: string
}

const meta = {
  title: 'Dovo/Threads/Cards and lists',
  tags: ['autodocs'],
  argTypes: {
    selectedId: {
      control: 'select',
      options: ['working', 'needs-input', 'waiting', 'failed', 'draft', 'settled'],
      description: 'Which production row receives selected styling.',
    },
    needsInput: {
      control: 'boolean',
      description: 'Marks the active work item as waiting on a question or approval.',
    },
    offline: {
      control: 'boolean',
      description: 'Renders cached rows owned by a disconnected computer.',
    },
    density: {
      control: 'radio',
      options: ['comfortable', 'compact'],
      description: 'Changes the list spacing around the production row anatomy.',
    },
    showNested: {
      control: 'boolean',
      description: 'Adds a linked child thread and agent activity to the working row.',
    },
    focusTitle: {
      control: 'text',
      description: 'Edits the title on the selected focus example.',
    },
  },
} satisfies Meta<ThreadStoryArgs>
export default meta

const repositoryId = 'catalog-project'
const demoWorkspace = decode(workspaceSchema, {
  version: 1,
  runtimeAddress: '',
  agents: [
    {
      id: 'catalog-codex',
      name: 'Codex',
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoning: 'high',
      instructions: '',
      permission: 'workspace-write',
      endpoint: '',
    },
  ],
  repositories: [
    {
      id: repositoryId,
      name: 'Website redesign',
      path: '/workspace/website',
      branch: 'main',
      gitIdentity: 'github.com/example/website',
    },
  ],
  tasks: [],
  automations: [],
})

const task = (id: string, title: string, status: Task['status'], overrides: Partial<Task> = {}) =>
  decode(taskSchema, {
    id,
    title,
    repositoryId,
    agentId: 'catalog-codex',
    status,
    createdAt: '2026-10-21T09:30:00.000Z',
    messages: [
      {
        id: `${id}-prompt`,
        role: 'user',
        text: 'Improve the layout and preserve the current brand style.',
        createdAt: '2026-10-21T09:31:00.000Z',
      },
    ],
    files: [],
    draft: '',
    example: false,
    ...overrides,
  })

const sampleTasks = [
  task('working', 'Refine the dashboard navigation', 'running', {
    activeRunId: 'run-working',
    queue: [
      {
        id: 'queued-1',
        role: 'user',
        text: 'Keep the navigation keyboard accessible.',
        createdAt: '2026-10-21T09:45:00.000Z',
      },
    ],
    pinned: true,
    execution: 'worktree',
    checkoutBranch: 'codex/dashboard-nav',
    activity: 'Updating responsive navigation and focus states',
    threadWatches: [
      {
        runtimeId: 'preview.local',
        threadId: 'linked-review',
        computerName: 'Preview computer',
        relation: 'linked',
        status: 'watching',
        offline: false,
        snapshot: {
          title: 'Review keyboard navigation',
          phase: 'needs-input',
          revision: '4',
          attention: ['review-question'],
          watches: { pipelines: 1, pullRequests: 0, failures: 0 },
        },
      },
    ],
  }),
  task('needs-input', 'Choose the final checkout behavior', 'running', {
    activeRunId: 'run-attention',
    activity: 'Waiting for the preferred behavior',
  }),
  task('waiting', 'Update the component usage guide', 'done', {
    waitingForFeedback: true,
    activity: 'Waiting for review feedback',
  }),
  task('failed', 'Fix the image optimization build', 'failed', {
    error: 'The image pipeline could not load the source asset.',
    activity: 'Build failed while processing the hero image',
  }),
  task('draft', 'Explore a new onboarding flow', 'draft', {
    messages: [],
    activity: 'Not started',
  }),
  task('settled', 'Publish the updated typography scale', 'done', {
    archived: true,
    activity: 'Finished yesterday',
  }),
]

const subagents: Subagent[] = [
  {
    id: 'catalog-agent-child',
    name: 'Check responsive layout',
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    status: 'working',
    activity: 'Checking narrow screens',
    sessionLive: true,
    startedAt: '2026-10-21T09:40:00.000Z',
    updatedAt: '2026-10-21T09:45:00.000Z',
  },
]
const nestedThreads: readonly NestedThread[] = [
  {
    key: '["preview.local","linked-review"]',
    runtimeId: 'preview.local',
    threadId: 'linked-review',
    title: 'Review keyboard navigation',
    projectName: 'Website redesign',
    computerName: 'Preview computer',
    phase: 'needs-input',
    online: true,
    paused: false,
    needsInput: true,
    children: [],
  },
]

const localTaskActions = (
  select: (key: string) => void,
  onMessage: (message: string) => void,
): TaskListRowActions => ({
  open: (key) => {
    select(key)
    onMessage(`Selected ${key}.`)
  },
  split: () => onMessage('Split view is unavailable in the catalog preview.'),
  template: () => onMessage('Task templates are unavailable in the catalog preview.'),
  create: () => onMessage('Task creation is unavailable in the catalog preview.'),
  filter: () => onMessage('Project filtering is unavailable in the catalog preview.'),
  deselect: () => onMessage('Selection cleared.'),
  error: onMessage,
  projectDeleted: () => onMessage('Project deletion is unavailable in the catalog preview.'),
  clickCapture: (_key, _event: MouseEvent<HTMLDivElement>) => undefined,
  contextMenuCapture: () => undefined,
})

function ThreadRows({ args }: { args: ThreadStoryArgs }) {
  const root = useWorkspace()
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    ...demoWorkspace,
    tasks: sampleTasks,
  }))
  const [selectedKey, setSelectedKey] = useState(args.selectedId)
  const [message, setMessage] = useState('Choose a row or open its context menu.')
  useEffect(() => setSelectedKey(args.selectedId), [args.selectedId])
  const tasks = useMemo(
    () =>
      workspace.tasks.map((entry) =>
        entry.id === args.selectedId && args.focusTitle.trim()
          ? { ...entry, title: args.focusTitle }
          : entry,
      ),
    [workspace.tasks, args.focusTitle, args.selectedId],
  )
  const localWorkspace: Workspace = { ...workspace, tasks }
  const snapshot = root.snapshot ? { ...root.snapshot, workspace: localWorkspace } : null
  const contextValue: WorkspaceContextValue = {
    ...root,
    workspace: localWorkspace,
    setWorkspace,
    snapshot,
  }
  const source: TaskSource = {
    runtimeId: root.activeRuntimeId,
    address: root.connection?.address,
    name: 'Preview computer',
    workspace: localWorkspace,
    snapshot,
    online: !args.offline,
  }
  const owner: TaskOwner = {
    runtimeId: source.runtimeId,
    address: source.address,
    name: source.name,
    online: source.online,
    agents: localWorkspace.agents,
    repositories: localWorkspace.repositories,
    runtimeIcon: snapshot?.runtimeIcon,
    acpInstallations: snapshot?.acpInstallations ?? [],
    threadBehaviorSupported: true,
    worktreeDeletionOverrideSupported: false,
  }
  const actions = useMemo(() => localTaskActions(setSelectedKey, setMessage), [])
  const compact = args.density === 'compact'
  return (
    <WorkspaceValueProvider value={contextValue}>
      <section className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border bg-background p-4 text-foreground">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Production task list rows</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Each row follows the task list hierarchy: project and status, task title, then branch,
              computer, and provider. Select a row to expose focused styling; use the network button
              to inspect nested threads and hover a row to reveal its lifecycle actions.
            </p>
          </div>
          <span className="rounded-full border px-2 py-1 text-[0.6875rem] text-muted-foreground">
            {compact ? 'Compact list spacing' : 'Comfortable list spacing'}
          </span>
        </header>
        <div
          className={
            compact ? 'grid min-w-0 grid-cols-1 gap-0.5' : 'grid min-w-0 grid-cols-1 gap-2'
          }
          aria-label="Task list examples"
        >
          {tasks.map((entry) => {
            const selected = entry.id === selectedKey
            const needsInput = entry.id === 'needs-input' && args.needsInput
            const children = entry.id === 'working' && args.showNested ? nestedThreads : undefined
            return (
              <TaskListRow
                key={entry.id}
                entryKey={entry.id}
                task={entry.id === 'working' && args.showNested ? { ...entry, subagents } : entry}
                owner={owner}
                subagents={entry.id === 'working' && args.showNested ? subagents : []}
                needsInput={needsInput}
                terminals={entry.id === 'working' ? 1 : 0}
                selected={selected}
                selectedMain={selected}
                selectedChildId={undefined}
                multiSelected={false}
                editable={source.online}
                disabled={false}
                menuBusy={false}
                canSplit={false}
                canTemplate={false}
                actions={actions}
                rowWindow={null}
                thread={{
                  key: entry.id,
                  runtimeId: source.runtimeId,
                  threadId: entry.id,
                  title: entry.title,
                  computerName: source.name,
                  projectName: localWorkspace.repositories.find(
                    (repository) => repository.id === entry.repositoryId,
                  )?.name,
                  online: source.online,
                  paused: false,
                  phase: 'running',
                  nativeAgents: threadNativeAgents({
                    ...entry,
                    subagents: entry.id === 'working' && args.showNested ? subagents : [],
                  }),
                  children: [...(children ?? [])],
                }}
                selectedThreadKey={undefined}
                searching={false}
              />
            )
          })}
        </div>
        <p className="min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">
          {message}{' '}
          {args.offline
            ? 'Rows show cached offline state.'
            : 'Actions that need runtime writes are rejected in this preview.'}
        </p>
      </section>
    </WorkspaceValueProvider>
  )
}

function ThreadCatalog({ args }: { args: ThreadStoryArgs }) {
  return (
    <ComposerFixtureProvider>
      <ThreadRows args={args} />
    </ComposerFixtureProvider>
  )
}

export const ThreadListAndCards: StoryObj<ThreadStoryArgs> = {
  args: {
    selectedId: 'working',
    needsInput: true,
    offline: false,
    density: 'comfortable',
    showNested: true,
    focusTitle: 'Refine the dashboard navigation',
  },
  render: (args) => <ThreadCatalog args={args} />,
  parameters: {
    docs: {
      description: {
        story:
          'Uses the production TaskListRow and TaskRow, with args controls for selected state, attention, offline ownership, list density, nested activity, and the focus title. The fixture creates a small status matrix (working, needs input, waiting, failed, draft, settled) and keeps action effects local. Use this as a reference for task-card anatomy and list-level composition; runtime-backed writes are surfaced as preview errors.',
      },
    },
  },
}

export const OfflineCached: StoryObj<ThreadStoryArgs> = {
  args: {
    selectedId: 'working',
    needsInput: true,
    offline: true,
    density: 'comfortable',
    showNested: true,
    focusTitle: 'Refine the dashboard navigation',
  },
  render: (args) => <ThreadCatalog args={args} />,
  parameters: {
    docs: {
      description: {
        story:
          'Shows cached task rows when their owning computer is offline. Selection remains local and available; runtime-backed writes are rejected with a visible preview error.',
      },
    },
  },
}

export const LongTitlesAndCompact: StoryObj<ThreadStoryArgs> = {
  args: {
    selectedId: 'working',
    needsInput: false,
    offline: false,
    density: 'compact',
    showNested: false,
    focusTitle:
      'Refine the dashboard navigation while preserving keyboard access, responsive behavior, and current project conventions',
  },
  render: (args) => <ThreadCatalog args={args} />,
  parameters: {
    docs: {
      description: {
        story:
          'Pairs long task titles with compact list spacing so truncation and metadata hierarchy can be reviewed at narrow and wide canvas widths.',
      },
    },
  },
}
