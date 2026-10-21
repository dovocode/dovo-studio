import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Badge } from '../../../packages/studio-ui/src/components/ui/badge'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { EmptyState } from '../../../packages/studio-ui/src/components/empty-state'
import { FileBrowserTree, FileChangeCounts } from '../../../packages/studio-ui/src/file-tree'
import {
  Message,
  MessageContent,
} from '../../../packages/studio-ui/src/components/ai-elements/message'
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
  QueueSectionTrigger,
} from '../../../packages/studio-ui/src/components/ai-elements/queue'
import {
  Tool,
  ToolContent,
  ToolHeader,
} from '../../../packages/studio-ui/src/components/ai-elements/tool'
import { PageHeader } from '../../../packages/studio-ui/src/page-header'
import { ProjectIcon } from '../../../packages/studio-ui/src/project-icon'
import type { FileTreeEntry } from '../../../packages/protocol/src/scm/repositories/file-tree'
import type { Repository } from '../../../packages/protocol/src/workspace'

const meta = { title: 'Dovo/Patterns/Content and navigation', tags: ['autodocs'] } satisfies Meta
export default meta
const story = (description: string) => ({ docs: { description: { story: description } } })

function EmptyStateExample() {
  const [created, setCreated] = useState(false)
  return created ? (
    <section className="max-w-xl rounded-xl border bg-card p-5" aria-live="polite">
      <h2 className="font-semibold">A new task is ready</h2>
      <p className="mt-1 text-sm text-muted-foreground">The action updates this preview only.</p>
      <Button className="mt-4" variant="outline" onClick={() => setCreated(false)}>
        Reset empty state
      </Button>
    </section>
  ) : (
    <div className="h-72 max-w-2xl rounded-xl border bg-card">
      <EmptyState
        title="No tasks in this project yet"
        description="Start with a small goal. Dovo will keep its conversation and changes attached to this project."
        action={<Button onClick={() => setCreated(true)}>Create a task</Button>}
      />
    </div>
  )
}
export const EmptyStateWithAction: StoryObj = {
  render: () => <EmptyStateExample />,
  parameters: story(
    'An empty state explains what is absent and gives one useful next action. Create a task changes local preview state; the reset control restores the empty state.',
  ),
}

function PageHeaderExample() {
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  return (
    <div className="max-w-4xl overflow-hidden rounded-xl border bg-background">
      <PageHeader
        title="Pull requests"
        description="Review changes and follow checks across your projects."
        leading={
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
            PR
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={filter === 'all' ? 'secondary' : 'outline'}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filter === 'mine' ? 'secondary' : 'outline'}
            aria-pressed={filter === 'mine'}
            onClick={() => setFilter('mine')}
          >
            Assigned to me
          </Button>
        </div>
      </PageHeader>
      <p className="px-5 py-4 text-sm text-muted-foreground" aria-live="polite">
        Showing {filter === 'all' ? 'all open pull requests' : 'pull requests assigned to you'}.
      </p>
    </div>
  )
}
export const PageIdentityAndActions: StoryObj = {
  render: () => <PageHeaderExample />,
  parameters: story(
    'PageHeader keeps title and description distinct from variable-height actions. The filter buttons change the displayed scope. At narrow widths the header actions can wrap below the identity.',
  ),
}

const repositories: Repository[] = [
  { id: 'dovo', kind: 'folder', name: 'Dovo Studio', path: '~/work/dovo-studio', branch: 'main' },
  {
    id: 'mobile',
    kind: 'folder',
    name: 'Mobile Client',
    path: '~/work/mobile-client',
    branch: 'feature/sync',
  },
  { id: 'scratch', kind: 'scratch', name: 'General', path: '', branch: '' },
]
export const ProjectIdentity: StoryObj = {
  render: () => (
    <section
      aria-label="Project identity examples"
      className="grid max-w-xl gap-1 rounded-xl border bg-card p-2"
    >
      {repositories.map((repository, index) => (
        <div
          key={repository.id}
          className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
        >
          <ProjectIcon repository={repository} className="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{repository.name}</p>
            <p
              className="truncate text-xs text-muted-foreground"
              title={repository.path || 'General project'}
            >
              {repository.path || 'General project'}
            </p>
          </div>
          {index === 0 && <Badge variant="secondary">Current</Badge>}
          {index === 1 && (
            <span className="max-w-32 truncate font-mono text-xs text-muted-foreground">
              {repository.branch}
            </span>
          )}
        </div>
      ))}
    </section>
  ),
  parameters: story(
    'Uses ProjectIcon for real repository shapes alongside names, paths, branch metadata, and a current marker. Long paths truncate with their full value available as a title; icons are decorative to assistive technology.',
  ),
}

