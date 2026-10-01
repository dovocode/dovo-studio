import { RepositoryActions } from '@dovo/extension-scm/repository-actions'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { TaskPullLinkDialog } from '../dialogs/task-pull-link-dialog'
import { taskPullLinks } from './task-pull-links'
import { TaskActions } from './task-actions'
import {
  useWorkspace,
  useStudioHost,
  useRuntimeReleaseCheck,
  runtimeUpdate,
  encodeWorkTarget,
  issueLabel,
  responses,
} from '@dovo/studio-core'
import {
  Bot,
  Globe,
  Files,
  FileCode2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Monitor,
  PanelLeft,
  Terminal,
  FolderOpen,
  ChevronDown,
  Download,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  ProjectIcon,
  cn,
} from '@dovo/studio-ui'
import { taskPresentation } from '../list/task-presentation'
import { TaskBranchMenu } from './task-branch-menu'
import { TaskPullStatus } from './task-pull-status'
import { TaskProjectActions } from './task-project-actions'
export type TaskSurface =
  | 'chat'
  | 'changes'
  | 'files'
  | 'terminal'
  | 'browser'
  | 'devices'
  | 'agents'
  | 'side-chats'
export function TaskHeader({
  task,
  onSidebar,
  surface,
  onSurface,
  compact,
  sidebarVisible,
  onTerminal,
  hasDiff,
}: {
  task: Task
  onSidebar: () => void
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  compact: boolean
  sidebarVisible: boolean
  /** Shows the terminal after a project action ran in it. */
  onTerminal?: (terminalId: string) => void
  hasDiff: boolean
}) {
  const { workspace, snapshot, connected, request } = useWorkspace()
  const updates = useRuntimeReleaseCheck()
  const serverUpdate = runtimeUpdate(snapshot, updates.releases)
  const host = useStudioHost()
  const [commitBusy, setCommitBusy] = useApplicationState(false)
  const [commitStatus, setCommitStatus] = useApplicationState('')
  const committing = useRef(false)
  const commitAndPush = async () => {
    if (committing.current) return
    committing.current = true
    setCommitBusy(true)
    setCommitStatus('')
    try {
      const generated = await request(
        '/api/tasks/commit-message',
        { id: task.id },
        mutableStruct({ message: Schema.String }),
      )
      const result = await request(
        '/api/tasks/commit',
        { id: task.id, message: generated.message, push: true },
        mutableStruct({ commit: Schema.String, pushError: Schema.optional(Schema.String) }),
      )
      setCommitStatus(
        result.pushError
          ? `Committed ${result.commit.slice(0, 8)}; push failed: ${result.pushError}`
          : `Committed and pushed ${result.commit.slice(0, 8)}`,
      )
    } catch (cause) {
      setCommitStatus(cause instanceof Error ? cause.message : String(cause))
    } finally {
      committing.current = false
      setCommitBusy(false)
    }
  }
  const [gitOpen, setGitOpen] = useApplicationState(false)
  const [linking, setLinking] = useApplicationState(false)
  const [openError, setOpenError] = useApplicationState('')
  const [openBusy, setOpenBusy] = useApplicationState(false)
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
  const actions = (
    <div className="flex shrink-0 items-center gap-1.5">
      {snapshot?.releaseDistribution !== 'desktop' && serverUpdate.available && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[0.6875rem]"
          title={`Server ${serverUpdate.latest?.version} available. Open Devices & runtime for release notes.`}
          onClick={() => host.navigate({ viewId: 'runtime' })}
        >
          <Download className="size-3.5" /> Server update
        </Button>
      )}
      {onTerminal && <TaskProjectActions task={task} onTerminal={onTerminal} />}
      {!compact && repo && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[0.6875rem]"
              disabled={!connected || openBusy}
              title={openError || 'Open this task checkout on its machine'}
            >
              <FolderOpen className="size-3.5" /> Open <ChevronDown className="size-3" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-40 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
            >
              {(
                [
                  ['finder', 'Open in Finder'],
                  ['vscode', 'Open in VS Code'],
                  ['cursor', 'Open in Cursor'],
                ] as const
              ).map(([target, label]) => (
                <DropdownMenu.Item
                  key={target}
                  className="cursor-default rounded px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => {
                    setOpenBusy(true)
                    setOpenError('')
                    void request(
                      '/api/scm/open-folder',
                      { repositoryId: repo.id, taskId: task.id, target },
                      responses.ok,
                    )
                      .catch((cause: unknown) =>
                        setOpenError(cause instanceof Error ? cause.message : String(cause)),
                      )
                      .finally(() => setOpenBusy(false))
                  }}
                >
                  {label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {!compact && repo && (
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 rounded-r-none px-2 text-[0.6875rem]"
              disabled={!connected || commitBusy || task.status === 'running'}
              onClick={() => void commitAndPush()}
              title="Generate a message with the title model, commit all changes and push"
            >
              <GitBranch className="size-3.5" /> {commitBusy ? 'Committing…' : 'Commit & push'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-l-none border-l-0 px-1.5"
              aria-label="Manual Git actions"
              onClick={() => setGitOpen(true)}
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>
          {!!linkedPulls.length && (
            <div className="flex max-w-64 items-center gap-2 overflow-hidden text-[0.625rem] text-muted-foreground">
              {linkedPulls.map((pull) => (
                <a
                  key={pull.url}
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-0.5 hover:text-foreground hover:underline"
                  title={pull.title}
                >
                  <GitPullRequest size={10} />#{pull.number}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {commitStatus && (
        <span
          role="status"
          className="max-w-40 truncate text-[0.625rem] text-muted-foreground"
          title={commitStatus}
        >
          {commitStatus}
        </span>
      )}
      {openError && (
        <span
          role="alert"
          className="max-w-32 truncate text-[0.625rem] text-destructive"
          title={openError}
        >
          {openError}
        </span>
      )}
      <TaskActions key={task.id} task={task} onLinkPull={() => setLinking(true)} />
    </div>
  )
  return (
    <>
      {!compact && (
        <header className="studio-task-thread-header" data-sidebar={sidebarVisible}>
          <ProjectIcon repository={repo} className="size-4" />
          <h1
            className="studio-titlebar-heading min-w-0 flex-1"
            title={`${repo?.name ?? 'Project'} / ${task.title}`}
          >
            <span className="studio-titlebar-project">{repo?.name ?? 'Project'}</span>
            <span className="studio-titlebar-divider">/</span>
            <span className="studio-titlebar-task">{task.title}</span>
          </h1>
          {actions}
        </header>
      )}
      <header
        className={cn(
          'min-h-9 shrink-0 items-center gap-2 border-b px-2.5 py-1',
          compact ? 'flex' : 'hidden',
        )}
      >
        <IconButton label="Show tasks" className="size-7 shrink-0" onClick={onSidebar}>
          <PanelLeft size={14} />
        </IconButton>
        <div className="min-w-0 flex-1">
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
            {task.forkedFrom && (
              <button
                type="button"
                className="hidden max-w-48 truncate hover:text-foreground hover:underline md:inline"
                title={`Forked from ${task.forkedFrom.title}`}
                onClick={() =>
                  task.forkedFrom &&
                  host.navigate({ viewId: 'tasks', entityId: task.forkedFrom.taskId })
                }
              >
                Forked from {task.forkedFrom.title}
              </button>
            )}
            <TaskPullStatus task={task} />
            <TaskBranchMenu
              task={task}
              label={
                task.checkoutBranch ||
                (task.execution === 'worktree' ? 'Worktree' : repo?.branch || 'Local checkout')
              }
            />
            <span
              className="inline-flex min-w-0 max-w-36 items-center gap-1 truncate"
              title={`Runs on ${executionHost ?? 'the selected computer'}${!connected ? ' · offline' : ''}`}
            >
              <Monitor size={10} className="shrink-0" />
              <span className="truncate">{executionHost ?? 'Selected computer'}</span>
              {!connected && <span className="shrink-0">· Offline</span>}
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
                    viewId:
                      task.workItem.kind === 'issue'
                        ? task.workItem.jiraSourceId
                          ? 'jira'
                          : 'issues'
                        : 'pipelines',
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
                  ['files', 'Files', Files, 0],
                  ...(hasDiff ? [['changes', 'Diff', FileCode2, task.files.length] as const] : []),
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
          {compact && actions}
        </div>
      </header>
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
    </>
  )
}
