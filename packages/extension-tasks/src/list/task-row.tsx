import { ThreadWatchSummary } from './thread-watch-summary'
import { NestedThreads } from './nested-threads'
import { readTaskListViewState, saveTaskListViewState } from './task-list-view-state'
import type { NestedThread } from './thread-tree'
import { WorkingSubagents } from './working-subagents'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { pullStackLabel, taskPullStatusFor, taskDisplayProject } from '@dovo/protocol'
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
  GitFork,
  MessageCircleQuestion,
  MessageCircle,
  Save,
  type LucideIcon,
  CircleCheck,
  CircleDashed,
  FolderGit2,
  GitBranch,
  Layers,
  Pin,
  Network,
} from 'lucide-react'
import { memo, useId, useMemo, useState } from 'react'
import { providers, type Task } from '@dovo/studio-core'
import { Button, cn, Tooltip, TooltipTrigger, TooltipContent } from '@dovo/studio-ui'
import type { TaskOwner } from './task-collection'
import { useTaskNow } from './task-clock'
import { threadTreeSummary, type SubagentListItem } from '@dovo/protocol'
const statusIcons: Record<string, LucideIcon> = {
  Working: CircleDashed,
  Done: CircleCheck,
  Finished: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: AlarmClock,
  Waiting: AlarmClock,
  Settled: CircleCheck,
  Archived: Archive,
  Draft: FilePenLine,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
function TaskRowView({
  task,
  subagents,
  selected,
  multiSelected = false,
  onSelect,
  owner,
  needsInput,
  terminals,
  editable,
  disabled,
  selectedChildId,
  onOpenSubagent,
  nestedThreads,
  selectedThreadKey,
  searching,
}: {
  task: Task
  subagents: readonly SubagentListItem[]
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
  onOpenSubagent: (id: string) => void
  nestedThreads?: readonly NestedThread[]
  selectedThreadKey?: string
  searching?: boolean
}) {
  const studioHost = useStudioHost()
  const childrenId = useId()
  const parentKey = JSON.stringify([owner.runtimeId, task.id])
  const [expanded, setExpanded] = useState(
    () => readTaskListViewState(studioHost).threadExpansion?.[parentKey] ?? false,
  )
  const open = !!searching || expanded
  const summary = useMemo(
    () => threadTreeSummary(nestedThreads ?? [], task.acknowledgedSubagentFailures),
    [nestedThreads, task.acknowledgedSubagentFailures],
  )
  const compact = task.archived || !!task.archivedAt
  const childCount = summary.total + (compact ? 0 : subagents.length)
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
  const repository = owner.repositories.find((r) => r.id === task.repositoryId)
  const displayProject = taskDisplayProject(task, owner.repositories)
  const general = repository?.kind === 'scratch'
  const projectName =
    displayProject?.kind === 'scratch' ? 'General' : (displayProject?.name ?? 'No project')
  const projectIcon =
    displayProject?.kind === 'scratch' ? (
      <MessageCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : (
      <ProjectIcon repository={displayProject} className="size-4 shrink-0" />
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
  const StatusIcon = offline
    ? CloudOff
    : presentation.state === 'Review'
      ? undefined
      : (statusIcons[presentation.state] ?? CircleDashed)
  const statusDetail = [
    status,
    Number.isFinite(finished) ? `Finished ${formatDateTime(finished)}` : '',
    queue ? `${queue} queued` : '',
    task.queuePaused ? 'Queue paused' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const agentName =
    (task.harness && agent ? acpHarnessName(agent, owner.acpInstallations) : undefined) ??
    agent?.name ??
    (provider ? providers[provider].short : 'Unassigned agent')
  const agentDetail = `${agentName}${provider ? ` · ${providers[provider].name}` : ''}`
  const grouped = compact && !!childCount && open
  const highlighted = selected || multiSelected || !!selectedChildId
  return (
    <div
      className={cn(
        'group/task relative w-full min-w-0',
        grouped && 'mb-0.5 rounded-xl border transition-colors',
        grouped &&
          (highlighted
            ? 'border-border/50 bg-accent/70 hover:bg-accent/80'
            : 'border-border/30 bg-accent/15 hover:bg-accent/30'),
      )}
    >
      <div className="relative">
        <Tooltip delayDuration={450}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              aria-current={selected ? 'true' : undefined}
              data-unread={unread || undefined}
              className={cn(
                'mb-0.5 h-auto w-full min-w-0 whitespace-normal rounded-xl border border-transparent px-2.5 text-left font-normal',
                compact
                  ? 'min-h-9 flex-row items-center gap-2 py-1.5'
                  : 'min-h-[68px] flex-col items-stretch gap-0.5 py-1.5',
                grouped
                  ? 'mb-0 rounded-b-none border-0 bg-transparent hover:bg-accent/30'
                  : highlighted
                    ? 'border-border/50 bg-accent/70 hover:bg-accent/80 group-hover/task:bg-accent/80'
                    : 'hover:bg-accent/40 group-hover/task:bg-accent/40',
              )}
              onClick={onSelect}
              disabled={disabled}
            >
              {compact ? (
                <span className={cn('shrink-0', !unread && 'opacity-50')}>{projectIcon}</span>
              ) : (
                <span
                  className={cn(
                    'studio-thread-card-context flex min-w-0 items-center gap-1.5 text-xs leading-4',
                    editable &&
                      'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                  )}
                >
                  {projectIcon}
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`${statusDetail} · ${agentDetail}`}
                  >
                    {projectName}
                  </span>
                  {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
                  {!general && task.execution === 'worktree' && (
                    <GitFork className="size-3 shrink-0" aria-label="Worktree checkout" />
                  )}
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1 text-xs',
                      !offline && presentation.state === 'Working' && 'text-sky-400',
                      !offline &&
                        ['Done', 'Finished', 'Settled'].includes(presentation.state) &&
                        'text-emerald-400',
                      !offline && presentation.state === 'Failed' && 'text-destructive',
                    )}
                  >
                    {StatusIcon && <StatusIcon className="size-3.5" aria-hidden="true" />}
                    {compactStatus}
                  </span>
                </span>
              )}
              <span
                className={cn(
                  'block min-w-0 truncate text-sm font-medium leading-5',
                  compact ? 'flex-1' : 'w-full',
                  compact && !!childCount && 'pr-7',
                  unread ? 'text-foreground' : 'text-foreground/65',
                  editable &&
                    'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
                )}
              >
                {task.title}
              </span>
              {!compact && (
                <span
                  className={cn(
                    'studio-thread-card-context flex min-w-0 items-center gap-1 text-xs leading-4',
                    !!childCount && 'pr-7',
                  )}
                >
                  {!general && (
                    <>
                      <GitBranch className="size-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{branch || 'Local checkout'}</span>
                    </>
                  )}
                  {general && <span className="min-w-0 flex-1" />}
                  {!!linkedPulls.length && (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-0.5',
                        pullRequestIconTone(badgeStatus?.state, badgeStatus?.draft),
                      )}
                      aria-label={`${linkedPulls.length} linked pull ${linkedPulls.length === 1 ? 'request' : 'requests'}`}
                      title={linkedPulls
                        .map((pull) => `#${pull.number} · ${pull.title}`)
                        .join(' · ')}
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
                      {linkedPulls.length > 1
                        ? `${linkedPulls.length} PRs`
                        : linkedPulls[0]!.number}
                      {stack && linkedPulls.length === 1 && (
                        <span className="text-[0.625rem]">
                          {stack.complete ? `${stack.position}/${stack.size}` : 'Stack'}
                        </span>
                      )}
                    </span>
                  )}
                  <RuntimeIcon
                    icon={owner.runtimeIcon}
                    className="size-3 shrink-0"
                    aria-label={host ?? 'Unknown host'}
                  />
                  {provider && (
                    <AgentAvatar provider={provider} customIcon={customIcon} className="size-3.5" />
                  )}
                </span>
              )}
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
                  <MessageCircle className="size-3 shrink-0" />
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
                {terminals} terminal {terminals === 1 ? 'session' : 'sessions'} running
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
        {!!childCount && (
          <button
            type="button"
            className={cn(
              'absolute bottom-1.5 right-2.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
              open && 'bg-accent text-foreground',
              summary.attention > 0 && 'text-amber-500',
              summary.failed > 0 && 'text-destructive',
            )}
            aria-label={`Subthreads for ${task.title}`}
            aria-expanded={open}
            aria-controls={open ? childrenId : undefined}
            title={childrenDetail}
            disabled={searching}
            onClick={(event) => {
              event.stopPropagation()
              const next = !open
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
          includeSpawned={!nestedThreads}
        />
      )}
      {open && !!childCount && (
        <div id={childrenId}>
          {nestedThreads && (
            <NestedThreads
              hideSummary
              className={grouped ? 'mb-0 border-t border-border/30 py-0.5' : undefined}
              threads={nestedThreads}
              acknowledgedFailures={task.acknowledgedSubagentFailures}
              parent={threadParent}
              selectedKey={selectedThreadKey}
              searching={searching}
            />
          )}
          {!compact && (
            <WorkingSubagents
              subagents={subagents}
              online={owner.online}
              disabled={disabled}
              selectedChildId={selectedChildId}
              onOpenSubagent={onOpenSubagent}
            />
          )}
          {!compact &&
            selectedChildId &&
            !nestedThreads &&
            !subagents.some((agent) => (agent.taskId ?? agent.id) === selectedChildId) && (
              <p className="mb-2 px-2.5 text-[0.625rem] text-muted-foreground">Viewing subagent</p>
            )}
        </div>
      )}
      {editable && (
        <div className="pointer-events-none absolute right-2 top-1.5 flex h-6 items-center gap-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/task:pointer-events-auto group-hover/task:opacity-100 group-has-[:focus-visible]/task:pointer-events-auto group-has-[:focus-visible]/task:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 motion-safe:translate-x-0.5 motion-safe:group-hover/task:translate-x-0 motion-safe:group-has-[:focus-visible]/task:translate-x-0 motion-safe:has-[[data-state=open]]:translate-x-0 motion-reduce:transition-none">
          <TaskLifecycleActions key={owner.runtimeId ?? 'local'} task={task} owner={owner} />
        </div>
      )}
    </div>
  )
}
// Rows receive stable owner facts and keep their own clock, so streaming another task or a
// list re-render leaves untouched rows out of work.
export const TaskRow = memo(TaskRowView)
