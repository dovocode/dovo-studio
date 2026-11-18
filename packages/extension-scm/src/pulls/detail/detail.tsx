import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@dovo/studio-ui/tabs'
import { PullReadinessPanel } from './readiness'
import { PullLinkedThreads } from './linked-threads'
import { AuthorAvatar } from '../author-avatar'
import {
  buildPullReviewObjective,
  pullChangesRevisionPending,
  pullChangesSnapshot,
  pullReadiness,
  pullLinkedTasks,
  type PullReviewSelection,
  type Task,
} from '@dovo/protocol'
import { PullSectionStatus } from './section-status'
import { PullStack } from './stack'
import { CreatePull } from '../list/create'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePullDetail } from './use-pull-detail'
import {
  useWorkspace,
  useStudioHost,
  pullState,
  pullChecks,
  pullDetailChecks,
  pullDetailReviews,
  pullMergeability,
  latestPullReviews,
  forgeLabels,
  formatDateTime,
  type PullSignal,
} from '@dovo/studio-core'
import {
  HeaderContent,
  Button,
  Badge,
  MessageResponse,
  ProjectIcon,
  DropdownMenu,
} from '@dovo/studio-ui'
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  FileDiff,
  GitBranch,
  ListChecks,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { PullComments } from './comments'
