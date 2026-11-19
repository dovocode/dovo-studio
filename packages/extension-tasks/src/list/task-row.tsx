import { ThreadRowStatus } from './thread-row-status'
import { threadInputLabel, useInterfaceText } from '@dovo/studio-core/interface-language'
import { WorkspaceTypeBadge } from '../unified/workspace-type-badge'
import { MiddleTruncate } from './middle-truncate'
import type { NestedThread } from './thread-tree'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  threadChildCount,
  threadInputSummary,
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
  Bot,
  AlarmClock,
  MessageCircleDashed,
  FolderGit2,
  GitBranch,
  Layers,
  Pin,
  Network,
  SquareTerminal,
} from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { providers, type Task } from '@dovo/studio-core'
import { Button, cn, DropdownMenu, Tooltip, TooltipTrigger, TooltipContent } from '@dovo/studio-ui'
import type { TaskOwner } from './task-collection'
import { useTaskNow } from './task-clock'
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
  selectedChildId,
  thread,
  workspaceType,
  titleIcon,
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
  selectedChildId?: string
  thread?: NestedThread
  workspaceType?: boolean
  titleIcon?: ReactNode
}) {
  const uiText = useInterfaceText()
  const activeTerminals = terminals + taskBackgroundTerminalCount(task)
  const terminalIndicator = activeTerminals > 0 && (
    <SquareTerminal
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-label={`${activeTerminals} active terminal${activeTerminals === 1 ? '' : 's'}`}
    />
  )
  const subthreadCount = thread ? threadChildCount(thread) : 0
  const subthreadLabel = subthreadCount
    ? `${uiText('Subthreads for {value0}', { value0: task.title })}, ${subthreadCount}`
    : undefined
  const subthreadIndicator = subthreadCount > 0 && (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-[0.625rem] tabular-nums text-muted-foreground"
      aria-hidden="true"
      title={subthreadLabel}
    >
      <Network className="size-2.5" aria-hidden="true" />
      <span>{subthreadCount}</span>
    </span>
  )
  const studioHost = useStudioHost()
  const repository = owner.repositories.find((r) => r.id === task.repositoryId)
  const displayProject = taskDisplayProject(task, owner.repositories)
  const general = repository?.kind === 'scratch'
  const projectName =
    displayProject?.kind === 'scratch' ? 'No Project' : (displayProject?.name ?? 'No Project')
  const compact = task.archived || !!task.archivedAt
  const draft = task.status === 'draft' && !compact
  const now = useTaskNow(task, needsInput)
  const agent = resolveTaskAgent(task, owner.agents)
  const customIcon = task.agentId && agent ? (agent.icon ?? 'bot') : undefined
  const projectIcon = task.bot ? (
    <Bot className={cn(compact ? 'size-4' : 'size-5', 'shrink-0')} aria-hidden="true" />
  ) : displayProject?.kind === 'scratch' ? (
    <MessageCircleDashed
      className={cn(compact ? 'size-4' : 'size-5', 'shrink-0 text-muted-foreground')}
      aria-hidden="true"
    />
  ) : (
    <ProjectIcon
      repository={displayProject}
      className={cn(
        compact ? 'size-4 rounded-sm text-[10px]' : 'size-6 rounded-[7px] text-xs',
        'shrink-0',
      )}
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
  const failedChecks = badgeStatus?.state === 'open' && badgeStatus.checks === 'failed'
  const stack = linkedPulls[0]?.url === task.pullStatus?.url ? task.pullStatus?.stack : undefined
  const queue = task.queue?.length ?? 0
  const finished = latest?.finishedAt ? Date.parse(latest.finishedAt) : NaN
  const presentation = taskPresentation(task, needsInput, now)
  const unread = hasUnreadTaskActivity(task)
  const inputLabel =
    owner.online && !compact
      ? threadInputLabel(thread && threadInputSummary(thread), uiText) ||
        (needsInput ? uiText('Needs input') : '')
      : ''
  const status =
    !owner.online && owner.runtimeId ? 'Offline · Cached' : inputLabel || presentation.label
  const offline = !owner.online && !!owner.runtimeId
  const statusBadge = (
    <ThreadRowStatus
      state={offline ? 'Offline' : inputLabel ? 'Needs input' : presentation.state}
      label={status}
      age={presentation.age}
      tone={offline ? 'neutral' : inputLabel ? 'attention' : presentation.tone}
    />
  )
  const statusDetail = [
    status,
    unread ? uiText('Unread') : '',
    Number.isFinite(finished) ? `Finished ${formatDateTime(finished)}` : '',
    queue ? `${queue} queued` : '',
    task.spendPause ? uiText('Paused: spend limit') : '',
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
        'inline-flex shrink-0 items-center gap-0.5 font-mono tabular-nums',
        failedChecks
          ? 'text-destructive'
          : pullRequestIconTone(badgeStatus?.state, badgeStatus?.draft),
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
        <PullRequestIcon
          state={badgeStatus?.state}
          draft={badgeStatus?.draft}
          className={failedChecks ? 'text-destructive' : undefined}
        />
      )}
      {linkedPulls.length > 1 ? `${linkedPulls.length} PRs` : `#${linkedPulls[0]!.number}`}
      {stack && linkedPulls.length === 1 && (
        <span className="text-[0.625rem]">
          {stack.complete ? `${stack.position}/${stack.size}` : 'Stack'}
        </span>
      )}
    </span>
  )
  const openPull = (url: string) => {
    if (
      studioHost.openPullLink?.(url, {
        runtimeId: owner.runtimeId ?? undefined,
        repositoryId: task.repositoryId,
      })
    )
      return
    if (studioHost.openExternalLink) void studioHost.openExternalLink(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  const pullShortcutClass =
    'studio-thread-pr-control inline-flex h-6 items-center justify-center rounded px-0.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
  const pullShortcut =
    !compact &&
    pullIndicators &&
    (linkedPulls.length === 1 ? (
      <button
        type="button"
        className={pullShortcutClass}
        disabled={disabled}
        aria-label={`#${linkedPulls[0]!.number} · ${linkedPulls[0]!.title}`}
        onClick={() => openPull(linkedPulls[0]!.url)}
      >
        {pullIndicators}
      </button>
    ) : (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={pullShortcutClass}
            disabled={disabled}
            aria-label={uiText('Linked pull requests')}
          >
            {pullIndicators}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            className="z-50 max-w-xs rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {linkedPulls.map((pull) => (
              <DropdownMenu.Item
                key={pull.url}
                onSelect={() => openPull(pull.url)}
                className="cursor-default rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent"
              >
                #{pull.number} · {pull.title}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    ))
  const executionIcons = (
    <span className="inline-flex shrink-0 items-center gap-1" data-thread-execution>
      {compact && pullIndicators}
      {provider && (
        <AgentAvatar provider={provider} customIcon={customIcon} className="size-3.5 shrink-0" />
      )}
      <RuntimeIcon
        icon={owner.runtimeIcon}
        className="size-3.5 shrink-0"
        aria-label={host ?? 'Unknown host'}
      />
    </span>
  )
  const highlighted = selected || multiSelected || !!selectedChildId
  return (
    <div
      data-settled-action={(task.archived && editable && !task.bot) || undefined}
      data-highlighted={highlighted || undefined}
      className="studio-thread-row group/task relative w-full min-w-0"
    >
      <div className="relative">
        <Tooltip delayDuration={450}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-description={
                [unread && uiText('Unread'), subthreadLabel].filter(Boolean).join(' · ') ||
                undefined
              }
              aria-current={selected ? 'true' : undefined}
              data-unread={unread || undefined}
              data-read={(!highlighted && !unread) || undefined}
              data-draft={draft || undefined}
              data-compact={compact || undefined}
              className={cn(
                'studio-thread-card mb-[3px] h-auto w-full min-w-0 flex-row gap-2.5 whitespace-normal rounded-xl border border-transparent px-2.5 text-left font-normal',
                compact
                  ? 'min-h-9 items-center gap-2 py-1.5'
                  : 'studio-thread-row-two-line items-center',
                highlighted
                  ? 'border-transparent bg-accent/70 hover:bg-accent/80 group-hover/task:bg-accent/80'
                  : 'hover:bg-accent/40 group-hover/task:bg-accent/40',
              )}
              onClick={onSelect}
              disabled={disabled}
            >
              <span
                className="studio-thread-project-icon relative inline-flex shrink-0 items-center justify-center"
                title={projectName}
              >
                {projectIcon}
                {workspaceType && <WorkspaceTypeBadge kind="thread" />}
              </span>
              <span
                className={cn(
                  'studio-thread-card-body flex min-w-0 flex-1',
                  compact ? 'items-center gap-1.5' : 'flex-col items-stretch',
                  compact &&
                    !task.archived &&
                    editable &&
                    !task.bot &&
                    'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                )}
              >
                <span
                  className={cn(
                    'studio-thread-card-title flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-foreground',
                    compact ? 'flex-1' : 'w-full',
                    editable &&
                      !compact &&
                      'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                  )}
                >
                  {titleIcon}
                  <span
                    className="min-w-0 flex-1 truncate"
                    data-thread-title
                    data-thread-copy=""
                    title={task.title}
                  >
                    {task.title}
                  </span>
                  {compact && subthreadIndicator}
                  {compact && terminalIndicator}
                  {!compact && statusBadge}
                </span>
                {compact && statusBadge}
                {!compact && (
                  <span className="studio-thread-card-context flex min-w-0 items-center gap-1 text-xs">
                    <span
                      className={cn(
                        'truncate',
                        !task.bot && !general && 'studio-thread-checkout-project',
                      )}
                      data-thread-copy=""
                      title={task.bot ? task.bot.role : projectName}
                    >
                      {task.bot ? task.bot.role : projectName}
                    </span>
                    {!task.bot && !general && (
                      <>
                        <span className="studio-thread-checkout-project" aria-hidden="true">
                          ·
                        </span>
                        <MiddleTruncate
                          value={branch || 'Local checkout'}
                          className="min-w-0 flex-1 text-left"
                          aria-label={branch || 'Local checkout'}
                          data-thread-branch
                          data-thread-copy=""
                        />
                      </>
                    )}
                    {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                      {pullIndicators && (
                        <span className="studio-thread-pr-anchor inline-flex shrink-0">
                          {pullIndicators}
                        </span>
                      )}
                      {subthreadIndicator}
                      {terminalIndicator}
                      {executionIcons}
                    </span>
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
                {task.bot ? (
                  <Bot className="size-3 shrink-0" />
                ) : general ? (
                  <MessageCircleDashed className="size-3 shrink-0" />
                ) : (
                  <FolderGit2 className="size-3 shrink-0" />
                )}
                {task.bot ? task.bot.role : projectName}
              </p>
              <p className="flex items-center gap-2 break-all">
                <RuntimeIcon icon={owner.runtimeIcon} className="size-3 shrink-0" />
                {host ?? 'Unknown host'}
              </p>
              {!task.bot && !general && (
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
        {pullShortcut}
      </div>
      {editable && (
        <div
          className={cn(
            'studio-thread-actions pointer-events-none absolute flex h-6 items-center gap-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/task:pointer-events-auto group-hover/task:opacity-100 group-has-[:focus-visible]/task:pointer-events-auto group-has-[:focus-visible]/task:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 motion-safe:translate-x-0.5 motion-safe:group-hover/task:translate-x-0 motion-safe:group-has-[:focus-visible]/task:translate-x-0 motion-safe:has-[[data-state=open]]:translate-x-0 motion-reduce:transition-none',
            compact ? 'top-1.5' : 'top-0.5',
            'right-2',
          )}
        >
          <TaskLifecycleActions
            compactReopen={compact}
            key={owner.runtimeId ?? 'local'}
            task={task}
            owner={owner}
          />
        </div>
      )}
    </div>
  )
}
// Rows receive stable owner facts and keep their own clock, so streaming another task or a
// list re-render leaves untouched rows out of work.
export const TaskRow = memo(TaskRowView)
