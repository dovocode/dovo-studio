import { PullStack } from './stack'
import { CreatePull } from '../list/create'
import { useApplicationState } from '@dovo/studio-core/state'
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
import { ArrowLeft, ArrowUpRight, GitBranch, RefreshCw } from 'lucide-react'
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
  const [tab, setTab] = useApplicationState<'overview' | 'changes'>('overview')
  const [changesOpened, setChangesOpened] = useApplicationState(false)
  const [objective, setObjective] = useApplicationState<string | undefined>(undefined)
  const [discussionFilter, setDiscussionFilter] = useApplicationState<'all' | 'review' | 'comment'>(
    'all',
  )
  const discussion = detail?.comments.filter((comment) => comment.kind !== 'inline') ?? []
  const reviews = latestPullReviews(discussion)
  const selectTab = (value: typeof tab) => {
    setTab(value)
    if (value === 'changes') setChangesOpened(true)
  }
  return (
    <aside aria-label="Pull request details" className="@container min-w-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-5 py-2 backdrop-blur">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> {embedded ? 'Close preview' : 'Back to PRs'}
        </Button>
        <span className="mr-auto min-w-0 flex-1 basis-24 truncate text-xs text-muted-foreground">
          {detail?.pull.title ??
            workspace.repositories.find((repo) => repo.id === repositoryId)?.name}{' '}
          · #{number}
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
            disabled={!connected}
            onClick={() => {
              setObjective(undefined)
              setStarting(true)
            }}
          >
            New task
          </Button>
        )}
        {detail && <Badge variant="outline">{pullState(detail.pull).label}</Badge>}
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
      {error && (
        <p
          role="alert"
          className="m-4 rounded-lg border border-destructive/30 p-3 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {!detail && !error && (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          {connected ? 'Loading PR details…' : 'Connect to the runtime.'}
        </p>
      )}
      {detail && (
        <>
          <div
            role="tablist"
            aria-label="PR detail sections"
            className="sticky top-12 z-10 flex gap-1 overflow-x-auto border-b bg-background/95 px-5 backdrop-blur"
          >
            {(
              [
                {
                  id: 'overview',
                  label: 'Overview',
                },
                {
                  id: 'changes',
                  label: `Changes (${detail.files.length})`,
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`pr-tab-${item.id}`}
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
                className={`shrink-0 border-b-2 px-3 py-3 text-xs font-medium ${tab === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {item.label}
                {item.id === 'changes' && (
                  <span className="ml-2 tabular-nums">
                    <span className="text-emerald-400">+{detail.pull.additions ?? '—'}</span>{' '}
                    <span className="text-red-400">−{detail.pull.deletions ?? '—'}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="min-w-0 p-5">
            <header hidden={tab !== 'overview'} className="space-y-3 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{pullState(detail.pull).label}</Badge>
                <span className="text-xs text-muted-foreground">
                  #{number} · {detail.pull.author}
                </span>
                <a
                  data-dovo-external="true"
                  href={detail.pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open on {forgeLabels[detail.pull.provider ?? 'github']}{' '}
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
              <h2 className="break-words text-xl font-semibold leading-snug">
                {detail.pull.title}
              </h2>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="break-all font-mono">
                  {detail.pull.head} → {detail.pull.base}
                  <span className="ml-2 text-muted-foreground" title={detail.pull.headSha}>
                    {detail.pull.headSha.slice(0, 8)}
                  </span>
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <Signal signal={pullDetailChecks(detail)} />
                <Signal signal={pullDetailReviews(detail)} />
                <Signal signal={pullMergeability(detail.pull)} />
              </div>
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
              <dl className="grid grid-cols-2 gap-3 rounded-md border bg-card px-3 py-3 text-xs @2xl:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Changes</dt>
                  <dd className="mt-1 font-medium">
                    {detail.pull.changedFiles === null
                      ? 'File count unavailable'
                      : `${detail.pull.changedFiles} files`}
                    {detail.pull.additions !== null && detail.pull.deletions !== null && (
                      <span className="ml-2 tabular-nums">
                        <span className="text-emerald-400">+{detail.pull.additions}</span>{' '}
                        <span className="text-red-400">−{detail.pull.deletions}</span>
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Requested reviewers</dt>
                  <dd className="mt-1 break-words">
                    {detail.pull.reviewers.join(', ') || 'None requested'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Assignees</dt>
                  <dd className="mt-1 break-words">
                    {detail.pull.assignees.join(', ') || 'Unassigned'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="mt-1">{formatDateTime(detail.pull.updatedAt)}</dd>
                </div>
              </dl>
              {(detail.stale || detail.refreshError || !connected) && (
                <p role="status" className="text-xs text-amber-400">
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
                  className="rounded-lg border border-amber-400/20 px-3 py-2 text-xs text-amber-400"
                >
                  {warning}
                </p>
              ))}
            </header>

            <section
              role="tabpanel"
              id="pr-panel-overview"
              aria-labelledby="pr-tab-overview"
              hidden={tab !== 'overview'}
            >
              <div className="grid items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_240px]">
                <section
                  aria-label="PR description"
                  className="min-w-0 overflow-hidden rounded-xl border"
                >
                  <h3 className="border-b bg-muted/20 px-4 py-3 text-xs font-medium">
                    {detail.pull.author}{' '}
                    <span className="ml-2 font-normal text-muted-foreground">Description</span>
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
                <aside className="min-w-0 space-y-4 border-t pt-4 text-xs @4xl:border-l @4xl:border-t-0 @4xl:pl-5 @4xl:pt-0">
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
                  <div>
                    <h3 className="mb-2 font-medium">Labels</h3>
                    <div className="flex flex-wrap gap-1">
                      {detail.pull.labels.length ? (
                        detail.pull.labels.map((label) => (
                          <Badge key={label} variant="secondary">
                            {label}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">No labels</span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => selectTab('changes')}>
                    Review code changes
                  </Button>
                </aside>
              </div>
            </section>
            <section
              className="mt-8 border-t pt-6"
              id="pr-panel-discussion"
              aria-label="Pull request activity"
              hidden={tab !== 'overview'}
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-medium">Activity</h3>
                {(
                  [
                    {
                      id: 'all',
                      label: 'All activity',
                      count: discussion.length,
                    },
                    {
                      id: 'review',
                      label: 'Reviews',
                      count: discussion.filter((comment) => comment.kind === 'review').length,
                    },
                    {
                      id: 'comment',
                      label: 'Comments',
                      count: discussion.filter((comment) => comment.kind === 'comment').length,
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
                    {filter.label} <span className="text-muted-foreground">{filter.count}</span>
                  </Button>
                ))}
              </div>
              <PullComments
                fileBaseURL={
                  detail.fileBaseUrl ?? `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
                }
                actionContext={{
                  repositoryId,
                  detail,
                  onDone: changed,
                }}
                comments={discussion.filter(
                  (comment) => discussionFilter === 'all' || comment.kind === discussionFilter,
                )}
              />
            </section>
            <section
              className="mt-8 border-t pt-6"
              id="pr-panel-checks"
              aria-label="Pull request checks"
              hidden={tab !== 'overview'}
            >
              {tab === 'overview' && (
                <PullPipelineRuns
                  key={detail.pull.headSha}
                  repositoryId={repositoryId}
                  sha={detail.pull.headSha}
                />
              )}
              <PullStatus detail={detail} />
              <PullCommentComposer repositoryId={repositoryId} detail={detail} onDone={changed} />
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