import { PullChanges } from './changes'
import { PullStatus, Signal } from './status'
import { StartPullTask } from '../list/start-task'
import { ReviewBadge } from './review-badge'
import { PullActions, PullCommentComposer } from '../list/actions'
import { PullCodeReviewPanel } from './code-review'
import { PullAskAgent } from './ask-agent'
import { PullPipelineRunsContent, usePullPipelineRuns } from './pipeline-runs'
import { pipelineSignal } from '@dovo/protocol'
import { createPullStateCache, useRetainedPullState, usePullStateKey } from '../retained-state'
type PullTab = 'overview' | 'changes' | 'checks' | 'review'
const tabCache = createPullStateCache<PullTab>(50)
const scrollCache = createPullStateCache<Record<PullTab, number>>(50)
type PullDetailProps = {
  embedded?: boolean
  repositoryId: string
  connectionId?: string
  number: number
  onBack: () => void
  onChanged: () => void
  onSelect?: (number: number) => void
  onTabChange?: (tab: Exclude<PullTab, 'review'>) => void
  initialTab?: PullTab
  configureInitialReview?: boolean
  initialReviewRun?: () => boolean
  onInitialReviewOpened?: () => void
  initialFragment?: string
  /**
   * The thread showing this PR. Agent feedback goes to it only when it explicitly links this PR;
   * otherwise feedback starts a new task as usual.
   */
  linkedThread?: {
    task: Pick<Task, 'title' | 'pullRequest' | 'linkedPullRequests' | 'example'>
    onAsk: (objective: string) => void
  }
}
export function PullDetail(props: PullDetailProps) {
  const { activeRuntimeId } = useWorkspace()
  return (
    <PullDetailSelection
      key={JSON.stringify([activeRuntimeId, props.repositoryId, props.number, props.connectionId])}
      {...props}
    />
  )
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
  connectionId,
  onBack,
  onChanged,
  onSelect,
  onTabChange,
  embedded = false,
  initialTab,
  configureInitialReview,
  initialReviewRun,
  onInitialReviewOpened,
  initialFragment = '',
  linkedThread,
}: PullDetailProps) {
  const uiText = useInterfaceText()
  const host = useStudioHost()

  const { connected, workspace, snapshot, activeRuntimeId } = useWorkspace()
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const changed = () => {
    invalidate()
    onChanged()
  }
  const [stackAction, setStackAction] = useApplicationState<'update' | undefined>(undefined)
  const [creatingStack, setCreatingStack] = useApplicationState(false)
  const selectPull = (next: number) => onSelect?.(next)
  const [starting, setStarting] = useApplicationState(false)
  const stateKey = usePullStateKey(repositoryId, number, connectionId)
  const [tab, setTab] = useRetainedPullState(tabCache, stateKey, initialTab ?? 'overview')
  const { detail, error, busy, readConnected, refresh, invalidate, sections } = usePullDetail(
    repositoryId,
    number,
    connectionId,
    { tab, discussionInOverview: true },
  )
  const pipelineRuns = usePullPipelineRuns({
    repositoryId,
    sha: detail?.pull.headSha ?? '',
    active: !!detail,
  })
  const failedRuns = pipelineRuns.runs.filter(
    (run) => pipelineSignal(run.status).tone === 'danger',
  ).length
  const activeRuns = pipelineRuns.runs.filter(
    (run) => pipelineSignal(run.status).phase === 'active',
  ).length
  const pipelineSummary = failedRuns
    ? { label: `Pipeline runs: ${failedRuns} failed`, tone: 'danger' as const }
    : activeRuns
      ? { label: `Pipeline runs: ${activeRuns} running`, tone: 'warning' as const }
      : pipelineRuns.runs.length &&
          pipelineRuns.runs.every((run) => pipelineSignal(run.status).tone === 'success')
        ? { label: `Pipeline runs: ${pipelineRuns.runs.length} passed`, tone: 'positive' as const }
        : { label: `Pipeline runs: ${pipelineRuns.runs.length} loaded`, tone: 'neutral' as const }
  const checksReady = sections.checks.ready
  const checkSummary: PullSignal = sections.checks.error
    ? { label: 'Check reports unavailable', tone: 'warning' }
    : detail && checksReady
      ? {
          ...pullDetailChecks(detail),
          label: `Check reports: ${pullDetailChecks(detail).label}${
            !sections.checks.readConnected
              ? ' · offline'
              : sections.checks.detail?.stale
                ? ' · saved'
                : ''
          }`,
          ...(!sections.checks.readConnected || sections.checks.detail?.stale
            ? { tone: 'warning' as const }
            : {}),
        }
      : {
          label: sections.checks.readConnected ? 'Loading checks…' : 'Check reports offline',
          tone: 'neutral',
        }
  const reviewSummary: PullSignal =
    detail && (sections.status.ready || sections.discussion.ready)
      ? pullDetailReviews(detail)
      : { label: 'Review status not loaded', tone: 'neutral' }
  const reportsFailed =
    checksReady && !sections.checks.error && !!detail && pullDetailChecks(detail).tone === 'danger'
  const checkFailure =
    failedRuns > 0 && reportsFailed
      ? 'CI failed'
      : failedRuns > 0
        ? 'Pipeline failed'
        : reportsFailed
          ? 'Checks failed'
          : undefined
  const ciSummary = detail ? pullChecks(detail.pull) : undefined
  const pipelineStatus: PullSignal = pipelineRuns.runs.length
    ? pipelineSummary
    : {
        label: pipelineRuns.busy ? 'Loading pipeline runs…' : 'No pipeline runs loaded',
        tone: 'neutral',
      }
  const repositorySource = ciSummary
    ? {
        name: 'Repository CI',
        signal: { ...ciSummary, label: ciSummary.label.replace(/^CI status: /, '') },
      }
    : undefined
  const statusSources = [
    ...(repositorySource ? [repositorySource] : []),
    {
      name: 'Check reports',
      signal: { ...checkSummary, label: checkSummary.label.replace(/^Check reports: /, '') },
    },
    {
      name: 'Linked pipeline runs',
      signal: { ...pipelineStatus, label: pipelineStatus.label.replace(/^Pipeline runs: /, '') },
    },
  ]
  const [previousChanges, setPreviousChanges] = useState<typeof detail>(null)
  const revisionPending = pullChangesRevisionPending(detail, previousChanges)
  const changesCurrent = sections.changes.ready && !revisionPending
  const changesDetail = pullChangesSnapshot(detail, sections.changes.ready, previousChanges)
  useEffect(() => {
    if (changesCurrent) setPreviousChanges(detail)
  }, [detail, changesCurrent])

  const content = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(
    scrollCache.read(stateKey) ?? { overview: 0, changes: 0, checks: 0, review: 0 },
  )
  // Hide the previous panel in the same commit so it cannot shift the restored scroll position.
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = scrollPositions.current[tab]
  }, [tab, !!detail])
  const [changesOpened, setChangesOpened] = useApplicationState(tab === 'changes')
  const [checksOpened, setChecksOpened] = useApplicationState(tab === 'checks')
  const [reviewConfigurationRequest, setReviewConfigurationRequest] = useApplicationState(0)
  const [rowReviewRun, setRowReviewRun] = useState<(() => boolean) | undefined>()
  const runReview = useRef<(() => void) | null>(null)
  const [reviewStatus, setReviewStatus] = useApplicationState<{
    running: boolean
    findings: number
    stale: boolean
    hasReport: boolean
    canRun: boolean
  }>({ running: false, findings: 0, stale: false, hasReport: false, canRun: false })
  useEffect(() => {
    if (tab === 'review' && !snapshot?.codeReviewsEnabled) setTab('overview')
  }, [tab, snapshot?.codeReviewsEnabled])
  const [objectiveBaseline, setObjectiveBaseline] = useApplicationState<
    { headSha: string; expectedDestination?: string } | undefined
  >(undefined)
  const [objective, setObjective] = useApplicationState<string | undefined>(undefined)
  const [discussionFilter, setDiscussionFilter] = useApplicationState<'all' | 'review' | 'comment'>(
    'all',
  )
  const thread =
    linkedThread && detail && pullLinkedTasks([linkedThread.task], detail.pull.url).length
      ? { title: linkedThread.task.title, onAsk: linkedThread.onAsk }
      : undefined
  // Without a hosting thread that links this PR, agent questions go through an explicit chooser.
  const [asking, setAsking] = useApplicationState<{ selection?: PullReviewSelection } | null>(null)
  const discussion = detail?.comments.filter((comment) => comment.kind !== 'inline') ?? []
  const reviews = latestPullReviews(discussion)
  const selectTab = (value: typeof tab) => {
    if (value !== 'review') rowReviewRun?.()
    if (content.current) scrollPositions.current[tab] = content.current.scrollTop
    scrollCache.write(stateKey, { ...scrollPositions.current })
    setTab(value)
    if (value !== tab && value !== 'review') onTabChange?.(value)
    if (value === 'changes') setChangesOpened(true)
    if (value === 'checks') setChecksOpened(true)
  }
  const [summaryFragment, setSummaryFragment] = useApplicationState('')
  const [summaryTarget, setSummaryTarget] = useApplicationState<string | null>(null)
  const openReadiness = (section: 'checks' | 'comments' | 'approvals') => {
    if (section === 'comments') {
      const inline =
        detail?.comments.find(
          (comment) => comment.kind === 'inline' && comment.resolved === false,
        ) ?? detail?.comments.find((comment) => comment.kind === 'inline')
      if (inline) {
        setSummaryFragment(new URL(inline.url).hash || `#${inline.id}`)
        selectTab('changes')
        return
      }
    }
    setSummaryFragment('')
    setDiscussionFilter(section === 'approvals' ? 'review' : 'all')
    selectTab(section === 'checks' ? 'checks' : 'overview')
    setSummaryTarget(section === 'checks' ? 'pr-panel-checks' : 'pr-panel-discussion')
  }
  useEffect(() => {
    if (!summaryTarget) return
    const frame = requestAnimationFrame(() => {
      const target = content.current?.querySelector<HTMLElement>(`#${summaryTarget}`)
      target?.scrollIntoView({ block: 'start' })
      target?.focus({ preventScroll: true })
      setSummaryTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [summaryTarget, tab])
  useEffect(() => {
    setSummaryFragment('')
    if (initialTab) selectTab(initialTab)
    if (initialTab === 'review' && configureInitialReview)
      setReviewConfigurationRequest((request) => request + 1)
    if (initialTab === 'review') {
      setRowReviewRun(() => initialReviewRun)
      onInitialReviewOpened?.()
    }
  }, [initialTab, initialFragment, configureInitialReview, initialReviewRun])
  const scrolledFragment = useRef('')
  useEffect(() => {
    if (!initialFragment || !detail || scrolledFragment.current === initialFragment) return
    const comment = detail.comments.find(
      (item) => item.url.endsWith(initialFragment) || `#${item.id}` === initialFragment,
    )
    if (comment) {
      const destination = comment.kind === 'inline' ? 'changes' : 'overview'
      if (tab !== destination) {
        selectTab(destination)
        return
      }
      setDiscussionFilter('all')
    }
    const frame = requestAnimationFrame(() => {
      const target = [
        ...(content.current?.querySelectorAll<HTMLElement>('[id], [data-comment-fragment]') ?? []),
      ].find(
        (element) =>
          `#${element.id}` === initialFragment ||
          element.dataset.commentFragment === initialFragment,
      )
      if (target && target.getClientRects().length) {
        target.scrollIntoView({ block: 'start' })
        scrolledFragment.current = initialFragment
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [initialFragment, detail, tab, discussionFilter, changesOpened])
  const stackControls = detail && repository && (
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
    <Tabs
      id="pr"
      render={<aside />}
      value={tab}
      onValueChange={(value) => {
        if (value === 'overview' || value === 'changes' || value === 'checks' || value === 'review')
          selectTab(value)
      }}
      aria-label="Pull request details"
      className="@container/pr-detail flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <HeaderContent enabled={!embedded}>
        <header
          className="studio-task-thread-header studio-pull-header"
          data-window-edge={!embedded || undefined}
          data-window-right-edge={!embedded || undefined}
          data-embedded={embedded || undefined}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            aria-label={embedded ? 'Close preview' : 'Back to PRs'}
            className="shrink-0 px-2"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden @lg/pr-detail:inline">
              {embedded ? 'Close preview' : 'Back to PRs'}
            </span>
          </Button>
          <ProjectIcon
            repository={workspace.repositories.find((repo) => repo.id === repositoryId)}
            className="size-4 max-sm:hidden @max-sm/pr-detail:hidden"
          />
          <h1 className="studio-titlebar-heading min-w-0 flex-1" title={detail?.pull.title}>
            <span className="studio-titlebar-project">
              {repository?.name ?? detail?.pull.repositoryUrl.split('/').slice(-2).join('/')}
            </span>
            <span className="studio-titlebar-divider">/</span>
            <span className="studio-titlebar-task">{`PR #${number}`}</span>
          </h1>
          <Button
            size="icon"
            className="size-8"
            variant="ghost"
            aria-label="Refresh details"
            disabled={!readConnected || busy}
            onClick={refresh}
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          </Button>
          {detail && repository && (
            <StartPullTask
              repositoryId={repositoryId}
              pull={
                objectiveBaseline
                  ? {
                      ...detail.pull,
                      headSha: objectiveBaseline.headSha,
                      destination: objectiveBaseline.expectedDestination,
                    }
                  : detail.pull
              }
              initialObjective={objective}
              stackAction={stackAction}
              open={starting}
              onOpenChange={(open) => {
                setStarting(open)
                setObjective(undefined)
                setObjectiveBaseline(undefined)
                setStackAction(undefined)
              }}
            />
          )}
        </header>
      </HeaderContent>
      <div
        className="min-h-0 max-h-[calc((100%-var(--studio-header-height,52px))/2)] shrink-0 overflow-y-auto overscroll-contain"
        aria-label="Pull request controls"
      >
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
            <header className="shrink-0 space-y-2 border-b border-border/60 px-4 py-3">
              <h2
                className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]"
                data-testid="PR title"
              >
                {detail.pull.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">
                  <Signal signal={pullState(detail.pull)} />
                </Badge>
                <span
                  className="inline-flex min-w-0 items-center gap-1.5"
                  title={detail.pull.author}
                >
                  <AuthorAvatar author={detail.pull.author} url={detail.pull.authorAvatarUrl} />
                  <span className="truncate">{detail.pull.author}</span>
                </span>
                <span>#{number}</span>
                <time
                  dateTime={detail.pull.updatedAt}
                  title={formatDateTime(detail.pull.updatedAt)}
                >
                  Updated {formatDateTime(detail.pull.updatedAt, { dateStyle: 'medium' })}
                </time>
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
              <PullSectionStatus label="Status" section={sections.status} />
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
                <span className="ml-auto inline-flex flex-wrap items-center gap-3 tabular-nums">
                  <button
                    type="button"
                    onClick={() => selectTab('changes')}
                    className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label="View pull request files"
                  >
                    <FileDiff className="size-3.5" aria-hidden />
                    {detail.pull.changedFiles?.toLocaleString() ?? '—'}{' '}
                    {detail.pull.changedFiles === 1 ? 'file' : 'files'}
                  </button>
                  <span className="text-status-success">
                    +{detail.pull.additions?.toLocaleString() ?? '—'}
                  </span>
                  <span className="text-status-error">
                    −{detail.pull.deletions?.toLocaleString() ?? '—'}
                  </span>
                </span>
              </div>
            </header>
            <div className="flex flex-wrap items-center border-b border-border/60">
              <TabsList
                aria-label="PR detail sections"
                className="flex min-w-0 shrink-0 gap-1 overflow-x-auto px-4 py-1"
              >
                {(
                  [
                    {
                      id: 'overview',
                      label: 'Overview',
                      count: sections.discussion.ready ? discussion.length : undefined,
                      icon: MessageSquare,
                    },
                    {
                      id: 'changes',
                      label: 'Changes',
                      count: sections.changes.ready
                        ? detail.files.length
                        : (detail.pull.changedFiles ?? undefined),
                      icon: FileDiff,
                    },
                    {
                      id: 'review',
                      label: reviewStatus.running ? 'Reviewing…' : 'Agent review',
                      count: reviewStatus.findings || undefined,
                      icon: ShieldCheck,
                    },
                    {
                      id: 'checks',
                      label: 'Checks',
                      count: sections.checks.ready ? detail.checks.length : undefined,
                      icon: ListChecks,
                    },
                  ] as const
                )
                  .filter((item) => item.id !== 'review' || snapshot?.codeReviewsEnabled)
                  .map((item) => (
                    <TabsTab
                      key={item.id}
                      value={item.id}
                      id={`pr-tab-${item.id}`}
                      aria-label={
                        item.id === 'overview' || item.count === undefined
                          ? item.label
                          : `${item.label} (${item.count})`
                      }
                      aria-controls={`pr-panel-${item.id}`}
                      title={item.id === 'checks' ? checkFailure : undefined}
                      aria-description={
                        item.id === 'checks'
                          ? [
                              ciSummary?.label,
                              checkSummary.label,
                              pipelineRuns.runs.length ? pipelineSummary.label : '',
                            ]
                              .filter(Boolean)
                              .join('. ') || undefined
                          : undefined
                      }
                      className={`my-1 inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium ${tab === item.id ? 'studio-selected-surface forced-colors:outline forced-colors:outline-1' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                    >
                      <item.icon aria-hidden className="size-3.5" />
                      {item.label}
                      {item.count !== undefined && (
                        <span
                          aria-hidden
                          className="rounded bg-muted px-1.5 text-[0.625rem] tabular-nums text-muted-foreground"
                        >
                          {item.count}
                        </span>
                      )}
                      {item.id === 'checks' && checkFailure && (
                        <CircleAlert aria-hidden className="size-3.5 text-status-error" />
                      )}
                    </TabsTab>
                  ))}
              </TabsList>
            </div>
          </>
        )}
      </div>
      {detail && (
        <>
          <div
            ref={content}
            onScroll={(event) => {
              scrollPositions.current[tab] = event.currentTarget.scrollTop
              scrollCache.write(stateKey, { ...scrollPositions.current })
            }}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [container-type:size]"
            aria-label="Pull request content"
          >
            <PullReadinessPanel
              summary={pullReadiness(
                detail,
                sections,
                connected && pipelineRuns.fresh ? pipelineRuns.runs : [],
              )}
              onOpen={openReadiness}
            >
              <PullActions
                repositoryId={repositoryId}
                detail={detail}
                mergeStatus={{
                  headSha: detail.pull.headSha,
                  checks: {
                    busy: sections.checks.busy,
                    ready: sections.checks.ready,
                    error: sections.checks.error,
                    readConnected: sections.checks.readConnected,
                    refresh: sections.checks.refresh,
                  },
                  providerReadiness: pullMergeability(detail.pull),
                  sources: [...statusSources, { name: 'Review status', signal: reviewSummary }],
                  signals: [
                    checkSummary,
                    pipelineRuns.runs.length
                      ? pipelineSummary
                      : {
                          label: pipelineRuns.busy
                            ? 'Loading pipeline runs…'
                            : 'No pipeline runs loaded',
                          tone: 'neutral',
                        },
                    reviewSummary,
                    pullMergeability(detail.pull),
                  ],
                  warnings: [
                    ...new Set(
                      [
                        sections.status.error,
                        sections.checks.error,
                        sections.discussion.error,
                        detail.pull.statusError,
                        pipelineRuns.error,
                        pipelineRuns.notice,
                        ...detail.warnings,
                      ].filter((message): message is string => !!message),
                    ),
                  ],
                }}
                onDone={changed}
                extraMenuItems={
                  <>
                    {(thread || repository) && (
                      <DropdownMenu.Item
                        className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40"
                        disabled={!thread && !connected}
                        onSelect={() =>
                          thread ? thread.onAsk(buildPullReviewObjective(detail)) : setAsking({})
                        }
                      >
                        {thread
                          ? `Ask in linked thread ${thread.title}`
                          : 'Ask agent about this PR'}
                      </DropdownMenu.Item>
                    )}
                  </>
                }
                onStartTask={
                  repository
                    ? () => {
                        setObjective(undefined)
                        setObjectiveBaseline(undefined)
                        setStarting(true)
                      }
                    : undefined
                }
              />
            </PullReadinessPanel>
            {tab === 'overview' && <PullLinkedThreads pull={detail.pull} />}
            {error && (
              <p
                role="alert"
                className="mb-4 rounded-md border border-destructive/30 p-3 text-xs text-destructive [overflow-wrap:anywhere]"
              >
                {error}
              </p>
            )}
            {(!connected || (detail.refreshError && !error)) && (
              <p
                role="status"
                className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]"
              >
                {!connected
                  ? readConnected
                    ? 'Original computer offline · viewing latest available details.'
                    : 'Offline · reconnect to refresh.'
                  : `Unable to refresh: ${detail.refreshError}`}
              </p>
            )}
            {detail.warnings.map((warning) => (
              <p
                key={warning}
                role="alert"
                className="mb-4 rounded-md border border-status-warning/20 px-3 py-2 text-xs text-status-warning [overflow-wrap:anywhere]"
              >
                {warning}
              </p>
            ))}
            {snapshot?.codeReviewsEnabled && (
              <TabsPanel
                value="review"
                keepMounted
                render={<section />}
                id="pr-panel-review"
                aria-labelledby="pr-tab-review"
                hidden={tab !== 'review'}
              >
                <PullCodeReviewPanel
                  key={JSON.stringify([
                    activeRuntimeId,
                    repositoryId,
                    detail.destination ?? detail.pull.destination,
                    detail.pull.connectionId,
                  ])}
                  repositoryId={repositoryId}
                  detail={detail}
                  onAsk={(selection) => setAsking({ selection })}
                  onStatus={setReviewStatus}
                  configurationRequest={reviewConfigurationRequest}
                  runAction={runReview}
                  rowReviewRun={tab === 'review' ? rowReviewRun : undefined}
                  onRefresh={changed}
                  onOpenStackReview={(member, runtimeId) => {
                    if (
                      !host.openPullLink?.(member.url, {
                        runtimeId,
                        repositoryId: member.target.repositoryId,
                      })
                    )
                      selectPull(member.target.number)
                  }}
                />
              </TabsPanel>
            )}
            <TabsPanel
              value="overview"
              keepMounted
              render={<section />}
              id="pr-panel-overview"
              aria-labelledby="pr-tab-overview"
              className="space-y-5"
              hidden={tab !== 'overview'}
            >
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                <Button size="sm" variant="outline" onClick={() => selectTab('changes')}>
                  <FileDiff className="size-3.5" />
                  {uiText('Review changes')}
                </Button>
                {snapshot?.codeReviewsEnabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        selectTab('review')
                        if (!reviewStatus.running && !reviewStatus.hasReport) {
                          if (runReview.current) runReview.current()
                          else setReviewConfigurationRequest((request) => request + 1)
                        }
                      }}
                    >
                      <ShieldCheck className="size-4" />
                      {reviewStatus.running
                        ? uiText('View review run')
                        : reviewStatus.hasReport
                          ? uiText('Open agent review')
                          : reviewStatus.canRun
                            ? uiText('Run agent review')
                            : uiText('Set up agent review')}
                    </Button>
                    {reviewStatus.stale && (
                      <span className="text-xs text-muted-foreground">
                        {uiText('New changes to review')}
                      </span>
                    )}
                    {!reviewStatus.running && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          selectTab('review')
                          setReviewConfigurationRequest((request) => request + 1)
                        }}
                      >
                        {uiText('Configure this run')}
                      </Button>
                    )}
                  </div>
                )}
              </section>
              {detail.stack && stackControls}
              <div className="grid items-start gap-5 @4xl/pr-detail:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0 space-y-6">
                  <section
                    aria-label="PR description"
                    className="min-w-0 overflow-hidden rounded-lg border"
                  >
                    <h3 className="flex items-center gap-2 border-b bg-sidebar/60 px-4 py-2 text-xs font-medium">
                      {detail.pull.author}
                      <span className="font-normal text-muted-foreground">
                        {uiText('Description')}
                      </span>
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
                  <section
                    id="pr-panel-discussion"
                    tabIndex={-1}
                    aria-label="Pull request activity"
                  >
                    <PullSectionStatus label="Activity" section={sections.discussion} />
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
                          variant="ghost"
                          className={
                            discussionFilter === filter.id
                              ? 'studio-selected-surface forced-colors:outline forced-colors:outline-1'
                              : 'text-muted-foreground'
                          }
                          aria-pressed={discussionFilter === filter.id}
                          onClick={() => setDiscussionFilter(filter.id)}
                        >
                          {filter.label}{' '}
                          <span className="text-muted-foreground">{filter.count}</span>
                        </Button>
                      ))}
                    </div>
                    {sections.discussion.ready && (
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
                    )}
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
                    {!sections.discussion.ready ? (
                      <span className="text-muted-foreground">Review decisions loading…</span>
                    ) : reviews.length ? (
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
                  </dl>
                  <PullSectionStatus label="Stack" section={sections.stack} />
                  {!detail.stack && sections.stack.ready && stackControls}
                </aside>
              </div>
            </TabsPanel>
            <TabsPanel
              value="checks"
              keepMounted
              render={<section />}
              id="pr-panel-checks"
              tabIndex={-1}
              aria-labelledby="pr-tab-checks"
              hidden={tab !== 'checks'}
            >
              <PullStatus
                reviewsReady={sections.discussion.ready}
                checksReady={sections.checks.ready}
                detail={detail}
              >
                {repositorySource && (
                  <section aria-label="Repository CI" className="mb-4 rounded-xl border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{repositorySource.name}</h3>
                      <Signal
                        signal={{
                          ...repositorySource.signal,
                          label: repositorySource.signal.label.replace(/^./, (letter) =>
                            letter.toUpperCase(),
                          ),
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      CI status reported by the repository provider. Check reports and linked
                      pipelines are listed separately.
                    </p>
                  </section>
                )}
                {checksOpened && repository && (
                  <PullPipelineRunsContent
                    state={pipelineRuns}
                    sha={detail.pull.headSha}
                    active={tab === 'checks'}
                  />
                )}
                <PullSectionStatus label="Check reports" section={sections.checks} />
                <PullSectionStatus label="Reviews" section={sections.discussion} />
              </PullStatus>
            </TabsPanel>
            <TabsPanel
              value="changes"
              keepMounted
              render={<section />}
              id="pr-panel-changes"
              aria-labelledby="pr-tab-changes"
              hidden={tab !== 'changes'}
            >
              <PullSectionStatus label={uiText('Files')} section={sections.changes} />
              <PullSectionStatus label="Code discussion" section={sections.discussion} />
              {revisionPending && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p role="status" className="text-xs text-muted-foreground">
                    New revision available. Showing the previous revision read-only. Viewed marks
                    stay for unchanged files. Line drafts stay on their original revision.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!connected || !sections.changes.ready || detail.stale}
                    onClick={() => setPreviousChanges(detail)}
                  >
                    Switch revision
                  </Button>
                </div>
              )}
              {!revisionPending && !changesCurrent && changesDetail && (
                <p role="status" className="mb-3 text-xs text-muted-foreground">
                  Updating files · showing the previous revision read-only.
                </p>
              )}
              {changesOpened && changesDetail && (
                <PullChanges
                  active={tab === 'changes' && changesCurrent}
                  key={`${repositoryId}:${detail.pull.connectionId ?? ''}:${detail.pull.url}`}
                  detail={changesDetail}
                  embedded={embedded}
                  initialFragment={summaryFragment || initialFragment}
                  repositoryId={repositoryId}
                  onPosted={changed}
                  thread={thread}
                  onAskAgent={repository ? (selection) => setAsking({ selection }) : undefined}
                  onSteer={(value, baseline) => {
                    if (!repository)
                      throw new Error('Connect this project before starting an agent thread.')
                    setObjective(value)
                    setObjectiveBaseline(baseline)
                    setStarting(true)
                  }}
                />
              )}
            </TabsPanel>
          </div>
          {asking && (
            <PullAskAgent
              repositoryId={repositoryId}
              detail={detail}
              selection={asking.selection}
              onClose={() => setAsking(null)}
            />
          )}
          {creatingStack && repository && (
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
        </>
      )}
    </Tabs>
  )
}
