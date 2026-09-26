import { RepositoryActions } from '@dovo/extension-scm/repository-actions'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { TaskPullLinkDialog } from './task-pull-link-dialog'
import { taskPullLinks } from './task-pull-links'
import { TaskActions } from './task-actions'
import { useWorkspace, useStudioHost, encodeWorkTarget, issueLabel } from '@dovo/studio-core'
import {
  Bot,
  Globe,
  Files,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Monitor,
  PanelLeft,
  Terminal,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import {
  Badge,
  Button,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  cn,
} from '@dovo/studio-ui'
import { taskPresentation } from './task-presentation'
export type TaskSurface = 'chat' | 'changes' | 'terminal' | 'browser' | 'devices' | 'agents'
export function TaskHeader({
  task,
  onSidebar,
  surface,
  onSurface,
  compact,
}: {
  task: Task
  onSidebar: () => void
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  compact: boolean
}) {
  const { workspace, snapshot, connected } = useWorkspace()
  const host = useStudioHost()
  const [gitOpen, setGitOpen] = useApplicationState(false)
  const [linking, setLinking] = useApplicationState(false)
  const linkedPulls = taskPullLinks(task)
  const [now, setNow] = useApplicationState(Date.now)
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
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
      <IconButton label="Show tasks" className="size-7 shrink-0" onClick={onSidebar}>
        <PanelLeft size={14} />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-[0.6875rem]">
          <span className="max-w-40 truncate text-muted-foreground" title={repo?.path}>
            {repo?.name ?? 'Choose a project'}
          </span>
          <span aria-hidden="true" className="text-muted-foreground/50">
            /
          </span>
          <h1 className="min-w-0 truncate font-medium">{task.title}</h1>
          {task.example && (
            <Badge
              variant="secondary"
              className="hidden text-[0.5625rem] font-normal sm:inline-flex"
            >
              Example
            </Badge>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[0.625rem] text-muted-foreground">
          <span
            className={cn(
              'truncate',
              presentation.state === 'Needs input'
                ? 'text-amber-400'
                : presentation.state === 'Failed'
                  ? 'text-destructive'
                  : presentation.state === 'Done'
                    ? 'text-emerald-400'
                    : 'text-muted-foreground',
            )}
          >
            {presentation.label}
          </span>
          <span
            className="hidden items-center gap-1 truncate sm:inline-flex"
            title={`Runs on ${executionHost ?? 'the selected computer'}${!connected ? ' · offline' : ''}`}
          >
            <Monitor size={10} className="shrink-0" />
            {executionHost ?? 'Selected computer'}
            {!connected ? ' · Offline' : ''}
          </span>
          <span
            className="hidden items-center gap-1 truncate md:inline-flex"
            title={task.checkoutBranch || repo?.branch}
          >
            <GitBranch size={10} className="shrink-0" />
            {task.checkoutBranch ||
              (task.execution === 'worktree' ? 'Worktree' : repo?.branch || 'Local checkout')}
          </span>
          {task.workItem && (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-[0.6875rem]"
              title={task.workItem.title}
              onClick={() => {
                if (!task.workItem) return
                host.navigate({
                  viewId: task.workItem.kind === 'issue' ? 'issues' : 'pipelines',
                  entityId: encodeWorkTarget({
                    ...(task.workItem.kind === 'issue' && task.workItem.jiraSourceId
                      ? {
                          jiraSourceId: task.workItem.jiraSourceId,
                        }
                      : {
                          repositoryId: task.repositoryId,
                        }),
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
            className="h-5 shrink-0 gap-1 px-1 text-[0.625rem] text-muted-foreground"
            aria-label="Manage linked pull requests"
            onClick={() => setLinking(true)}
          >
            <GitPullRequest size={12} />
            {linkedPulls.length
              ? `#${linkedPulls[0]!.number}${linkedPulls.length > 1 ? ` +${linkedPulls.length - 1}` : ''}`
              : 'Link PR'}
          </Button>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {compact && (
          <div
            role="group"
            aria-label="Task workspace"
            className="flex items-center rounded-md border border-border/70 bg-muted/20 p-0.5"
          >
            {(
              [
                ['chat', 'Chat', MessageSquare, 0],
                ['changes', 'Diff', Files, task.files.length],
                ['agents', 'Agents', Bot, task.subagents?.length ?? 0],
                ['terminal', 'Terminal', Terminal, terminals],
                ['browser', 'Preview', Globe, 0],
              ] as const
            ).map(([id, label, Icon, count]) => (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                aria-label={label}
                title={label}
                aria-pressed={surface === id}
                onClick={() => onSurface(id)}
                className={cn(
                  'gap-1 rounded-sm text-[0.625rem]',
                  compact ? 'size-7 px-1.5' : 'size-7 sm:h-7 sm:w-auto sm:px-2',
                  surface === id && 'bg-background text-foreground shadow-sm',
                )}
              >
                <Icon className="size-3.5" />
                {!compact && <span className="hidden sm:inline">{label}</span>}
                {count > 0 && (
                  <span className="hidden text-[0.5625rem] tabular-nums text-muted-foreground md:inline">
                    {count}
                  </span>
                )}
              </Button>
            ))}
          </div>
        )}
        {!compact && repo && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[0.625rem]"
            onClick={() => setGitOpen(true)}
          >
            <GitBranch className="size-3.5" />
            Commit &amp; push
          </Button>
        )}
        <TaskActions key={task.id} task={task} />
      </div>
      {gitOpen && repo && (
        <Dialog open onOpenChange={setGitOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogTitle>Git &amp; project actions</DialogTitle>
            <DialogDescription>
              Stage and commit changes, push your branch, or open this thread’s working folder on
              the runtime computer.
            </DialogDescription>
            <RepositoryActions repo={repo} taskId={task.id} />
          </DialogContent>
        </Dialog>
      )}
      {linking && (
        <TaskPullLinkDialog key={task.id} task={task} onClose={() => setLinking(false)} />
      )}
    </header>
  )
}
