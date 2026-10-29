import { ThreadWatchSummary } from './thread-watch-summary'
import { NestedThreads } from './nested-threads'
import { readTaskListViewState, saveTaskListViewState } from './task-list-view-state'
import type { NestedThread } from './thread-tree'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  threadChildRows,
  threadNativeAgents,
  pullStackLabel,
  taskPullStatusFor,
  taskDisplayProject,
  taskBackgroundTerminalCount,
} from '@dovo/protocol'
import { taskPullLinks } from '../detail/task-pull-links'
import {
  pullRequestIconTone,
  PullRequestIcon,
  AgentAvatar,
  ProjectIcon,
  useModelLabel,
} from '@dovo/studio-ui'
import { acpHarnessName, resolveTaskAgent, formatDateTime, useStudioHost } from '@dovo/studio-core'
import { TaskLifecycleActions } from '../detail/task-lifecycle-actions'
import { hasUnreadTaskActivity } from '@dovo/protocol'
import { isSnoozed } from './task-priority'
import { taskPresentation } from './task-presentation'
import {
  Archive,
  Bot,
  AlarmClock,
  CloudOff,
  CircleX,
  CircleStop,
  FilePenLine,
  MessageCircleQuestion,
  MessageCircleDashed,
  Save,
  type LucideIcon,
  CircleCheck,
  CircleDashed,
  FolderGit2,
  GitBranch,
  Layers,
  Pin,
  Network,
  SquareTerminal,
} from 'lucide-react'
import { memo, useId, useMemo, useState } from 'react'
import { providers, type Task } from '@dovo/studio-core'
import { Button, cn, Tooltip, TooltipTrigger, TooltipContent } from '@dovo/studio-ui'
import type { TaskOwner } from './task-collection'
import { useTaskNow } from './task-clock'
import { threadTreeSummary } from '@dovo/protocol'
const statusIcons: Record<string, LucideIcon> = {
  Working: CircleDashed,
  Done: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: AlarmClock,
  Waiting: AlarmClock,
  Settled: CircleCheck,
  Archived: Archive,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
function TaskRowView({
  task,
  selected,
  multiSelected = false,
  onSelect,
  owner,
  needsInput,
  terminals,
  editable,
  disabled,
  hideStatusLabel = false,
  selectedChildId,
  thread,
  selectedThreadKey,
  searching,
}: {
  task: Task
  selected: boolean
  multiSelected?: boolean
  onSelect: () => void
  owner: TaskOwner
  /** A question or approval is waiting on this task itself. */
  needsInput: boolean
  /** Running terminal sessions owned by this task. */
  terminals: number
  editable: boolean
  disabled: boolean
  hideStatusLabel?: boolean
  selectedChildId?: string
  thread?: NestedThread
  selectedThreadKey?: string
  searching?: boolean
}) {
  const activeTerminals = terminals + taskBackgroundTerminalCount(task)
  const terminalIndicator = activeTerminals > 0 && (
    <SquareTerminal
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-label={`${activeTerminals} active terminal${activeTerminals === 1 ? '' : 's'}`}
    />
  )
  const studioHost = useStudioHost()
  const childrenId = useId()
  const parentKey = JSON.stringify([owner.runtimeId, task.id])
  const [expanded, setExpanded] = useState(
    () => readTaskListViewState(studioHost).threadExpansion?.[parentKey] ?? false,
  )
  const [hovered, setHovered] = useState(false)
  const open = !!searching || expanded || hovered
  const repository = owner.repositories.find((r) => r.id === task.repositoryId)
  const displayProject = taskDisplayProject(task, owner.repositories)
  const general = repository?.kind === 'scratch'
  const projectName =
    displayProject?.kind === 'scratch' ? 'No Project' : (displayProject?.name ?? 'No Project')
  // The list retains this projection across transcript-only updates, including native agents.
  const rootThread = useMemo(
    () =>
      thread ?? {
        runtimeId: owner.runtimeId,
        threadId: task.id,
        title: task.title,
        computerName: owner.name,
        projectName,
        online: owner.online,
        children: [],
        nativeAgents: threadNativeAgents(task, Infinity),
      },
    [
      owner.runtimeId,
      owner.name,
      owner.online,
      projectName,
      task.id,
      task.title,
      task.subagents,
      thread,
    ],
  )
  const childRows = useMemo(() => threadChildRows(rootThread), [rootThread])
  const summary = useMemo(
    () => threadTreeSummary(childRows, task.acknowledgedSubagentFailures),
    [childRows, task.acknowledgedSubagentFailures],
  )
  const compact = task.archived || !!task.archivedAt
  const draft = task.status === 'draft' && !compact
  const childCount = summary.total
  const childrenDetail = [
    `${childCount} subthread${childCount === 1 ? '' : 's'}`,
    summary.attention ? `${summary.attention} needs input` : '',
    summary.running ? `${summary.running} running` : '',
    summary.waiting ? `${summary.waiting} waiting` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.offline ? `${summary.offline} offline` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const now = useTaskNow(task, needsInput)
  const threadParent = useMemo(
    () => ({ runtimeId: owner.runtimeId, threadId: task.id, title: task.title }),
    [owner.runtimeId, task.id, task.title],
  )
  const agent = resolveTaskAgent(task, owner.agents)
  const customIcon = task.agentId && agent ? (agent.icon ?? 'bot') : undefined
  const projectIcon =
    displayProject?.kind === 'scratch' ? (
      <MessageCircleDashed
        className={cn('shrink-0 text-muted-foreground', compact ? 'size-4' : 'size-7')}
        aria-hidden="true"
      />
    ) : (
      <ProjectIcon
        repository={displayProject}
        className={cn('shrink-0', compact ? 'size-4' : 'size-7 rounded-[7px] text-[10px]')}
      />
    )
  const latest = task.turns?.at(-1)
  const provider =
    task.status === 'running'
      ? (latest?.provider ?? agent?.provider)
      : (agent?.provider ?? latest?.provider)
  const model = latest?.model || task.agentOverrides?.model || agent?.model
  const modelProvider = latest?.model ? (latest.provider ?? agent?.provider) : agent?.provider
  const modelName = useModelLabel(
    owner.address,
    model && modelProvider
      ? {
          provider: modelProvider,
          endpoint: agent?.endpoint ?? '',
          acpInstallationId: agent?.acpInstallationId,
          model,
        }
      : undefined,
  )
  const branch =
    task.checkoutBranch ?? (task.execution === 'worktree' ? latest?.branch : repository?.branch)
  const host = owner.name
  const linkedPulls = taskPullLinks(task).sort(
    (a, b) => Number(b.url === task.pullStatus?.url) - Number(a.url === task.pullStatus?.url),
  )
  const badgeStatus = linkedPulls[0] ? taskPullStatusFor(task, linkedPulls[0].url) : undefined
  const stack = linkedPulls[0]?.url === task.pullStatus?.url ? task.pullStatus?.stack : undefined
  const queue = task.queue?.length ?? 0
  const finished = latest?.finishedAt ? Date.parse(latest.finishedAt) : NaN
  const presentation = taskPresentation(task, needsInput, now)
  const unread = hasUnreadTaskActivity(task)
  const status = !owner.online && owner.runtimeId ? 'Offline · Cached' : presentation.label
  const offline = !owner.online && !!owner.runtimeId
  const compactStatus = offline ? 'Offline' : presentation.compactLabel
  const groupedStatus =
    hideStatusLabel && !offline && ['Working', 'Waiting'].includes(presentation.state)
  const visibleStatus = groupedStatus
    ? presentation.state === 'Working'
      ? presentation.time
      : ''
    : compactStatus
  const StatusIcon = offline
    ? CloudOff
    : ['Review', 'Finished', 'Draft'].includes(presentation.state)
      ? undefined
      : (statusIcons[presentation.state] ?? CircleDashed)
  const statusTone = cn(
    !offline && presentation.state === 'Working' && 'text-primary',
    !offline && ['Done', 'Settled'].includes(presentation.state) && 'text-status-success',
    !offline && presentation.state === 'Failed' && 'text-destructive',
    !offline && presentation.state === 'Needs input' && 'text-status-warning',
  )
  const statusDetail = [
    status,
    Number.isFinite(finished) ? `Finished ${formatDateTime(finished)}` : '',
    queue ? `${queue} queued` : '',
    task.queuePaused
      ? 'Queue paused'
      : task.queue?.some((message) => message.paused)
        ? `${task.queue.filter((message) => message.paused).length} paused`
        : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const agentName =
    (task.harness && agent ? acpHarnessName(agent, owner.acpInstallations) : undefined) ??
    agent?.name ??
    (provider ? providers[provider].short : 'Unassigned agent')
  const agentDetail = `${agentName}${provider ? ` · ${providers[provider].name}` : ''}`
  const pullIndicators = !!linkedPulls.length && (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5',
        pullRequestIconTone(badgeStatus?.state, badgeStatus?.draft),
      )}
      aria-label={`${linkedPulls.length} linked pull ${linkedPulls.length === 1 ? 'request' : 'requests'}`}
      title={linkedPulls.map((pull) => `#${pull.number} · ${pull.title}`).join(' · ')}
    >
      {stack ? (
        <Layers
          className={cn(
            'size-3',
            pullRequestIconTone(task.pullStatus?.state, task.pullStatus?.draft),
          )}
          aria-label={pullStackLabel(stack)}
        />
      ) : (
        <PullRequestIcon state={badgeStatus?.state} draft={badgeStatus?.draft} />
      )}
      {linkedPulls.length > 1 ? `${linkedPulls.length} PRs` : linkedPulls[0]!.number}
      {stack && linkedPulls.length === 1 && (
        <span className="text-[0.625rem]">
          {stack.complete ? `${stack.position}/${stack.size}` : 'Stack'}
        </span>
      )}
    </span>
  )
  const executionIcons = (
    <span className="inline-flex shrink-0 items-center gap-1" data-thread-execution>
      {(general || compact) && pullIndicators}
      {!!childCount && <span className="studio-subthread-anchor block h-3.5 w-5 shrink-0" />}
      <RuntimeIcon
        icon={owner.runtimeIcon}
        className="size-3.5 shrink-0"
        aria-label={host ?? 'Unknown host'}
      />
      {provider && (
        <AgentAvatar provider={provider} customIcon={customIcon} className="size-3.5 shrink-0" />
      )}
    </span>
  )
  const grouped = compact && !!childCount && open
  const highlighted = selected || multiSelected || !!selectedChildId
  return (
    <div
      data-highlighted={highlighted || undefined}
      onMouseLeave={() => setHovered(false)}
      className={cn('studio-thread-row group/task relative w-full min-w-0', grouped && 'mb-[3px]')}
    >
      <div className="relative">
        <Tooltip delayDuration={450}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-current={selected ? 'true' : undefined}
              data-unread={unread || undefined}
              data-draft={draft || undefined}
              className={cn(
                'studio-thread-card mb-[3px] h-auto w-full min-w-0 flex-row gap-2.5 whitespace-normal rounded-xl border border-transparent px-2.5 text-left font-normal',
                compact
                  ? 'min-h-9 items-center py-1.5'
                  : cn('items-start py-2', general ? 'min-h-[48px]' : 'min-h-[68px]'),
                grouped
                  ? 'mb-0'
                  : highlighted
                    ? 'border-transparent bg-accent/70 hover:bg-accent/80 group-hover/task:bg-accent/80'
                    : draft
                      ? 'bg-status-warning/5 hover:bg-status-warning/10 group-hover/task:bg-status-warning/10'
                      : 'hover:bg-accent/40 group-hover/task:bg-accent/40',
              )}
              onClick={onSelect}
              disabled={disabled}
            >
              <span className={cn('studio-thread-project-icon shrink-0', !compact && 'pt-0.5')}>
                {projectIcon}
              </span>
              <span
                className={cn(
                  'studio-thread-card-body flex min-w-0 flex-1',
                  compact ? 'items-center gap-1.5' : 'flex-col items-stretch gap-0.5',
                )}
              >
                {!compact && (
                  <span
                    className={cn(
                      'studio-thread-card-context flex min-w-0 items-center gap-1.5 text-xs leading-4',
                      editable &&
                        'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                    )}
                  >
                    {draft && (
                      <FilePenLine
                        aria-label="Draft"
                        className="size-3.5 shrink-0 text-status-warning"
                      />
                    )}
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={`${statusDetail} · ${agentDetail}`}
                    >
                      {projectName}
                    </span>
                    {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
                    <span
                      className={cn('flex shrink-0 items-center gap-1 text-xs', statusTone)}
                      aria-label={groupedStatus ? status : undefined}
                      title={groupedStatus ? status : undefined}
                    >
                      {StatusIcon && <StatusIcon className="size-3.5" aria-hidden="true" />}
                      {visibleStatus}
                    </span>
                  </span>
                )}
                <span
                  className={cn(
                    'studio-thread-card-title flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5',
                    compact ? 'flex-1' : 'w-full',
                    highlighted || unread
                      ? 'text-foreground'
                      : 'text-foreground/75 group-hover/task:text-foreground group-has-[:focus-visible]/task:text-foreground',
                    editable &&
                      'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate" data-thread-title>
                    {task.title}
                  </span>
                  {(general || (compact && !!childCount)) && executionIcons}
                  {(general || compact) && terminalIndicator}
                </span>
                {compact && StatusIcon && (
                  <span
                    className={cn('shrink-0', statusTone)}
                    aria-label={compactStatus}
                    title={status}
                  >
                    <StatusIcon className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                {!compact && !general && (
                  <span className="studio-thread-card-context flex min-w-0 items-center gap-1 text-xs leading-4">
                    <GitBranch className="size-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{branch || 'Local checkout'}</span>
                    {pullIndicators}
                    {executionIcons}
                    {terminalIndicator}
                  </span>
                )}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <p className="mb-3 text-sm font-medium leading-5">{task.title}</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                {general ? (
                  <MessageCircleDashed className="size-3 shrink-0" />
                ) : (
                  <FolderGit2 className="size-3 shrink-0" />
                )}
                {projectName}
              </p>
              <p className="flex items-center gap-2 break-all">
                <RuntimeIcon icon={owner.runtimeIcon} className="size-3 shrink-0" />
                {host ?? 'Unknown host'}
              </p>
              {!general && (
                <p className="flex items-center gap-2 break-all">
                  <GitBranch className="size-3 shrink-0" />
                  {branch || 'Unknown branch'}
                </p>
              )}
              <p className="flex items-center gap-2">
                {provider ? (
                  <AgentAvatar provider={provider} customIcon={customIcon} className="size-4" />
                ) : (
                  <Bot className="size-3 shrink-0" />
                )}
                {modelName || model || agentName}
              </p>
              <p>{agentDetail}</p>
              <p>{statusDetail}</p>
              {linkedPulls.map((pull) => (
                <p
                  key={pull.url}
                  className={cn(
                    'flex items-center gap-2',
                    pullRequestIconTone(
                      taskPullStatusFor(task, pull.url)?.state,
                      taskPullStatusFor(task, pull.url)?.draft,
                    ),
                  )}
                >
                  <PullRequestIcon
                    size={14}
                    state={taskPullStatusFor(task, pull.url)?.state}
                    draft={taskPullStatusFor(task, pull.url)?.draft}
                  />
                  <span>
                    #{pull.number} · {pull.title}
                  </span>
                </p>
              ))}
              {isSnoozed(task, now) && (
                <p className="flex items-center gap-2">
                  <AlarmClock className="size-3 shrink-0" aria-hidden="true" />
                  Snoozed until {formatDateTime(task.snoozedUntil ?? now)}
                </p>
              )}
              <p>
                {activeTerminals} terminal {activeTerminals === 1 ? 'session' : 'sessions'} running
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
        {!!childCount && (
          <button
            type="button"
            className={cn(
              'studio-subthread-control flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
              open && 'bg-accent text-foreground',
              summary.attention > 0 && 'text-status-warning',
              summary.failed > 0 && 'text-destructive',
            )}
            aria-label={`Subthreads for ${task.title}`}
            aria-expanded={open}
            aria-controls={open ? childrenId : undefined}
            title={childrenDetail}
            disabled={searching}
            onMouseEnter={() => setHovered(true)}
            onClick={(event) => {
              event.stopPropagation()
              // A hover preview becomes pinned on click; clicking again closes it.
              const next = !expanded
              setHovered(false)
              setExpanded(next)
              saveTaskListViewState(studioHost, {
                threadExpansion: {
                  ...readTaskListViewState(studioHost).threadExpansion,
                  [parentKey]: next,
                },
              })
            }}
          >
            <Network className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {!compact && (
        <ThreadWatchSummary
          task={task}
          online={owner.online}
          runtimeId={owner.runtimeId}
          includeSpawned={!thread}
        />
      )}
      {open && !!childCount && (
        <div id={childrenId}>
          <NestedThreads
            hideSummary
            className={grouped ? 'mb-0 border-t border-border/30 py-0.5' : undefined}
            threads={childRows}
            acknowledgedFailures={task.acknowledgedSubagentFailures}
            parent={threadParent}
            selectedKey={selectedThreadKey}
            searching={searching}
          />
        </div>
      )}
      {editable && (
        <div
          className={cn(
            'studio-thread-actions pointer-events-none absolute flex h-6 items-center gap-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/task:pointer-events-auto group-hover/task:opacity-100 group-has-[:focus-visible]/task:pointer-events-auto group-has-[:focus-visible]/task:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 motion-safe:translate-x-0.5 motion-safe:group-hover/task:translate-x-0 motion-safe:group-has-[:focus-visible]/task:translate-x-0 motion-safe:has-[[data-state=open]]:translate-x-0 motion-reduce:transition-none',
            compact ? 'top-1.5' : 'top-0.5',
            'right-2',
          )}
        >
          <TaskLifecycleActions key={owner.runtimeId ?? 'local'} task={task} owner={owner} />
        </div>
      )}
    </div>
  )
}
// Rows receive stable owner facts and keep their own clock, so streaming another task or a
// list re-render leaves untouched rows out of work.
export const TaskRow = memo(TaskRowView)
