import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { runtimeComputerName } from '@dovo/protocol'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  useWorkspace,
  useStudioHost,
  encodeWorkTarget,
  issueLabel,
  type Task,
} from '@dovo/studio-core'
import {
  Bot,
  Globe,
  Files,
  FileCode2,
  Shapes,
  GitPullRequest,
  MessageSquare,
  PanelRight,
  PanelBottom,
  Terminal,
  FolderSymlink,
  ChevronDown,
  Info,
} from 'lucide-react'
import { HeaderContent, Button, IconButton, ProjectIcon, cn } from '@dovo/studio-ui'
import { taskPresentation } from '../list/task-presentation'
import { retainTaskOwner } from '../list/task-collection'
import { TaskContextMenu } from './task-context-menu'
import { TaskBranchMenu } from './task-branch-menu'
import { TaskPullStatus } from './task-pull-status'
import { taskPullLinks } from './task-pull-links'
export type TaskSurface =
  | 'pull-preview'
  | 'linked-pulls'
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
  onPullLink,
  surface,
  onSurface,
  compact,
  sidebarVisible,
  hasDiff,
  toolsExpanded,
  onTools,
  bottomTerminalOpen,
  onBottomTerminal,
  projectPanelOpen,
  onProjectPanel,
  onCreate,
  onDeselect,
}: {
  projectPanelOpen: boolean
  onProjectPanel: () => void
  onCreate: () => void
  onDeselect: () => void
  task: Task
  onPullLink?: (url: string) => boolean
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  compact: boolean
  sidebarVisible: boolean
  hasDiff: boolean
  toolsExpanded: boolean
  onTools: () => void
  bottomTerminalOpen: boolean
  onBottomTerminal: () => void
}) {
  const { workspace, snapshot, connected, connection, runtimes, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const repo = workspace.repositories.find((r) => r.id === task.repositoryId)
  const [menuError, setMenuError] = useApplicationState('')
  const [now, setNow] = useApplicationState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), task.status === 'running' ? 1000 : 60000)
    return () => clearInterval(timer)
  }, [task.status])
  const linkedPulls = taskPullLinks(task)
  const executionHost = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot,
  })
  const owner = retainTaskOwner(undefined, {
    runtimeId: activeRuntimeId,
    address: connection?.address,
    name: executionHost ?? 'Selected computer',
    online: connected,
    workspace,
    snapshot,
  })
  const needsInput =
    !!snapshot?.questions.some((request) => request.taskId === task.id) ||
    !!snapshot?.approvals.some((request) => request.taskId === task.id)
  const presentation = taskPresentation(task, needsInput, now)
  const terminals =
    snapshot?.terminals.filter((session) => session.taskId === task.id && !session.exited).length ??
    0
  const titleMenu = (
    <TaskContextMenu
      key={task.id}
      dropdown
      task={task}
      owner={owner}
      selected
      busy={false}
      onOpen={() => {}}
      onCreate={onCreate}
      onFilter={onCreate}
      onDeselect={onDeselect}
      onError={setMenuError}
    >
      <button
        type="button"
        aria-label="Thread actions"
        className="inline-flex min-w-0 items-center gap-1 text-left"
      >
        <span className="truncate">{task.title}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
    </TaskContextMenu>
  )
  const actions = (
    <IconButton
      label={projectPanelOpen ? 'Hide project panel' : 'Show project panel'}
      aria-pressed={projectPanelOpen}
      className="size-7"
      onClick={onProjectPanel}
    >
      <Info size={15} />
    </IconButton>
  )
  return (
    <>
      {!compact && (
        <HeaderContent>
          <header className="studio-task-thread-header" data-sidebar={sidebarVisible}>
            <ProjectIcon repository={repo} className="size-4" />
            <h1
              className="studio-titlebar-heading min-w-0 flex-1"
              title={`${repo?.name ?? 'Project'} / ${task.title}`}
            >
              <span className="studio-titlebar-project">{repo?.name ?? 'Project'}</span>
              <span className="studio-titlebar-divider">/</span>
              <span className="studio-titlebar-task min-w-0">{titleMenu}</span>
            </h1>
            <div className="flex shrink-0 items-center gap-0.5 border-l pl-2">
              {actions}
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
        </HeaderContent>
      )}
      <header
        className={cn(
          'min-h-9 shrink-0 items-center gap-2 border-b px-2.5 py-1',
          compact ? 'flex' : 'hidden',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs">{titleMenu}</div>
          <div className="flex min-w-0 items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span
              className={cn(
                'truncate',
                presentation.state === 'Needs input'
                  ? 'text-amber-400'
                  : presentation.state === 'Failed'
                    ? 'text-destructive'
                    : ['Done', 'Finished', 'Settled'].includes(presentation.state)
                      ? 'text-emerald-400'
                      : presentation.state === 'Working'
                        ? 'text-sky-400'
                        : 'text-muted-foreground',
              )}
            >
              {presentation.label}
            </span>
            {!projectPanelOpen && (
              <>
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
                      (task.execution === 'worktree'
                        ? 'Worktree'
                        : repo?.branch || 'Local checkout')
                    }
                  />
                )}
                <span
                  className="inline-flex min-w-0 max-w-36 items-center gap-1 truncate"
                  title={`Runs on ${executionHost ?? 'the selected computer'}${!connected ? ' · offline' : ''}`}
                >
                  <RuntimeIcon icon={snapshot?.runtimeIcon} size={10} className="shrink-0" />
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
                    {task.workItem.kind === 'issue' ? 'Issue' : 'Run'}{' '}
                    {issueLabel(task.workItem.id)}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 shrink-0 gap-1 px-1 text-[0.625rem] text-muted-foreground"
                  aria-label="Manage linked pull requests"
                  onClick={onProjectPanel}
                >
                  <GitPullRequest size={12} />
                  {linkedPulls.length
                    ? `#${linkedPulls[0]!.number}${linkedPulls.length > 1 ? ` +${linkedPulls.length - 1}` : ''}`
                    : 'Link PR'}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {compact && !projectPanelOpen && (
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
                  ...(linkedPulls.length
                    ? [['linked-pulls', 'Linked PRs', GitPullRequest, linkedPulls.length] as const]
                    : []),
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
      {menuError && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {menuError}
        </p>
      )}
    </>
  )
}
