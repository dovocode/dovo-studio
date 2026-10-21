import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { TaskLinkedPullPanel } from '../../../packages/extension-tasks/src/detail/task-linked-pull-panel'
import { TaskPullStatus } from '../../../packages/extension-tasks/src/detail/task-pull-status'
import type { Task } from '../../../packages/protocol/src'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { ComposerFixtureProvider, useComposerFixture } from './composer-fixture'

type PullState = 'open' | 'merged' | 'closed'
type ChecksState = 'none' | 'pending' | 'passed' | 'failed'

type PullArgs = {
  state: PullState
  checks: ChecksState
  draft: boolean
  title: string
}

const meta = {
  title: 'Dovo/Patterns/Pull requests',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The protocol helpers own thread PR-link and status lookup. TaskPullStatus owns the compact state summary used in task lists and headers; TaskLinkedPullPanel owns the thread-level linked PR list. Reuse those production components at their matching scope instead of rebuilding status or link resolution in a feature.',
      },
    },
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['open', 'merged', 'closed'] },
    checks: { control: 'inline-radio', options: ['none', 'pending', 'passed', 'failed'] },
    draft: { control: 'boolean' },
    title: { control: 'text' },
  },
  args: {
    state: 'open',
    checks: 'pending',
    draft: false,
    title: 'Improve task pull request previews',
  },
} satisfies Meta<PullArgs>
export default meta
type Story = StoryObj<PullArgs>

const now = '2026-10-21T10:00:00.000Z'
const repositoryUrl = 'https://github.com/dovo/studio'

function makeTask(task: Task, args: PullArgs): Task {
  const url = `${repositoryUrl}/pull/42`
  const status: NonNullable<Task['pullStatus']> = {
    number: 42,
    url,
    title: args.title,
    state: args.state,
    draft: args.draft,
    ...(args.checks === 'none' ? {} : { checks: args.checks }),
    ...(args.checks === 'failed' ? { failedChecks: ['lint', 'unit tests'] } : {}),
    checkedAt: now,
  }
  return {
    ...task,
    status: 'review',
    pullStatus: status,
    pullStatuses: [status],
    linkedPullRequests: [{ number: 42, url, provider: 'github', repositoryUrl, title: args.title }],
  }
}

function InlineStatus(args: PullArgs) {
  const { task } = useComposerFixture()
  return (
    <div className="max-w-xl rounded-lg border bg-card p-4">
      <p className="mb-3 text-xs text-muted-foreground">Task list metadata</p>
      <TaskPullStatus task={makeTask(task, args)} onPullLink={() => true} />
    </div>
  )
}

function LinkedPanel(args: PullArgs) {
  const { task } = useComposerFixture()
  const base = makeTask(task, args)
  const mixedTask: Task = {
    ...base,
    linkedPullRequests: [
      ...(base.linkedPullRequests ?? []),
      {
        number: 43,
        url: `${repositoryUrl}/pull/43`,
        provider: 'github',
        repositoryUrl,
        title:
          'A second linked change with a deliberately long title to show truncation in narrow panels',
      },
      {
        number: 44,
        url: `${repositoryUrl}/pull/44`,
        provider: 'github',
        repositoryUrl,
        title: 'Resolve review feedback',
      },
    ],
    pullStatuses: [
      ...(base.pullStatuses ?? []),
      {
        number: 43,
        url: `${repositoryUrl}/pull/43`,
        title:
          'A second linked change with a deliberately long title to show truncation in narrow panels',
        state: 'open',
        draft: true,
        checks: 'passed',
        checkedAt: now,
      },
    ],
  }
  const [open, setOpen] = useState(true)
  return (
    <div
      className="grid min-w-0 w-full max-w-sm grid-cols-1 gap-2"
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('a[href]'))
          event.preventDefault()
      }}
    >
      {open ? (
        <div className="flex h-[min(32rem,80vh)] border bg-background">
          <TaskLinkedPullPanel
            task={{
              ...mixedTask,
              linkedPullRequests: mixedTask.linkedPullRequests?.filter(
                (pull) => !task.ignoredPullRequestUrls?.includes(pull.url),
              ),
            }}
            onPullLink={() => true}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-fit"
          data-testid="reopen-linked-pull-requests"
          onClick={() => setOpen(true)}
        >
          Reopen linked pull requests
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Managing links is local: unlink updates the preview; adding a link reports that its runtime
        route is unsupported here.
      </p>
    </div>
  )
}