const files: FileTreeEntry[] = [
  { path: 'apps/desktop/src/app.tsx', additions: 28, deletions: 4, viewed: true },
  { path: 'apps/mobile/src/screens/tasks.tsx', additions: 12, deletions: 3, label: 'Needs review' },
  { path: 'packages/protocol/src/workspace.ts', additions: 44, deletions: 18 },
  { path: 'packages/protocol/src/scm/repositories/file-tree.ts', additions: 9, deletions: 2 },
  { path: 'README.md', additions: 3 },
]
function FileBrowserExample() {
  const [selected, setSelected] = useState('apps/desktop/src/app.tsx')
  return (
    <section className="max-w-xl rounded-xl border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
        <h2 className="text-sm font-semibold">Changed files</h2>
        <Button size="sm" variant="outline" onClick={() => setSelected('')}>
          Clear selection
        </Button>
      </div>
      <FileBrowserTree
        files={files}
        selected={selected}
        onSelect={setSelected}
        defaultExpandedDepth={3}
      />
      <p role="status" className="mt-2 break-all px-2 text-xs text-muted-foreground">
        {selected ? `Selected ${selected}` : 'No file selected'}
      </p>
    </section>
  )
}
export const FileBrowserAndMetadata: StoryObj = {
  render: () => <FileBrowserExample />,
  parameters: story(
    'The actual FileBrowserTree supports keyboard navigation, expandable folders, selected and viewed states, change counts, and a review label. Select a file to update the status, or clear selection. Directory nesting is useful on desktop; the same rows remain touch targets on mobile.',
  ),
}

