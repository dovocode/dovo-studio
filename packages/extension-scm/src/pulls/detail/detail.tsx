import { PullStack } from './stack'
import { CreatePull } from '../list/create'
import { useApplicationState } from '@dovo/studio-core/state'
import { useLayoutEffect, useRef } from 'react'
import { usePullDetail } from './use-pull-detail'
import {
  useWorkspace,
  pullState,
  pullDetailChecks,
  pullDetailReviews,
  pullMergeability,
  latestPullReviews,
  forgeLabels,
  formatDateTime,
} from '@dovo/studio-core'
import { Button, Badge, MessageResponse } from '@dovo/studio-ui'
import {
  ArrowLeft,
  ArrowUpRight,
  FileDiff,
  GitBranch,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { PullComments } from './comments'
import { PullChanges } from './changes'
import { PullStatus, Signal } from './status'
import { StartPullTask } from '../list/start-task'
import { ReviewBadge } from './review-badge'
import { PullActions, PullCommentComposer } from '../list/actions'
import { PullPipelineRuns } from './pipeline-runs'
type PullDetailProps = {
  embedded?: boolean
  repositoryId: string
  number: number
  onBack: () => void
  onChanged: () => void
  onSelect?: (number: number) => void
}
export function PullDetail(props: PullDetailProps) {
  return <PullDetailSelection key={JSON.stringify([props.repositoryId, props.number])} {...props} />
}
function PullDetailSelection(props: PullDetailProps) {
  const [selectedNumber, setSelectedNumber] = useApplicationState(props.number)
  const number = props.onSelect ? props.number : selectedNumber
  return (
    <PullDetailContent
      key={JSON.stringify([props.repositoryId, number])}
      {...props}
      number={number}
      onSelect={props.onSelect ?? setSelectedNumber}
    />
  )
}
function PullDetailContent({
  repositoryId,
  number,
  onBack,
  onChanged,
  onSelect,
  embedded = false,
}: PullDetailProps) {
  const { connected, workspace } = useWorkspace()
  const { detail, error, busy, refresh, invalidate } = usePullDetail(repositoryId, number)
  const changed = () => {
    invalidate()
    onChanged()
  }
  const [stackAction, setStackAction] = useApplicationState<'update' | undefined>(undefined)
  const [creatingStack, setCreatingStack] = useApplicationState(false)
  const selectPull = (next: number) => onSelect?.(next)
  const [starting, setStarting] = useApplicationState(false)
  const [tab, setTab] = useApplicationState<'overview' | 'changes' | 'checks'>('overview')
  const content = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef({ overview: 0, changes: 0, checks: 0 })
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = scrollPositions.current[tab]
  }, [tab])
  const [changesOpened, setChangesOpened] = useApplicationState(false)
  const [objective, setObjective] = useApplicationState<string | undefined>(undefined)
  const [discussionFilter, setDiscussionFilter] = useApplicationState<'all' | 'review' | 'comment'>(
    'all',
  )
  const discussion = detail?.comments.filter((comment) => comment.kind !== 'inline') ?? []
  const reviews = latestPullReviews(discussion)
  const selectTab = (value: typeof tab) => {
    if (content.current) scrollPositions.current[tab] = content.current.scrollTop
    setTab(value)
    if (value === 'changes') setChangesOpened(true)
  }
  const stackControls = detail && (
    <PullStack
      detail={detail}
      connected={connected}
      onSelect={selectPull}
      onCreate={() => setCreatingStack(true)}
      onUpdate={() => {
        setStackAction('update')
        setStarting(true)
      }}
    />
  )
  return (
    <aside
      aria-label="Pull request details"
      className="@container/pr-detail flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div
        className="min-h-0 max-h-[60%] shrink-0 overflow-y-auto overscroll-contain"
        aria-label="Pull request controls"
      >
        <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" /> {embedded ? 'Close preview' : 'Back to PRs'}
          </Button>
          <span className="mr-auto min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {workspace.repositories.find((repo) => repo.id === repositoryId)?.name}
          </span>
          <Button
            size="icon"
            className="size-8"
            variant="ghost"
            aria-label="Refresh details"
            disabled={!connected || busy}
            onClick={refresh}
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          </Button>
          {detail && (
            <Button
              size="sm"
              variant="outline"
              aria-label="New task"
              title="Start a task from this PR"
              disabled={!connected}
              onClick={() => {
                setObjective(undefined)
                setStarting(true)
              }}
            >
              <Plus className="size-3.5" />
              <span className="hidden @lg/pr-detail:inline">New task</span>
            </Button>
          )}
          {detail && (
            <PullActions
              repositoryId={repositoryId}
              detail={detail}
              onDone={changed}
              onStartTask={() => {
                setObjective(undefined)
                setStarting(true)
              }}
            />
          )}
        </div>
        {!detail && (
          <p
            role={error ? 'alert' : 'status'}
            className={`p-6 text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {error || (connected ? 'Loading PR details…' : 'Connect to the runtime.')}
          </p>
        )}
        {detail && (
          <>
            <header className="shrink-0 space-y-3 border-b px-4 py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">
                  <Signal signal={pullState(detail.pull)} />
                </Badge>
                <span className="max-w-full truncate" title={detail.pull.author}>
                  #{number} · {detail.pull.author}
                </span>
                <a
                  data-dovo-external="true"
                  href={detail.pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                >
                  Open on {forgeLabels[detail.pull.provider ?? 'github']}
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
              <h2
                className="line-clamp-3 break-words text-lg font-semibold leading-snug"
                title={detail.pull.title}
              >
                {detail.pull.title}
              </h2>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5"
                  title={`${detail.pull.head} → ${detail.pull.base}`}
                >
                  <GitBranch aria-hidden className="size-3.5 shrink-0" />
                  <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5">
                    {detail.pull.head}
                  </code>
                  <span aria-hidden>→</span>
                  <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5">
                    {detail.pull.base}
                  </code>
                </span>
                <span className="font-mono" title={detail.pull.headSha}>
                  {detail.pull.headSha.slice(0, 8)}
                </span>
                <span className="ml-auto inline-flex shrink-0 gap-2 font-mono tabular-nums">
                  <span className="text-emerald-400">
                    +{detail.pull.additions?.toLocaleString() ?? '—'}
                  </span>
                  <span className="text-red-400">
                    −{detail.pull.deletions?.toLocaleString() ?? '—'}
                  </span>
                </span>
              </div>
            </header>
            <div
              role="tablist"
              aria-label="PR detail sections"
              className="flex shrink-0 gap-1 overflow-x-auto border-b px-3"
            >
              {(
                [
                  {
                    id: 'overview',
                    label: 'Overview',
                    count: discussion.length,
                    icon: MessageSquare,
                  },
                  { id: 'changes', label: 'Changes', count: detail.files.length, icon: FileDiff },
                  { id: 'checks', label: 'Checks', count: detail.checks.length, icon: ListChecks },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`pr-tab-${item.id}`}
                  aria-label={item.id === 'overview' ? item.label : `${item.label} (${item.count})`}
                  aria-controls={`pr-panel-${item.id}`}
                  aria-selected={tab === item.id}
                  tabIndex={tab === item.id ? 0 : -1}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const tabs = [
                      ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      ) ?? []),
                    ]
                    const index = tabs.indexOf(event.currentTarget)
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                            tabs.length
                    tabs[next]?.click()
                    tabs[next]?.focus()
                  }}
                  onClick={() => selectTab(item.id)}
                  className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-medium ${tab === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  <item.icon aria-hidden className="size-3.5" />
                  {item.label}
                  <span
                    aria-hidden
                    className="rounded bg-muted px-1.5 text-[0.625rem] tabular-nums text-muted-foreground"
                  >
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
            <div
              className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/10 px-4 py-2.5"
              aria-label="Pull request status"
            >
              <button
                type="button"
                aria-label="View pull request checks"
                onClick={() => selectTab('checks')}
                className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Signal signal={pullDetailChecks(detail)} />
              </button>
              <Signal signal={pullDetailReviews(detail)} />
              <Signal signal={pullMergeability(detail.pull)} />
            </div>
          </>
        )}
      </div>
      {detail && (
        <>
          <div
            ref={content}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4"
            aria-label="Pull request content"
          >
            {error && (
              <p
                role="alert"
                className="mb-4 rounded-md border border-destructive/30 p-3 text-xs text-destructive [overflow-wrap:anywhere]"
              >
                {error}
              </p>
            )}
            {(detail.stale || detail.refreshError || !connected) && (
              <p role="status" className="mb-4 text-xs text-amber-400 [overflow-wrap:anywhere]">
                {!connected
                  ? 'Offline · showing last loaded details.'
                  : detail.refreshError
                    ? `Refresh failed: ${detail.refreshError}`
                    : 'Showing cached details · refreshing in background.'}
                {detail.cachedAt
                  ? ` Last fetched ${formatDateTime(detail.cachedAt, { timeStyle: 'medium' })}.`
                  : ''}
              </p>
            )}
            {detail.warnings.map((warning) => (
              <p
                key={warning}
                role="alert"
                className="mb-4 rounded-md border border-amber-400/20 px-3 py-2 text-xs text-amber-400 [overflow-wrap:anywhere]"
              >
                {warning}
              </p>
            ))}
            <section
              role="tabpanel"
              id="pr-panel-overview"
              aria-labelledby="pr-tab-overview"
              className="space-y-5"
              hidden={tab !== 'overview'}
            >
              {detail.stack && stackControls}
              <div className="grid items-start gap-5 @4xl/pr-detail:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0 space-y-6">
                  <section
                    aria-label="PR description"
                    className="min-w-0 overflow-hidden rounded-lg border"
                  >
                    <h3 className="flex items-center gap-2 border-b bg-muted/20 px-4 py-3 text-xs font-medium">
                      {detail.pull.author}
                      <span className="font-normal text-muted-foreground">Description</span>
                    </h3>
                    <div className="min-w-0 p-4 text-sm leading-7">
                      <MessageResponse
                        baseURL={detail.pull.url}
                        fileBaseURL={
                          detail.fileBaseUrl ??
                          `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
                        }
                      >
                        {detail.pull.body || 'No description provided.'}
                      </MessageResponse>
                    </div>
                  </section>
                  <section id="pr-panel-discussion" aria-label="Pull request activity">
                    <div className="mb-4 flex flex-wrap items-center gap-1">
                      <h3 className="mr-auto text-sm font-medium">Activity</h3>
                      {(
                        [
                          { id: 'all', label: 'All activity', count: discussion.length },
                          {
                            id: 'review',
                            label: 'Reviews',
                            count: discussion.filter((comment) => comment.kind === 'review').length,
                          },
                          {
                            id: 'comment',
                            label: 'Comments',
                            count: discussion.filter((comment) => comment.kind === 'comment')
                              .length,
                          },
                        ] as const
                      ).map((filter) => (
                        <Button
                          key={filter.id}
                          size="sm"
                          variant={discussionFilter === filter.id ? 'secondary' : 'ghost'}
                          aria-pressed={discussionFilter === filter.id}
                          onClick={() => setDiscussionFilter(filter.id)}
                        >
                          {filter.label}{' '}
                          <span className="text-muted-foreground">{filter.count}</span>
                        </Button>
                      ))}
                    </div>
                    <PullComments
                      fileBaseURL={
                        detail.fileBaseUrl ??
                        `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
                      }
                      actionContext={{ repositoryId, detail, onDone: changed }}
                      comments={discussion.filter(
                        (comment) =>
                          discussionFilter === 'all' || comment.kind === discussionFilter,
                      )}
                    />
                  </section>
                  <PullCommentComposer
                    repositoryId={repositoryId}
                    detail={detail}
                    onDone={changed}
                  />
                </div>
                <aside
                  aria-label="Pull request metadata"
                  className="min-w-0 space-y-5 border-t pt-4 text-xs @4xl/pr-detail:border-l @4xl/pr-detail:border-t-0 @4xl/pr-detail:pl-5 @4xl/pr-detail:pt-0"
                >
                  <div>
                    <h3 className="mb-2 font-medium">Review decisions</h3>
                    {reviews.length ? (
                      <div className="space-y-3">
                        {reviews.map((review) => (
                          <div key={review.author} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words">{review.author}</span>
                            <ReviewBadge comment={review} />
                            {review.commitId && (
                              <span
                                className="font-mono text-[0.6875rem] text-muted-foreground"
                                title={`Reviewed commit ${review.commitId}`}
                              >
                                {review.commitId.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No review decision yet</p>
                    )}
                  </div>
                  <dl className="space-y-5">
                    <div>
                      <dt className="font-medium">Requested reviewers</dt>
                      <dd className="mt-2 break-words text-muted-foreground">
                        {detail.pull.reviewers.join(', ') || 'None requested'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">Assignees</dt>
                      <dd className="mt-2 break-words text-muted-foreground">
                        {detail.pull.assignees.join(', ') || 'Unassigned'}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">Labels</dt>
                      <dd className="mt-2 flex flex-wrap gap-1">
                        {detail.pull.labels.length ? (
                          detail.pull.labels.map((label) => (
                            <Badge
                              key={label}
                              variant="secondary"
                              className="max-w-full whitespace-normal break-all"
                            >
                              {label}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">No labels</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">Updated</dt>
                      <dd className="mt-2 text-muted-foreground">
                        <time dateTime={detail.pull.updatedAt}>
                          {formatDateTime(detail.pull.updatedAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  {!detail.stack && stackControls}
                  <Button size="sm" variant="outline" onClick={() => selectTab('changes')}>
                    <FileDiff className="size-3.5" />
                    Review{' '}
                    {detail.pull.changedFiles === null
                      ? 'code changes'
                      : `${detail.pull.changedFiles} files`}
                  </Button>
                </aside>
              </div>
            </section>
            <section
              role="tabpanel"
              id="pr-panel-checks"
              aria-labelledby="pr-tab-checks"
              hidden={tab !== 'checks'}
            >
              {tab === 'checks' && (
                <PullPipelineRuns
                  key={detail.pull.headSha}
                  repositoryId={repositoryId}
                  sha={detail.pull.headSha}
                />
              )}
              <PullStatus detail={detail} />
            </section>
            <section
              role="tabpanel"
              id="pr-panel-changes"
              aria-labelledby="pr-tab-changes"
              hidden={tab !== 'changes'}
            >
              {changesOpened && (
                <PullChanges
                  key={detail.pull.headSha}
                  detail={detail}
                  embedded={embedded}
                  repositoryId={repositoryId}
                  onPosted={changed}
                  onSteer={(value) => {
                    setObjective(value)
                    setStarting(true)
                  }}
                />
              )}
            </section>
          </div>
          {creatingStack && (
            <CreatePull
              initialRepositoryId={repositoryId}
              initialParent={detail.pull}
              onClose={() => setCreatingStack(false)}
              onCreated={(_repo, next) => {
                changed()
                selectPull(next)
              }}
            />
          )}
          {starting && (
            <StartPullTask
              initialObjective={objective}
              stackAction={stackAction}
              repositoryId={repositoryId}
              pull={detail.pull}
              onClose={() => {
                setStarting(false)
                setStackAction(undefined)
              }}
            />
          )}
        </>
      )}
    </aside>
  )
}
