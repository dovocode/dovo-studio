import { taskPullLinks } from './task-pull-links'
import { AgentAvatar } from '@dovo/studio-ui'
import { resolveTaskAgent, formatDateTime } from '@dovo/studio-core'
import { TaskLifecycleActions } from './task-lifecycle-actions'
import { isSnoozed } from './task-priority'
import { taskPresentation } from './task-presentation'
import { Bot, FolderGit2, GitBranch, GitPullRequest, Monitor, Pin } from 'lucide-react'
import { memo } from 'react'
import { providers, type Task } from '@dovo/studio-core'
import { Button, cn, Tooltip, TooltipTrigger, TooltipContent } from '@dovo/studio-ui'
import type { TaskSource } from './task-collection'
function TaskRowView({
  task,
  selected,
  onSelect,
  now,
  source,
  editable,
  disabled,
}: {
  task: Task
  selected: boolean
  onSelect: () => void
  now: number
  source: TaskSource
  editable: boolean
  disabled: boolean
}) {
  const { workspace, snapshot } = source
  const agent = resolveTaskAgent(task, workspace.agents)
  const customIcon = !task.harness && task.agentId && agent ? (agent.icon ?? 'bot') : undefined
  const repository = workspace.repositories.find((r) => r.id === task.repositoryId)
  const latest = task.turns?.at(-1)
  const provider =
    task.status === 'running'
      ? (latest?.provider ?? agent?.provider)
      : (agent?.provider ?? latest?.provider)
  const branch =
    task.checkoutBranch ?? (task.execution === 'worktree' ? latest?.branch : repository?.branch)
  const host = latest?.runtimeHost ?? source.name
  const linkedPulls = taskPullLinks(task)
  const needsInput =
    snapshot?.questions.some((q) => q.taskId === task.id) ||
    snapshot?.approvals.some((a) => a.taskId === task.id)
  const queue = task.queue?.length ?? 0
  const finished = latest?.finishedAt ? Date.parse(latest.finishedAt) : NaN
  const presentation = taskPresentation(task, !!needsInput, now)
  const status = !source.online && source.runtimeId ? 'Offline · Cached' : presentation.label
  const compactStatus = !source.online && source.runtimeId ? 'Offline' : presentation.compactLabel
  const statusDetail = [
    status,
    Number.isFinite(finished) ? `Finished ${formatDateTime(finished)}` : '',
    queue ? `${queue} queued` : '',
    task.queuePaused ? 'Queue paused' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const agentName = agent?.name ?? (provider ? providers[provider].short : 'Unassigned agent')
  const agentDetail = `${agentName}${provider ? ` · ${providers[provider].name}` : ''}`
  const terminals = snapshot?.terminals.filter((t) => t.taskId === task.id && !t.exited).length ?? 0
  return (
    <div className="group/task relative">
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'mb-px h-auto min-h-11 w-full min-w-0 flex-col items-stretch gap-0.5 whitespace-normal rounded-md border border-transparent px-2 py-1.5 text-left font-normal',
              selected
                ? 'border-primary/20 bg-primary/8 shadow-[inset_2px_0_var(--primary)] hover:bg-primary/12 group-hover/task:bg-primary/12'
                : 'hover:bg-accent/40 group-hover/task:bg-accent/40',
            )}
            onClick={onSelect}
            disabled={disabled}
          >
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[0.625rem] leading-4 text-muted-foreground',
                editable &&
                  'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  !source.online && source.runtimeId
                    ? 'bg-muted-foreground'
                    : presentation.state === 'Needs input'
                      ? 'bg-amber-400'
                      : presentation.state === 'Working'
                        ? 'bg-sky-400'
                        : presentation.state === 'Done'
                          ? 'bg-emerald-400'
                          : presentation.state === 'Failed'
                            ? 'bg-destructive'
                            : 'bg-muted-foreground/60',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate" title={`${statusDetail} · ${agentDetail}`}>
                {repository?.name ?? 'No project'}
              </span>
              <span className="shrink-0 text-[0.625rem]">{compactStatus}</span>
              {task.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
              {!!linkedPulls.length && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground"
                  title={linkedPulls.map((pull) => `#${pull.number} · ${pull.title}`).join(' · ')}
                >
                  <GitPullRequest className="size-3" />
                  {linkedPulls[0]!.number}
                </span>
              )}
              {task.execution === 'worktree' && (
                <GitBranch className="size-3 shrink-0" aria-label="Worktree checkout" />
              )}
            </span>
            <span
              className={cn(
                'block w-full truncate text-[0.75rem] font-medium leading-[17px]',
                editable &&
                  'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
              )}
            >
              {task.title}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[0.625rem] leading-4 text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{branch || 'Local checkout'}</span>
              <Monitor className="size-3 shrink-0" aria-label={host ?? 'Unknown host'} />
              {provider && (
                <AgentAvatar provider={provider} customIcon={customIcon} className="size-3.5" />
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
              <FolderGit2 className="size-3 shrink-0" />
              {repository?.name ?? 'No project'}
            </p>
            <p className="flex items-center gap-2 break-all">
              <Monitor className="size-3 shrink-0" />
              {host ?? 'Unknown host'}
            </p>
            <p className="flex items-center gap-2 break-all">
              <GitBranch className="size-3 shrink-0" />
              {branch || 'Unknown branch'}
            </p>
            <p className="flex items-center gap-2">
              {provider ? (
                <AgentAvatar provider={provider} customIcon={customIcon} className="size-4" />
              ) : (
                <Bot className="size-3 shrink-0" />
              )}
              {latest?.model || task.agentOverrides?.model || agent?.model || agentName}
            </p>
            <p>{agentDetail}</p>
            <p>{statusDetail}</p>
            {linkedPulls.map((pull) => (
              <p key={pull.url} className="flex items-center gap-2">
                <GitPullRequest size={14} className="shrink-0 text-violet-400" />
                <span>
                  #{pull.number} · {pull.title}
                </span>
              </p>
            ))}
            {isSnoozed(task, now) && (
              <p>Snoozed until {formatDateTime(task.snoozedUntil ?? now)}</p>
            )}
            <p>
              {terminals} terminal {terminals === 1 ? 'session' : 'sessions'} running
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
      {editable && (
        <div className="pointer-events-none absolute right-2 top-1.5 flex h-6 items-center gap-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/task:pointer-events-auto group-hover/task:opacity-100 group-has-[:focus-visible]/task:pointer-events-auto group-has-[:focus-visible]/task:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 motion-safe:translate-x-0.5 motion-safe:group-hover/task:translate-x-0 motion-safe:group-has-[:focus-visible]/task:translate-x-0 motion-safe:has-[[data-state=open]]:translate-x-0 motion-reduce:transition-none">
          <TaskLifecycleActions key={source.runtimeId ?? 'local'} task={task} />
        </div>
      )}
    </div>
  )
}
// Rows are rendered for every task in the sidebar and re-render on every list tick. Memoizing
// keeps untouched rows out of work when the list itself re-renders.
export const TaskRow = memo(TaskRowView)