function ContentStatesExample() {
  const [state, setState] = useState<'empty' | 'loading' | 'error' | 'ready'>('empty')
  const details = {
    empty: { title: 'No matching work', description: 'Try another filter or create a task.' },
    loading: {
      title: 'Refreshing project…',
      description: 'Your current selection stays available while the list updates.',
    },
    error: {
      title: 'Project list is unavailable',
      description: 'Your local work is unchanged. Retry when the runtime is reachable.',
    },
    ready: {
      title: 'Project list updated',
      description: 'Three projects are available in this local preview.',
    },
  }[state]
  return (
    <section className="max-w-3xl rounded-xl border bg-card p-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preview content state">
        {(['empty', 'loading', 'error', 'ready'] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={state === option ? 'secondary' : 'outline'}
            aria-pressed={state === option}
            onClick={() => setState(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      <div className="mt-3 h-64 rounded-lg border">
        <EmptyState
          title={details.title}
          description={details.description}
          action={
            state === 'error' ? (
              <Button variant="outline" onClick={() => setState('loading')}>
                Retry preview
              </Button>
            ) : undefined
          }
        />
      </div>
      <p className="sr-only" aria-live="polite">
        State: {state}
      </p>
    </section>
  )
}
export const EmptyErrorAndProgress: StoryObj = {
  render: () => <ContentStatesExample />,
  parameters: story(
    'Switch among empty, progress, error, and ready content to inspect the same layout under different conditions. Retry advances the local preview to loading. Messages avoid implying a live request.',
  ),
}

function MessageExample() {
  const [from, setFrom] = useState<'user' | 'assistant'>('assistant')
  return (
    <section className="max-w-3xl rounded-xl border bg-background p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={from === 'assistant' ? 'secondary' : 'outline'}
          onClick={() => setFrom('assistant')}
        >
          Assistant
        </Button>
        <Button
          size="sm"
          variant={from === 'user' ? 'secondary' : 'outline'}
          onClick={() => setFrom('user')}
        >
          User
        </Button>
      </div>
      <Message from={from}>
        <span className="text-xs font-medium text-muted-foreground">
          {from === 'assistant' ? 'Dovo' : 'You'} · just now
        </span>
        <MessageContent>
          <p className="leading-relaxed">
            The runtime connection is stable. I updated the project settings and kept the repository
            on its existing branch.
          </p>
          <p className="text-xs text-muted-foreground">
            2 files changed · <FileChangeCounts additions={14} deletions={3} />
          </p>
        </MessageContent>
      </Message>
    </section>
  )
}
export const MessageAndMetadata: StoryObj = {
  render: () => <MessageExample />,
  parameters: story(
    'Shows actual message wrappers with a local speaker switch, readable body copy, timestamp, and tabular change metadata. User messages align and surface differently; the content stays constrained on narrow screens.',
  ),
}

function ToolExample() {
  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running')
  return (
    <section className="max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Tool state:</span>
        {(['running', 'completed', 'failed'] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={status === option ? 'secondary' : 'outline'}
            onClick={() => setStatus(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      <Tool open>
        <ToolHeader
          title="pnpm --filter @dovo/runtime typecheck · workspace/feature/very-long-command-name"
          status={status}
        />
        <ToolContent>
          <p className="font-mono text-xs">
            {status === 'running'
              ? 'Checking packages…'
              : status === 'completed'
                ? 'Typecheck completed with no errors.'
                : 'Typecheck failed: package boundary is missing a type.'}
          </p>
          <p className="break-all text-muted-foreground">cwd: /Users/dominic/work/dovo-studio</p>
        </ToolContent>
      </Tool>
    </section>
  )
}
export const ToolStatusAndOverflow: StoryObj = {
  render: () => <ToolExample />,
  parameters: story(
    'Use the disclosure header to inspect the actual tool panel and switch running, completed, and failed status locally. Long commands truncate in the summary while details wrap safely; status is text plus icon, not color alone.',
  ),
}

function QueueExample() {
  const [items, setItems] = useState([
    'Refactor project picker',
    'Review mobile task filters',
    'Update workspace documentation',
  ])
  const add = () =>
    setItems((current) => [
      ...current,
      `Follow up ${current.length + 1}: inspect the runtime boundary`,
    ])
  return (
    <section className="max-w-lg space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Queued work is kept in reading order.</p>
        <Button size="sm" onClick={add}>
          Add queued task
        </Button>
      </div>
      <Queue open>
        <QueueSectionTrigger>
          Up next <Badge variant="secondary">{items.length}</Badge>
        </QueueSectionTrigger>
        <QueueList>
          {items.map((item, index) => (
            <QueueItem key={`${index}-${item}`}>
              <QueueItemIndicator />
              <QueueItemContent title={item}>{item}</QueueItemContent>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {index + 1}
              </span>
            </QueueItem>
          ))}
        </QueueList>
      </Queue>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setItems([
            'Refactor project picker',
            'Review mobile task filters',
            'Update workspace documentation',
          ])
        }
      >
        Reset queue
      </Button>
    </section>
  )
}
export const QueueAndOverflow: StoryObj = {
  render: () => <QueueExample />,
  parameters: story(
    'A native disclosure groups queued tasks and the bounded list scrolls when it grows. Add a long task to inspect truncation and reset to restore the initial queue; native disclosure keyboard behavior is retained.',
  ),
}

export const TypographyAndHierarchy: StoryObj = {
  render: () => (
    <article className="max-w-3xl space-y-5 rounded-xl border bg-background p-5 sm:p-7">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Conversation · Project
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Ship a reliable connection handoff
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Keep the task goal prominent, use supporting copy to explain context, and keep runtime
          metadata quiet but legible.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y py-3 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">Project</span> Dovo Studio
        </span>
        <span>
          <span className="font-medium text-foreground">Branch</span>{' '}
          <code className="break-all">feature/connection-handoff</code>
        </span>
        <span>
          <span className="font-medium text-foreground">Updated</span> 4 minutes ago
        </span>
      </div>
      <section className="space-y-2 text-sm leading-6">
        <h2 className="text-base font-semibold">Current behavior</h2>
        <p>
          Short paragraphs and descriptive headings make long task content easier to scan. Inline{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">code</code> uses a
          distinct surface without competing with the message.
        </p>
        <p className="break-all text-muted-foreground">
          Overflow example:
          https://runtime.example.invalid/projects/dovo-studio/threads/0123456789abcdef0123456789abcdef
        </p>
      </section>
    </article>
  ),
  parameters: story(
    'A static specimen for content hierarchy: eyebrow, page title, supporting summary, low-emphasis metadata, section heading, body copy, inline code, and a breakable long URL. Inspect at a narrow viewport for wrapping behavior.',
  ),
}
