import { gitPrimaryAction } from './git-primary-action'
import { RepositoryActions } from '@dovo/extension-scm/repository-actions'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useEffect, useRef } from 'react'
import { useLiveRefresh } from './live-refresh'
import { canChangeTaskCheckout, runtimeComputerName } from '@dovo/protocol'
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
  Shapes,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Monitor,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Terminal,
  FolderOpen,
  FolderSymlink,
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
  | 'pull-preview'
  | 'chat'
  | 'changes'
  | 'files'
  | 'terminal'
  | 'browser'
  | 'devices'
  | 'agents'
  | 'side-chats'
  | 'projects'
  | 'artifacts'
export function TaskHeader({
  task,
  onSidebar,
  onPullLink,
  surface,
  onSurface,
  compact,
  sidebarVisible,
  onTerminal,
  hasDiff,
  toolsExpanded,
  onTools,
  bottomTerminalOpen,
  onBottomTerminal,
}: {
  task: Task
  onPullLink?: (url: string) => boolean
  onSidebar: () => void
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  compact: boolean
  sidebarVisible: boolean
  /** Shows the terminal after a project action ran in it. */
  onTerminal?: (terminalId: string) => void
  hasDiff: boolean
  toolsExpanded: boolean
  onTools: () => void
  bottomTerminalOpen: boolean
  onBottomTerminal: () => void
}) {
  const { workspace, snapshot, connected, connection, request, runtimes, activeRuntimeId } =
    useWorkspace()
  const updates = useRuntimeReleaseCheck()
  const serverUpdate = runtimeUpdate(snapshot, updates.releases)
  const host = useStudioHost()
  const [commitBusy, setCommitBusy] = useApplicationState(false)
  const [commitStatus, setCommitStatus] = useApplicationState('')
  const committing = useRef(false)
  const commitAndPush = async (push = true) => {
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
        { id: task.id, message: generated.message, push },
        mutableStruct({ commit: Schema.String, pushError: Schema.optional(Schema.String) }),
      )
      setCommitStatus(
        result.pushError
          ? `Committed ${result.commit.slice(0, 8)}; push failed: ${result.pushError}`
          : `${push ? 'Committed and pushed' : 'Committed'} ${result.commit.slice(0, 8)}`,
      )
    } catch (cause) {
      setCommitStatus(cause instanceof Error ? cause.message : String(cause))
    } finally {
      try {
        await refreshGit()
      } catch (cause) {
        setCommitStatus(cause instanceof Error ? cause.message : String(cause))
      } finally {
        committing.current = false
        setCommitBusy(false)
      }
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
  const gitKey = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    task.id,
    task.repositoryId,
    repo?.path,
    task.execution,
    task.existingWorktreePath,
    task.checkoutBranch,
  ])
  const [gitResult, setGitResult] = useApplicationState<{
    key: string
    state: Schema.Schema.Type<typeof responses.gitActionState>
  } | null>(null)
  const gitState = gitResult?.key === gitKey ? gitResult.state : null
  const gitReady =
    !compact &&
    connected &&
    !!repo &&
    !repo.kind &&
    !(task.execution === 'worktree' && !task.existingWorktreePath && canChangeTaskCheckout(task))
  const gitTarget = useRef({ key: gitKey, request })
  gitTarget.current = { key: gitKey, request }
  const gitRead = useRef(0)
  const refreshGit = useCallback(async () => {
    const read = ++gitRead.current
    const state = await request(
      '/api/scm/action-state',
      { repositoryId: task.repositoryId, taskId: task.id },
      responses.gitActionState,
    )
    if (
      gitTarget.current.key === gitKey &&
      gitTarget.current.request === request &&
      gitRead.current === read
    )
      setGitResult({ key: gitKey, state })
  }, [request, task.repositoryId, task.id, gitKey])
  const gitError = useLiveRefresh(gitReady, refreshGit)
  const mutable = gitReady && !!gitState && !gitError && !commitBusy && task.status !== 'running'
  const pushAvailable =
    !!gitState?.canPush && (gitState.ahead > 0 || !gitState.tracking) && gitState.behind === 0
  const pushBranch = async () => {
    if (committing.current || !repo) return
    committing.current = true
    setCommitBusy(true)
    setCommitStatus('')
    try {
      await request('/api/scm/push', { repositoryId: repo.id, taskId: task.id }, responses.ok)
      setCommitStatus('Branch pushed')
    } catch (cause) {
      setCommitStatus(cause instanceof Error ? cause.message : String(cause))
    } finally {
      try {
        await refreshGit()
      } catch (cause) {
        setCommitStatus(cause instanceof Error ? cause.message : String(cause))
      } finally {
        committing.current = false
        setCommitBusy(false)
      }
    }
  }
  const primary = gitPrimaryAction(gitState, linkedPulls.length > 0)
  const openPull = (url: string) => {
    if (!onPullLink?.(url)) window.open(url, '_blank', 'noopener,noreferrer')
  }
  const primaryAction = () => {
    if (primary === 'Commit & push') void commitAndPush()
    else if (primary === 'Commit') void commitAndPush(false)
    else if (primary === 'Push branch') void pushBranch()
    else if (primary === 'Open PR') openPull(linkedPulls[0]!.url)
    else setGitOpen(true)
  }
  const executionHost = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot: { runtimeHost: task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost },
  })
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
      {!compact && repo && !repo.kind && (
        <div className="flex">
          <Button
            size="sm"
            variant="outline"
            className="h-7 min-w-28 justify-center gap-1 rounded-r-none px-2 text-[0.6875rem]"
            disabled={
              primary === 'Open PR' ? commitBusy : !mutable || (!gitState?.dirty && !pushAvailable)
            }
            onClick={primaryAction}
            title={
              gitError ||
              (commitBusy
                ? 'Updating Git status…'
                : !gitState
                  ? 'Checking Git status…'
                  : primary === 'Open PR'
                    ? primary
                    : !gitState.dirty && !pushAvailable
                      ? 'No changes to commit or push'
                      : primary)
            }
          >
            <GitBranch className="size-3.5" /> {commitBusy ? 'Working…' : primary}
          </Button>
          <DropdownMenu.Root
            onOpenChange={(open) => {
              if (open && gitReady)
                void refreshGit().catch((cause: unknown) =>
                  setCommitStatus(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            <DropdownMenu.Trigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-l-none border-l-0 px-1.5"
                aria-label="Git actions and pull requests"
              >
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-56 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
              >
                {gitState?.dirty && (
                  <>
                    {gitState.canPush && !gitState.behind && (
                      <DropdownMenu.Item
                        disabled={!mutable}
                        className="rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                        onSelect={() => void commitAndPush()}
                      >
                        Commit & push
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      disabled={!mutable}
                      className="rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                      onSelect={() => void commitAndPush(false)}
                    >
                      Commit only
                    </DropdownMenu.Item>
                  </>
                )}
                {pushAvailable && (
                  <DropdownMenu.Item
                    disabled={!mutable}
                    className="rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-50"
                    onSelect={() => void pushBranch()}
                  >
                    Push branch
                  </DropdownMenu.Item>
                )}
                {!!linkedPulls.length && (
                  <DropdownMenu.Label className="px-2 pt-2 pb-1 text-muted-foreground">
                    Linked pull requests
                  </DropdownMenu.Label>
                )}
                {linkedPulls.map((pull) => (
                  <DropdownMenu.Item
                    key={pull.url}
                    className="flex max-w-80 items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent"
                    onSelect={() => openPull(pull.url)}
                  >
                    <GitPullRequest className="size-3.5 shrink-0" />
                    <span className="truncate">
                      #{pull.number} · {pull.title}
                    </span>
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  className="rounded px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => setLinking(true)}
                >
                  Manage PR links…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="rounded px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => host.navigate({ viewId: 'pulls', entityId: repo.id })}
                >
                  Pull requests…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="rounded px-2 py-1.5 outline-none focus:bg-accent"
                  onSelect={() => setGitOpen(true)}
                >
                  Advanced Git actions…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
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
      <TaskActions
        key={task.id}
        task={task}
        onLinkPull={repo?.kind ? undefined : () => setLinking(true)}
      />
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
          <div className="flex shrink-0 items-center gap-0.5 border-l pl-2">
            <IconButton
              label={sidebarVisible ? 'Hide left sidebar' : 'Show left sidebar'}
              aria-pressed={sidebarVisible}
              className="size-7"
              onClick={onSidebar}
            >
              <PanelLeft size={15} />
            </IconButton>
            <IconButton
              label={bottomTerminalOpen ? 'Hide bottom terminal' : 'Show bottom terminal'}
              aria-pressed={bottomTerminalOpen}
              className="size-7"
              onClick={onBottomTerminal}
            >
              <PanelBottom size={15} />
            </IconButton>
            <IconButton
              label={toolsExpanded ? 'Collapse tools pane' : 'Expand tools pane'}
              aria-pressed={toolsExpanded}
              className="size-7"
              onClick={onTools}
            >
              <PanelRight size={15} />
            </IconButton>
          </div>
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
            <TaskPullStatus task={task} onPullLink={onPullLink} />
            {!repo?.kind && (
              <TaskBranchMenu
                task={task}
                label={
                  task.checkoutBranch ||
                  (task.execution === 'worktree' ? 'Worktree' : repo?.branch || 'Local checkout')
                }
              />
            )}
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
                  ['projects', 'Linked projects', FolderSymlink, task.linkedCheckouts?.length ?? 0],
                  ...(snapshot?.artifactsEnabled
                    ? [['artifacts', 'Artifacts', Shapes, 0] as const]
                    : []),
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