function EmptyPanel() {
  const { task } = useComposerFixture()
  const [open, setOpen] = useState(true)
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Reopen linked pull requests
      </Button>
    )
  return (
    <div className="flex h-72 w-full max-w-sm border bg-background">
      <TaskLinkedPullPanel
        task={{ ...task, pullStatus: undefined, pullStatuses: [], linkedPullRequests: [] }}
        onPullLink={() => true}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}

function FailedChecks(args: PullArgs) {
  const fixture = useComposerFixture()
  const failed = makeTask(fixture.task, { ...args, state: 'open', checks: 'failed' })
  return (
    <div className="grid max-w-xl gap-3 rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        Click Fix to record a local preview request. Use the button below first to show the
        component&apos;s request-error state.
      </p>
      <div>
        <TaskPullStatus task={failed} onPullLink={() => true} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => fixture.setFailNextRequest(true)}
      >
        Make next local request fail
      </Button>
    </div>
  )
}

const withLocalFixture = (render: (args: PullArgs) => React.ReactNode) => (args: PullArgs) => (
  <ComposerFixtureProvider>{render(args)}</ComposerFixtureProvider>
)

export const InlineStatusCatalog: Story = {
  render: withLocalFixture((args) => <InlineStatus {...args} />),
  parameters: {
    docs: {
      description: {
        story:
          'Production TaskPullStatus in its compact task-row form. Change state, check result, draft flag, and title with the controls. Status metadata is synthetic and all links are prevented in this local preview.',
      },
    },
  },
}

export const LinkedPullPanelCatalog: Story = {
  render: withLocalFixture((args) => <LinkedPanel {...args} />),
  parameters: {
    docs: {
      description: {
        story:
          'Production TaskLinkedPullPanel with open and draft entries, including a long title and an uncached linked pull request (#44). Close hides the panel locally and Reopen restores it. The panel is the thread-level owner of linked PR browsing; the compact status belongs in task rows and headers. Link navigation is intercepted. Managing links stays local: unlink updates the preview, while adding one reports its unsupported runtime route.',
      },
    },
  },
}

export const EmptyLinkedPullPanel: Story = {
  render: withLocalFixture(() => <EmptyPanel />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the real panel empty state when a thread has no linked pull requests. Use this when documenting the panel boundary; do not reproduce its empty-state markup in a consuming feature.',
      },
    },
  },
}

export const FailedChecksAndRequestError: Story = {
  args: { ...meta.args, checks: 'failed' },
  render: withLocalFixture((args) => <FailedChecks {...args} />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows failed checks and the production Fix action. The fixture records the message request locally; trigger the outlined button before Fix to exercise its error feedback. No forge or runtime network calls are made.',
      },
    },
  },
}

export const DraftPullRequest: Story = {
  ...InlineStatusCatalog,
  args: { ...meta.args, draft: true },
}
export const MergedPullRequest: Story = {
  ...InlineStatusCatalog,
  args: { ...meta.args, state: 'merged', checks: 'passed' },
}
export const ClosedPullRequest: Story = {
  ...InlineStatusCatalog,
  args: { ...meta.args, state: 'closed', checks: 'none' },
}
export const LongTitleFailedChecks: Story = {
  ...LinkedPullPanelCatalog,
  args: {
    ...meta.args,
    checks: 'failed',
    title:
      'Preserve consistent thread selection and review context across desktop and mobile while reconnecting a runtime with a deliberately long repository branch name',
  },
}
