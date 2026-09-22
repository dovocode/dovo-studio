import { taskPullLinks } from './task-pull-links'
import { AgentAvatar } from '@dovo/studio-ui'
import { resolveTaskAgent } from '@dovo/studio-core'
import { TaskLifecycleActions } from './task-lifecycle-actions'
import { isSnoozed } from './task-priority'
import { taskPresentation } from './task-presentation'
import {
  Bot,
  CircleCheck,
  CircleX,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  Monitor,
  Pin,
} from 'lucide-react'
import { providers, type Task } from '@dovo/studio-core'
import { Button, cn, Tooltip, TooltipTrigger, TooltipContent } from '@dovo/studio-ui'
import type { TaskSource } from './task-collection'

export function TaskRow({
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
  const projectName = repository?.name ?? 'No repository'
  const initials =
    projectName
      .split('/')
      .at(-1)
      ?.split(/[-_\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'P'
  const statusDetail = [
    status,
    Number.isFinite(finished) ? `Finished ${new Date(finished).toLocaleString()}` : '',
    queue ? `${queue} queued` : '',
    task.queuePaused ? 'Queue paused' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const projectColors = [
    'text-cyan-400',
    'text-violet-400',
    'text-emerald-400',
    'text-amber-400',
    'text-rose-400',
    'text-sky-400',
  ]
  const projectColor =
    projectColors[
      Array.from(task.repositoryId).reduce(
        (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
        0,
      ) % projectColors.length
    ]
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
              'mb-1 h-auto w-full min-w-0 flex-col items-stretch gap-1 whitespace-normal rounded-xl px-2.5 py-2.5 text-left font-normal',
              selected
                ? 'bg-accent/65 hover:bg-accent/75 group-hover/task:bg-accent/75'
                : 'group-hover/task:bg-accent/45',
            )}
            onClick={onSelect}
            disabled={disabled}
          >
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground transition-[padding] duration-150 ease-out motion-reduce:transition-none',
                editable &&
                  'group-hover/task:pr-24 group-has-[:focus-visible]/task:pr-24 group-has-[[data-state=open]]/task:pr-24',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded bg-current/10 text-[8px] font-semibold',
                  projectColor,
                )}
              >
                {initials}
              </span>
              <span className="min-w-0 flex-1 truncate" title={repository?.path}>
                {repository?.name ?? 'No repository'}
              </span>
              {task.pinned && <Pin aria-label="Pinned" className="size-[11px] shrink-0" />}
              <span
                className={cn(
                  'inline-flex max-w-40 shrink-0 items-center gap-1 whitespace-nowrap overflow-hidden text-[11px] tabular-nums transition-[max-width,opacity] duration-150 ease-out motion-reduce:transition-none',
                  editable &&
                    'group-hover/task:max-w-0 group-hover/task:opacity-0 group-has-[:focus-visible]/task:max-w-0 group-has-[:focus-visible]/task:opacity-0 group-has-[[data-state=open]]/task:max-w-0 group-has-[[data-state=open]]/task:opacity-0',
                  presentation.state === 'Needs input'
                    ? 'text-amber-400'
                    : presentation.state === 'Working'
                      ? 'text-sky-400'
                      : presentation.state === 'Done'
                        ? 'text-emerald-400'
                        : presentation.state === 'Failed'
                          ? 'text-destructive'
                          : '',
                )}
                title={statusDetail}
                aria-label={statusDetail}
              >
                {source.online && presentation.state === 'Working' && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-3 shrink-0 motion-safe:animate-spin"
                  />
                )}
                {source.online && presentation.state === 'Done' && (
                  <CircleCheck aria-hidden="true" className="size-3 shrink-0" />
                )}
                {source.online && presentation.state === 'Failed' && (
                  <CircleX aria-hidden="true" className="size-3 shrink-0" />
                )}
                {compactStatus}
              </span>
            </span>
            <span className="block truncate text-[13px] font-medium leading-4">{task.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {task.execution === 'worktree' && (
                <span
                  role="img"
                  aria-label="Worktree checkout"
                  title="Worktree checkout"
                  className="inline-flex shrink-0"
                >
                  <GitBranch aria-hidden="true" className="size-3" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate" title={branch}>
                {branch || (task.execution === 'worktree' ? 'Worktree pending' : 'Unknown branch')}
              </span>
              {!!linkedPulls.length && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-violet-300"
                  title={linkedPulls.map((pull) => `#${pull.number} · ${pull.title}`).join(' · ')}
                  aria-label={`Linked pull requests: ${linkedPulls.map((pull) => `#${pull.number}`).join(', ')}`}
                >
                  <GitPullRequest className="size-[11px]" />
                  {linkedPulls[0]!.number}
                  {linkedPulls.length > 1 && (
                    <span className="text-[9px]">+{linkedPulls.length - 1}</span>
                  )}
                </span>
              )}
              <span
                className="inline-flex shrink-0 items-center"
                title={`Runs on ${host} · ${source.online ? 'Online' : 'Offline'}`}
                aria-label={`Runs on ${host} · ${source.online ? 'Online' : 'Offline'}`}
              >
                <span className="relative shrink-0">
                  <Monitor className="size-[11px]" />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-1 rounded-full border border-sidebar',
                      source.online ? 'bg-emerald-400' : 'bg-muted-foreground',
                    )}
                  />
                </span>
              </span>
              <span className="inline-flex shrink-0" title={agentDetail} aria-label={agentDetail}>
                {provider ? (
                  <AgentAvatar provider={provider} customIcon={customIcon} />
                ) : (
                  <Bot className="size-3" />
                )}
                <span className="sr-only">{agentName}</span>
              </span>
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-72 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
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
              <p>Snoozed until {new Date(task.snoozedUntil ?? now).toLocaleString()}</p>
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
