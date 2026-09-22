import { useEffect, useState } from 'react'
import { TaskPullLinkDialog } from './task-pull-link-dialog'
import { taskPullLinks } from './task-pull-links'
import { TaskActions } from './task-actions'
import { useWorkspace, useStudioHost, encodeWorkTarget, issueLabel } from '@dovo/studio-core'
import {
  CircleCheck,
  CircleX,
  Globe,
  Files,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Monitor,
  PanelLeft,
  PanelRight,
  Terminal,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import { Badge, Button, IconButton, cn } from '@dovo/studio-ui'
import { taskPresentation } from './task-presentation'

export type TaskSurface = 'chat' | 'changes' | 'terminal' | 'browser'
export function TaskHeader({
  task,
  onSidebar,
  surface,
  onSurface,
  split,
  onSplit,
  compact,
}: {
  task: Task
  onSidebar: () => void
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  split: boolean
  onSplit: () => void
  compact: boolean
}) {
  const { workspace, snapshot, connected } = useWorkspace()
  const host = useStudioHost()
  const [linking, setLinking] = useState(false)
  const linkedPulls = taskPullLinks(task)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), task.status === 'running' ? 1000 : 60000)
    return () => clearInterval(timer)
  }, [task.status])
  const repo = workspace.repositories.find((r) => r.id === task.repositoryId)
  const executionHost = task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost
  const needsInput =
    !!snapshot?.questions.some((request) => request.taskId === task.id) ||
    !!snapshot?.approvals.some((request) => request.taskId === task.id)
  const presentation = taskPresentation(task, needsInput, now)
  const terminals =
    snapshot?.terminals.filter((session) => session.taskId === task.id && !session.exited).length ??
    0
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
      <IconButton label="Toggle task sidebar" className="size-8 shrink-0" onClick={onSidebar}>
        <PanelLeft size={16} />
      </IconButton>
      <div className="min-w-40 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-sm font-medium">{task.title}</h1>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              presentation.state === 'Needs input'
                ? 'text-amber-500'
                : presentation.state === 'Failed'
                  ? 'text-destructive'
                  : presentation.state === 'Done'
                    ? 'text-emerald-400'
                    : 'text-muted-foreground',
            )}
          >
            {presentation.state === 'Done' && (
              <CircleCheck aria-hidden="true" className="size-3 shrink-0" />
            )}
            {presentation.state === 'Failed' && (
              <CircleX aria-hidden="true" className="size-3 shrink-0" />
            )}
            {presentation.label}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="max-w-64 truncate" title={repo?.path}>
            {repo?.name ?? 'Choose a project'}
          </span>
          <span
            className="inline-flex min-w-0 max-w-56 items-center gap-1"
            title={`Runs on ${executionHost ?? 'the selected computer'}`}
          >
            <Monitor size={11} className="shrink-0" />
            <span className="sr-only">
              {executionHost ?? 'Selected computer'}
              {!connected ? ' · offline' : ''}
            </span>
          </span>
          <span
            className="inline-flex min-w-0 max-w-48 items-center gap-1"
            title={task.execution === 'worktree' ? 'Worktree checkout' : 'Local checkout'}
          >
            <GitBranch size={12} className="shrink-0" aria-hidden="true" />
            <span className="sr-only">
              {task.execution === 'worktree' ? 'Worktree checkout' : 'Local checkout'} ·{' '}
            </span>
            <span className="truncate">
              {task.checkoutBranch ||
                (task.execution === 'worktree' ? 'Worktree' : repo?.branch || 'Local checkout')}
            </span>
          </span>
          {task.workItem && (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-[11px]"
              title={task.workItem.title}
              onClick={() => {
                if (!task.workItem) return
                host.navigate({
                  viewId: task.workItem.kind === 'issue' ? 'issues' : 'pipelines',
                  entityId: encodeWorkTarget({
                    ...(task.workItem.kind === 'issue' && task.workItem.jiraSourceId
                      ? { jiraSourceId: task.workItem.jiraSourceId }
                      : { repositoryId: task.repositoryId }),
                    id: task.workItem.id,
                    url: task.workItem.url,
                  }),
                })
              }}
            >
              {task.workItem.kind === 'issue' ? 'Issue' : 'Run'} {issueLabel(task.workItem.id)}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1 text-[11px] text-muted-foreground"
            aria-label="Manage linked pull requests"
            onClick={() => setLinking(true)}
          >
            <GitPullRequest size={12} />
            {linkedPulls.length
              ? `#${linkedPulls[0]!.number}${linkedPulls.length > 1 ? ` +${linkedPulls.length - 1}` : ''}`
              : 'Link PR'}
          </Button>
          {task.example && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Example
            </Badge>
          )}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {compact && (
          <div
            role="group"
            aria-label="Task workspace"
            className="flex rounded-lg border bg-muted/35 p-0.5"
          >
            {(
              [
                ['chat', 'Chat', MessageSquare, 0],
                ['changes', 'Changes', Files, task.files.length],
                ['terminal', 'Terminal', Terminal, terminals],
                ['browser', 'Browser', Globe, 0],
              ] as const
            ).map(([id, label, Icon, count]) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                aria-label={label}
                aria-pressed={surface === id}
                onClick={() => onSurface(id)}
                className={cn(
                  'h-8 gap-1.5 rounded-md px-2.5 text-xs',
                  surface === id && 'bg-background text-foreground shadow-sm',
                )}
              >
                <Icon className="size-3.5" />
                {label}
                {count > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
                )}
              </Button>
            ))}
          </div>
        )}
        {!compact && (
          <IconButton
            label={split ? 'Hide workspace sidebar' : 'Show workspace sidebar'}
            aria-pressed={split}
            className={cn('size-8', split && 'bg-accent')}
            onClick={onSplit}
          >
            <PanelRight size={16} />
          </IconButton>
        )}
        <TaskActions key={task.id} task={task} />
      </div>
      {linking && (
        <TaskPullLinkDialog key={task.id} task={task} onClose={() => setLinking(false)} />
      )}
    </header>
  )
}
