import { threadInputLabel, useInterfaceText } from '@dovo/studio-core/interface-language'
import { BotCall } from '../bots/bot-call'
import { useThreadChildren } from './use-thread-children'
import { sideThreadAttentionTarget } from '@dovo/protocol'
import { SideThreadAttentionBadge, useSideThreadAttention } from '../chat/thread/side-threads-panel'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useState, type ReactNode } from 'react'
import {
  runtimeComputerName,
  taskDisplayProject,
  projectDisplayName,
  taskParentReference,
  taskThreadInputSummary,
  taskPullStatusFor,
  providerDisplayName,
} from '@dovo/protocol'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  useWorkspace,
  useStudioHost,
  encodeWorkTarget,
  issueLabel,
  acpHarnessName,
  resolveTaskAgent,
  resolveScopedAgents,
  type Task,
  type StudioThreadReference,
} from '@dovo/studio-core'
import {
  Bot,
  Globe,
  Files,
  FileCode2,
  Shapes,
  GitPullRequest,
  MessageSquare,
  MessagesSquare,
  Smartphone,
  Terminal,
  FolderSymlink,
  ChevronDown,
  Info,
  GitBranch,
  Plug,
  BookOpen,
  Brain,
  Workflow,
  Phone,
} from 'lucide-react'
import {
  HeaderContent,
  Button,
  IconButton,
  ProjectIcon,
  DropdownMenu,
  AgentAvatar,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  PullRequestIcon,
  cn,
} from '@dovo/studio-ui'
import { taskPresentation } from '../list/task-presentation'
import { retainTaskOwner } from '../list/task-collection'
import { TaskContextMenu } from './task-context-menu'
import { TaskBranchMenu } from './task-branch-menu'
import { TaskPullStatus } from './task-pull-status'
import { taskPullLinks } from './task-pull-links'
import { useThreadInfoContext } from './thread-info-context'
export type TaskSurface =
  | 'bot-settings'
  | 'bot-mcp'
  | 'bot-skills'
  | 'bot-memory'
  | 'bot-routines'
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

function ThreadHeaderIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          tabIndex={0}
          className="studio-thread-header-icon inline-flex shrink-0 items-center rounded-sm p-0.5 focus-visible:outline focus-visible:outline-ring"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TaskHeader({
  task,
  parentThread,
  windowRightEdge = true,
  onPullLink,
  surface,
  onSurface,
  compact,
  sidebarVisible,
  hasDiff,
  projectPanelOpen,
  onProjectPanel,
  onCreate,
  onDeselect,
  onProjectDeleted,
  onOpenForkSource,
}: {
  projectPanelOpen: boolean
  onProjectPanel: () => void
  onCreate: () => void
  onDeselect: () => void
  onProjectDeleted?: () => void
  /** Opens the source thread at the message a fork was made from. */
  onOpenForkSource?: (taskId: string, messageId: string) => void
  task: Task
  parentThread?: StudioThreadReference
  windowRightEdge?: boolean
  onPullLink?: (url: string) => boolean
  surface: TaskSurface
  onSurface: (surface: TaskSurface) => void
  compact: boolean
  sidebarVisible: boolean
  hasDiff: boolean
}) {
  const { workspace, snapshot, connected, connection, runtimes, activeRuntimeId } = useWorkspace()
  const childThreads = useThreadChildren(task.id)
  const host = useStudioHost()
  const threadInfo = useThreadInfoContext()
  const parent =
    parentThread ??
    taskParentReference(
      task,
      activeRuntimeId,
      workspace.tasks,
      snapshot?.runtimeId,
      runtimes.map((source) => ({
        runtimeId: source.profile.id,
        runtimeIdentity: source.snapshot?.runtimeId,
        tasks: source.snapshot?.workspace.tasks ?? [],
      })),
    )
  const parentTitle = Array.from(parent?.title ?? '')
  const parentTitleMiddle = Math.ceil(parentTitle.length / 2)
  const parentCrumb = parent && (
    <>
      <button
        type="button"
        className="studio-titlebar-parent"
        aria-label={`Open parent thread ${parent.title}`}
        title={parent.title}
        disabled={!host.openThread}
        onClick={() => host.openThread?.(parent)}
      >
        <span className="studio-titlebar-parent-start">
          {parentTitle.slice(0, parentTitleMiddle).join('')}
        </span>
        <span className="studio-titlebar-parent-end">
          <span>{parentTitle.slice(parentTitleMiddle).join('')}</span>
        </span>
      </button>
      <span hidden={!!task.bot} className="studio-titlebar-divider" aria-hidden="true">
        /
      </span>
    </>
  )
  const forkSource = !task.bot && !parent ? task.forkedFrom : undefined
  const forkSourceButton = forkSource && (
    <button
      type="button"
      className="max-w-48 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
      title={`Forked from ${forkSource.title}`}
      onClick={() => {
        if (forkSource.messageId && onOpenForkSource)
          onOpenForkSource(forkSource.taskId, forkSource.messageId)
        else host.navigate({ viewId: 'tasks', entityId: forkSource.taskId })
      }}
    >
      Forked from {forkSource.title}
    </button>
  )
  const repo = workspace.repositories.find((r) => r.id === task.repositoryId)
  const displayProject = taskDisplayProject(task, workspace.repositories)
  const projectName = projectDisplayName(displayProject, 'Project')
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
  const agent = resolveTaskAgent(
    task,
    resolveScopedAgents(snapshot?.defaults, task.bot ? undefined : repo, workspace.agents),
  )
  const provider = task.harnessHandoff?.provider ?? task.turns?.at(-1)?.provider ?? agent?.provider
  const harness =
    (agent && agent.provider === provider
      ? acpHarnessName(agent, snapshot?.acpInstallations ?? [])
      : undefined) ??
    (provider && providerDisplayName(provider))
  const primaryPull = linkedPulls[0]
  const pullStatus = primaryPull && taskPullStatusFor(task, primaryPull.url)
  const failedChecks = pullStatus?.state === 'open' && pullStatus.checks === 'failed'
  const owner = retainTaskOwner(undefined, {
    runtimeId: activeRuntimeId,
    address: connection?.address,
    name: executionHost ?? 'Selected computer',
    online: connected,
    workspace,
    snapshot,
  })
  const uiText = useInterfaceText()
  const harnessContext = provider && harness && (
    <ThreadHeaderIcon label={harness}>
      <AgentAvatar provider={provider} className="size-3.5 shrink-0" />
    </ThreadHeaderIcon>
  )
  const machineContext = (
    <ThreadHeaderIcon label={executionHost ?? uiText('Selected computer')}>
      <RuntimeIcon icon={snapshot?.runtimeIcon} className="size-3.5 shrink-0" />
    </ThreadHeaderIcon>
  )
  const pullContext = primaryPull && (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-6 shrink-0 gap-1 px-1.5 text-[0.6875rem]',
        failedChecks && 'text-destructive',
      )}
      aria-label={
        linkedPulls.length > 1 ? uiText('Linked pull requests') : `PR #${primaryPull.number}`
      }
      title={failedChecks ? uiText('Checks failed') : primaryPull.title}
      onClick={() => {
        if (linkedPulls.length > 1) onSurface('linked-pulls')
        else if (
          !onPullLink?.(primaryPull.url) &&
          !host.openPullLink?.(primaryPull.url, {
            runtimeId: activeRuntimeId ?? undefined,
            repositoryId: task.repositoryId,
          })
        ) {
          if (host.openExternalLink) void host.openExternalLink(primaryPull.url)
          else window.open(primaryPull.url, '_blank', 'noopener,noreferrer')
        }
      }}
    >
      <PullRequestIcon size={13} state={pullStatus?.state} draft={pullStatus?.draft} />
      {linkedPulls.length > 1
        ? uiText('{value0} PRs', { value0: linkedPulls.length })
        : `#${primaryPull.number}`}
      {failedChecks && <span>{uiText('Checks failed')}</span>}
    </Button>
  )
  const inputLabel =
    connected && !task.archived && !task.archivedAt
      ? threadInputLabel(taskThreadInputSummary(snapshot, task.id), uiText)
      : ''
  const presentation = taskPresentation(task, !!inputLabel, now)
  const status = inputLabel || presentation.label
  const terminals =
    snapshot?.terminals.filter((session) => session.taskId === task.id && !session.exited).length ??
    0
  const attention = useSideThreadAttention()
  const sideAttention = sideThreadAttentionTarget(attention, task.id, attention.peers)?.kind
  const surfaces = [
    ['chat', 'Chat', MessageSquare, 0],
    ['files', 'Files', Files, 0],
    ...(task.bot
      ? [
          ['bot-settings', 'Settings', Bot, 0] as const,
          ['bot-mcp', 'MCP servers', Plug, 0] as const,
          ['bot-skills', 'Skills', BookOpen, 0] as const,
          ['bot-memory', 'Memory', Brain, 0] as const,
          ['bot-routines', 'Routines', Workflow, 0] as const,
        ]
      : [
          [
            'projects',
            'Linked projects',
            FolderSymlink,
            task.linkedCheckouts?.length ?? 0,
          ] as const,
        ]),
    ...(snapshot?.artifactsEnabled ? [['artifacts', 'Artifacts', Shapes, 0] as const] : []),
    ...(hasDiff ? [['changes', 'Diff', FileCode2, task.files.length] as const] : []),
    ...(linkedPulls.length
      ? [['linked-pulls', 'Linked PRs', GitPullRequest, linkedPulls.length] as const]
      : []),
    ['agents', 'Agents', Bot, task.subagents?.length ?? 0],
    ['terminal', 'Terminal', Terminal, terminals],
    ['browser', 'Preview', Globe, 0],
    ['devices', 'Devices', Smartphone, 0],
    [
      'side-chats',
      task.bot ? 'Side threads' : 'Side chats',
      MessagesSquare,
      (task.sideChats?.length ?? 0) + childThreads.length,
    ],
  ] as const
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
      onProjectDeleted={onProjectDeleted}
      onError={setMenuError}
      toolsMenu={
        compact && (
          <>
            <DropdownMenu.Label className="px-2.5 py-1.5 text-[0.625rem] font-medium text-muted-foreground">
              Tools
            </DropdownMenu.Label>
            {surfaces.map(([id, label, Icon]) => (
              <DropdownMenu.Item
                key={id}
                className="flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-accent/65"
                aria-current={surface === id ? 'page' : undefined}
                onSelect={() => onSurface(id)}
              >
                <Icon className="size-3.5 text-muted-foreground" />
                {label}
                {id === 'side-chats' && sideAttention && (
                  <SideThreadAttentionBadge kind={sideAttention} />
                )}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border/70" />
          </>
        )
      }
    >
      <button
        type="button"
        aria-label="Thread actions"
        className="inline-flex max-w-full min-w-0 items-center gap-1 text-left"
      >
        <span className="truncate">{task.title}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
    </TaskContextMenu>
  )
  const branch =
    repo?.kind === 'scratch'
      ? 'No project'
      : task.checkoutBranch ||
        (task.execution === 'worktree' ? 'Worktree' : repo?.branch || 'Local checkout')
  const [calling, setCalling] = useState(false)
  const actions = task.bot ? (
    <Button
      variant="ghost"
      size="sm"
      disabled={!connected || task.bot.state !== 'active' || !!task.replica}
      onClick={() => setCalling(true)}
    >
      <Phone size={15} /> Call
    </Button>
  ) : (
    <>
      {compact ? (
        <IconButton
          label={projectPanelOpen ? 'Hide thread info' : 'Show thread info'}
          aria-pressed={projectPanelOpen}
          aria-expanded={projectPanelOpen}
          aria-controls={threadInfo?.panelId}
          onClick={onProjectPanel}
          className={cn('size-7', projectPanelOpen && 'bg-accent text-accent-foreground')}
        >
          <Info size={15} />
        </IconButton>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={projectPanelOpen ? 'Hide thread info' : 'Show thread info'}
          aria-description={`${branch} · ${status}`}
          aria-pressed={projectPanelOpen}
          aria-expanded={projectPanelOpen}
          aria-controls={threadInfo?.panelId}
          onClick={onProjectPanel}
          title={`${branch} · ${status} · Thread info`}
          data-thread-info-trigger
          className={cn(
            'h-7 min-w-0 shrink-0 gap-2 px-2 text-xs font-normal text-muted-foreground',
            projectPanelOpen && 'bg-accent text-accent-foreground',
          )}
        >
          <GitBranch size={13} className="shrink-0" aria-hidden="true" />
          <span data-thread-info-branch className="max-w-36 truncate">
            {branch}
          </span>
          <span className="text-border" aria-hidden="true">
            ·
          </span>
          <span
            data-thread-info-state
            data-tone={presentation.tone}
            className="studio-thread-status max-w-36 truncate text-xs"
          >
            {inputLabel || presentation.state || presentation.time}
          </span>
          <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
        </Button>
      )}
    </>
  )
  return (
    <>
      {calling && task.bot && (
        <BotCall
          key={`${activeRuntimeId}:${connection?.address}:${connection?.token}:${task.id}`}
          task={task}
          onClose={() => setCalling(false)}
        />
      )}
      {!compact && (
        <HeaderContent>
          <header
            className="studio-task-thread-header"
            data-sidebar={sidebarVisible}
            data-window-edge
            data-window-right-edge={windowRightEdge || undefined}
          >
            {!task.bot && <ProjectIcon repository={displayProject} className="size-4" />}
            <nav className="studio-titlebar-heading min-w-0 flex-1" aria-label="Thread breadcrumb">
              {!task.bot && <span className="studio-titlebar-project">{projectName}</span>}
              <span hidden={!!task.bot} className="studio-titlebar-divider" aria-hidden="true">
                /
              </span>
              {parentCrumb}
              {forkSourceButton}
              <h1 className="studio-titlebar-task min-w-0" aria-current="page" title={task.title}>
                {titleMenu}
              </h1>
            </nav>
            {!task.bot && (
              <div className="studio-thread-header-context items-center gap-2 text-[0.6875rem] text-muted-foreground">
                {pullContext}
                {harnessContext}
                {machineContext}
                {hasDiff && task.files.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-1.5 text-[0.6875rem]"
                    aria-label={uiText('Review {value0} changed files', {
                      value0: task.files.length,
                    })}
                    onClick={() => onSurface('changes')}
                  >
                    <FileCode2 size={13} />
                    {task.files.length}
                  </Button>
                )}
              </div>
            )}
            {actions}
          </header>
        </HeaderContent>
      )}
      <header
        className={cn(
          '@container min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-2.5 py-1',
          compact ? 'flex' : 'hidden',
        )}
      >
        <div className="min-w-0 flex-1 basis-full @min-[30rem]:basis-0">
          <nav className="studio-titlebar-heading text-xs" aria-label="Thread breadcrumb">
            {parentCrumb}
            <span className="studio-titlebar-task min-w-0" aria-current="page">
              {titleMenu}
            </span>
          </nav>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-muted-foreground">
            {!task.bot && displayProject && displayProject.kind !== 'scratch' && (
              <span className="inline-flex min-w-0 max-w-36 items-center gap-1" title={projectName}>
                <ProjectIcon repository={displayProject} className="size-3 shrink-0" />
                <span className="truncate">{projectName}</span>
              </span>
            )}
            {status && (
              <span className="studio-thread-status truncate" data-tone={presentation.tone}>
                {status}
              </span>
            )}
            {!task.bot && !projectPanelOpen && (
              <>
                {forkSourceButton}
                <TaskPullStatus task={task} onPullLink={onPullLink} />
                {harnessContext}
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
                {machineContext}
                {!connected && <span className="shrink-0">Offline</span>}
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
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1">
          {compact && !projectPanelOpen && (
            <div
              role="group"
              aria-label="Thread workspace"
              className="flex min-w-0 items-center overflow-x-auto rounded-md border border-border/70 bg-muted/20 p-0.5"
            >
              {surfaces
                .filter(([id]) => id !== 'devices' && id !== 'side-chats')
                .map(([id, label, Icon, count]) => (
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
