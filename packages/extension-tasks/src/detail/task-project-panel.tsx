import { ThreadInfoSettingsSlot } from './task-project-popover'
import { ThreadInfoUsage } from './thread-info-usage'
import { ThreadSharing } from '../chat/thread-sharing'
import { useRepositoryOpen } from '@dovo/studio-core/repository-open'
import { TaskAgentLineage } from './task-agent-lineage'
import { taskPullStatusFor } from '@dovo/protocol'
import { NestedThreads } from '../list/nested-threads'
import { collectTasks, taskSources, taskCollectionKey } from '../list/task-collection'
import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Schema } from 'effect'
import {
  canChangeTaskCheckout,
  runtimeComputerName,
  mutableStruct,
  repositoryOpenTargets,
  buildThreadTree,
  threadChildRows,
  type RepositoryOpenTarget,
  type ThreadInfoSectionId,
  orderedThreadInfoSections,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useAppPreferences,
  updateAppPreferences,
  useWorkspace,
  useStudioHost,
  useRuntimeReleaseCheck,
  runtimeUpdate,
  responses,
  type Task,
} from '@dovo/studio-core'
import {
  Button,
  ProjectIcon,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  RepositoryOpenItems,
  IconButton,
} from '@dovo/studio-ui'
import {
  FolderOpen,
  FolderSymlink,
  MessageCircleDashed,
  ChevronDown,
  Download,
  GitCommitHorizontal,
  GitPullRequest,
  FileDiff,
  Terminal,
  MoreHorizontal,
  CheckCircle2,
  ArrowUp,
  Plus,
} from 'lucide-react'
import { RepositoryActions } from '@dovo/extension-scm/repository-actions'
import { gitPrimaryAction } from './git-primary-action'
import { useLiveRefresh } from './live-refresh'
import { taskPullLinks } from './task-pull-links'
import { TaskPullLinkDialog } from '../dialogs/task-pull-link-dialog'
import { TaskBranchMenu } from './task-branch-menu'
import { TaskProjectActions } from './task-project-actions'
import { ThreadServers } from './thread-servers'
import { TaskWaitingPanel } from './task-waiting-panel'
import { TaskPullStatus } from './task-pull-status'
import { fileStats, DiffAmounts } from '../files/presentation'
import type { TaskSurface } from './task-header'
export function TaskProjectPanel({
  task,
  active = true,
  onPullLink,
  onTerminal,
  onSurface,
  onBrowser,
}: {
  task: Task
  active?: boolean
  onPullLink?: (url: string) => boolean
  onTerminal?: (terminalId: string) => void
  onSurface: (surface: TaskSurface) => void
  onBrowser?: (url: string) => void
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
  const { preferredRepositoryOpenTarget, threadInfoSections, threadInfoOrder } = useAppPreferences()
  const show = (id: ThreadInfoSectionId) => threadInfoSections[id] !== false
  const openRepository = useRepositoryOpen()
  const openTarget = (target: RepositoryOpenTarget) => {
    if (openBusy || !repo) return
    setOpenBusy(true)
    setOpenError('')
    void openRepository({ repositoryId: repo.id, taskId: task.id }, target)
      .then(() => updateAppPreferences({ preferredRepositoryOpenTarget: target }))
      .catch((cause: unknown) =>
        setOpenError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setOpenBusy(false))
  }

  const linkedPulls = taskPullLinks(task)
  const displayedPulls: { number: number; url: string; title: string }[] = [...linkedPulls]
  if (task.pullStatus && !displayedPulls.some((pull) => pull.url === task.pullStatus?.url))
    displayedPulls.unshift({ ...task.pullStatus, title: task.title })
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
  const hasPrimaryAction = primary === 'Open PR' || !!gitState?.dirty || pushAvailable
  const gitSummary = gitError
    ? `Git status unavailable: ${gitError}`
    : !connected
      ? 'Connect to refresh Git status'
      : !gitReady
        ? 'Checkout starts with the first message'
        : !gitState
          ? 'Checking Git status…'
          : `${gitState.dirty ? 'Uncommitted changes' : 'Clean'} · ${!gitState.tracking ? 'No upstream' : gitState.ahead || gitState.behind ? `${gitState.ahead} ahead · ${gitState.behind} behind` : 'Synced'}`
  const linkedProjects = task.pendingLinkedCheckouts ?? task.linkedCheckouts ?? []
  const openPull = (url: string) => {
    if (!onPullLink?.(url) && !host.openPullLink?.(url)) {
      if (host.openExternalLink) void host.openExternalLink(url)
      else window.open(url, '_blank', 'noopener,noreferrer')
    }
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
  const thread = useMemo(
    () =>
      buildThreadTree(
        collectTasks(
          taskSources({
            workspace,
            snapshot,
            connected,
            connection,
            runtimes,
            activeRuntimeId,
          }),
        ),
      ).nodes.get(taskCollectionKey(activeRuntimeId, task.id)),
    [workspace, snapshot, connected, connection, runtimes, activeRuntimeId, task.id],
  )
  const childRows = useMemo(() => (thread ? threadChildRows(thread) : []), [thread])
  const stats = useMemo(
    () =>
      task.files.reduce(
        (sum, file) => {
          const stats = fileStats(file)
          return {
            additions: sum.additions + stats.additions,
            deletions: sum.deletions + stats.deletions,
          }
        },
        { additions: 0, deletions: 0 },
      ),
    [task.files],
  )
  const gitActions = (
    <div className="grid gap-2">
      {!show('project') && (
        <p className="text-xs text-muted-foreground" role="status">
          {gitSummary}
        </p>
      )}
      {repo && !repo.kind && (
        <div className="flex min-w-0 items-center gap-2" data-thread-git-actions>
          {hasPrimaryAction ? (
            <Button
              size="sm"
              className="studio-thread-primary-action h-9 min-w-0 flex-1 gap-2 text-xs"
              disabled={
                primary === 'Open PR'
                  ? commitBusy
                  : !mutable || (!gitState?.dirty && !pushAvailable)
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
              {primary === 'Open PR' ? (
                <GitPullRequest size={15} />
              ) : primary === 'Push branch' ? (
                <ArrowUp size={15} />
              ) : (
                <GitCommitHorizontal size={15} />
              )}
              {commitBusy ? 'Working…' : primary}
            </Button>
          ) : commitBusy || (gitReady && !gitError && !!gitState?.behind) ? (
            <p className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
              {commitBusy ? 'Updating Git status…' : 'Pull upstream changes before pushing'}
            </p>
          ) : null}
          <DropdownMenu.Root
            onOpenChange={(open) => {
              if (open && gitReady)
                void refreshGit().catch((cause: unknown) =>
                  setCommitStatus(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            <DropdownMenu.Trigger asChild>
              {hasPrimaryAction || commitBusy || (gitReady && !gitError && !!gitState?.behind) ? (
                <IconButton label="Git actions" className="size-8 shrink-0">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              ) : (
                <Button variant="ghost" className="studio-project-row w-full">
                  <GitCommitHorizontal className="size-4" />
                  <span className="flex-1 text-left">Git actions</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="studio-menu-surface z-50 min-w-56 rounded-md border bg-popover p-1 text-xs text-popover-foreground"
              >
                {gitState?.dirty && (
                  <>
                    {gitState.canPush && !gitState.behind && (
                      <DropdownMenu.Item
                        disabled={!mutable}
                        className="rounded px-2 py-1.5 outline-none focus:bg-[var(--studio-selected-fill)] focus:[background-image:var(--studio-selected-gradient)] data-[disabled]:opacity-50"
                        onSelect={() => void commitAndPush()}
                      >
                        Commit & push
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      disabled={!mutable}
                      className="rounded px-2 py-1.5 outline-none focus:bg-[var(--studio-selected-fill)] focus:[background-image:var(--studio-selected-gradient)] data-[disabled]:opacity-50"
                      onSelect={() => void commitAndPush(false)}
                    >
                      Commit only
                    </DropdownMenu.Item>
                  </>
                )}
                {pushAvailable && (
                  <DropdownMenu.Item
                    disabled={!mutable}
                    className="rounded px-2 py-1.5 outline-none focus:bg-[var(--studio-selected-fill)] focus:[background-image:var(--studio-selected-gradient)] data-[disabled]:opacity-50"
                    onSelect={() => void pushBranch()}
                  >
                    Push branch
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  className="rounded px-2 py-1.5 outline-none focus:bg-[var(--studio-selected-fill)] focus:[background-image:var(--studio-selected-gradient)]"
                  onSelect={() => setGitOpen(true)}
                >
                  Stage, commit & push…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {commitStatus && (
        <span role="status" className="text-xs text-muted-foreground">
          {commitStatus}
        </span>
      )}
    </div>
  )
  const sections = {
    sharing: !task.example && <ThreadSharing key={task.id} taskId={task.id} title={task.title} />,
    settings: (
      <>
        <ThreadInfoSettingsSlot visible={show('settings')} />
      </>
    ),
    project: (
      <>
        <div className="studio-project-section">
          {show('project') && (
            <div
              className="flex min-w-0 items-center gap-2.5"
              title={[
                executionHost ?? 'Selected computer',
                snapshot?.releaseVersion,
                !connected && 'Offline',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {repo?.kind === 'scratch' ? (
                <MessageCircleDashed className="size-8 shrink-0 text-muted-foreground" />
              ) : (
                <ProjectIcon repository={repo} className="size-8 shrink-0 rounded-lg" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {repo?.kind === 'scratch' ? 'No Project' : (repo?.name ?? 'Project')}
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${connected ? 'bg-status-success' : 'bg-muted-foreground'}`}
                    aria-hidden="true"
                  />
                  {executionHost ?? 'Selected computer'}
                  {!connected && ' · Offline'}
                </p>
              </div>
            </div>
          )}
          {show('project') && repo && !repo.kind && (
            <div className="studio-thread-checkout-summary mt-3 min-w-0">
              <h3 className="mb-1 text-[11px] font-medium text-muted-foreground">
                {task.execution === 'worktree' ? 'Active worktree' : 'Local checkout'}
              </h3>
              <TaskBranchMenu
                panel
                task={task}
                verifiedBranch={gitState ? gitState.branch || null : undefined}
                label={
                  gitState?.branch ||
                  task.checkoutBranch ||
                  (task.execution === 'worktree' ? 'Worktree' : repo.branch) ||
                  'Local checkout'
                }
              />
              <p
                className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                role="status"
              >
                {gitState && !gitError && connected && !gitState.dirty && (
                  <CheckCircle2 className="size-3 shrink-0 text-status-success" />
                )}
                {gitSummary}
              </p>
              <p
                className="studio-project-path mt-1.5 truncate text-[11px] text-muted-foreground"
                title={task.existingWorktreePath || repo.path}
              >
                {task.existingWorktreePath || repo.path}
              </p>
            </div>
          )}
        </div>
      </>
    ),
    openIn: (
      <>
        <div className="studio-project-section">
          {show('openIn') && repo && (
            <div className="flex min-w-0 items-center gap-2" data-thread-checkout-tools>
              <div className="studio-project-split-row min-w-0 flex-1">
                {preferredRepositoryOpenTarget && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="studio-project-row min-w-0 flex-1"
                    disabled={!connected || openBusy}
                    onClick={() => openTarget(preferredRepositoryOpenTarget)}
                  >
                    <FolderOpen size={18} />
                    Open in{' '}
                    {repositoryOpenTargets().find(
                      ([id]) => id === preferredRepositoryOpenTarget,
                    )?.[1] ?? preferredRepositoryOpenTarget}
                  </Button>
                )}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={
                        preferredRepositoryOpenTarget
                          ? 'studio-project-chevron'
                          : 'studio-project-row w-full'
                      }
                      aria-label={
                        preferredRepositoryOpenTarget ? 'Choose editor or file manager' : undefined
                      }
                      disabled={!connected || openBusy}
                      title={openError || 'Open this thread checkout on its computer'}
                    >
                      {!preferredRepositoryOpenTarget && (
                        <>
                          <FolderOpen className="size-3.5" /> Open in…
                        </>
                      )}{' '}
                      <ChevronDown className="ml-auto size-3" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="studio-menu-surface z-50 min-w-40 rounded-md border bg-popover p-1 text-xs text-popover-foreground"
                    >
                      <RepositoryOpenItems
                        itemClass="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-[var(--studio-selected-fill)] focus:[background-image:var(--studio-selected-gradient)]"
                        disabled={openBusy}
                        onSelect={openTarget}
                      />
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              {onTerminal && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5 px-2 text-xs"
                  disabled={!connected}
                  onClick={() => onSurface('terminal')}
                >
                  <Terminal className="size-3.5" /> Terminal
                </Button>
              )}
            </div>
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
        </div>
      </>
    ),
    scripts: (
      <>
        {show('scripts') && onTerminal && (
          <div className="studio-project-section">
            <TaskProjectActions panel task={task} onTerminal={onTerminal} />
          </div>
        )}
      </>
    ),
    usage: <ThreadInfoUsage task={task} />,
    servers: onBrowser && <ThreadServers taskId={task.id} onOpen={onBrowser} />,
    pulls: (
      <>
        {show('pulls') && (
          <section
            aria-label="Pull requests"
            className="studio-project-section border-t border-border/60"
          >
            {!!displayedPulls.length && (
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Pull requests</h3>
                <IconButton
                  label="Link pull request"
                  className="size-6"
                  onClick={() => setLinking(true)}
                  disabled={!connected}
                >
                  <Plus className="size-3.5" />
                </IconButton>
              </div>
            )}
            {!!displayedPulls.length && (
              <div
                aria-label="Linked pull requests"
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              >
                {displayedPulls.map((pull) =>
                  taskPullStatusFor(task, pull.url) ? (
                    <TaskPullStatus
                      key={pull.url}
                      title={pull.title}
                      task={task}
                      url={pull.url}
                      onPullLink={onPullLink}
                    />
                  ) : (
                    <Button
                      key={pull.url}
                      variant="ghost"
                      size="sm"
                      className="h-7 min-w-0 gap-1.5 px-1.5 text-xs"
                      onClick={() => openPull(pull.url)}
                      title={pull.title}
                      aria-label={`Open PR #${pull.number}: ${pull.title}`}
                    >
                      <GitPullRequest size={14} className="shrink-0 text-muted-foreground" />#
                      {pull.number}
                    </Button>
                  ),
                )}
              </div>
            )}
            {!displayedPulls.length && (
              <Button
                variant="ghost"
                className="studio-project-row"
                onClick={() => setLinking(true)}
                disabled={!connected}
              >
                <GitPullRequest size={18} /> Link pull request
              </Button>
            )}
          </section>
        )}
      </>
    ),
    projects: (
      <>
        {show('projects') && (
          <div className="studio-project-section border-t border-border/60">
            {!!linkedProjects.length && (
              <>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">Linked projects</h3>
                  <IconButton
                    label="Manage linked projects"
                    className="size-6"
                    onClick={() => onSurface('projects')}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                </div>
                {linkedProjects.map((link) => {
                  const project = workspace.repositories.find(
                    (item) => item.id === link.repositoryId,
                  )
                  return (
                    <Button
                      key={link.id}
                      variant="ghost"
                      size="sm"
                      className="studio-project-row w-full"
                      onClick={() => onSurface('projects')}
                      title={link.existingWorktreePath || project?.path}
                    >
                      <FolderSymlink size={16} />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {project?.name ?? link.repositoryId}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {link.access === 'read-only' ? 'Read only' : 'Edit'}
                      </span>
                    </Button>
                  )
                })}
                {task.pendingLinkedCheckouts && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Changes apply on the next turn.
                  </p>
                )}
              </>
            )}
            {!linkedProjects.length && (
              <Button
                variant="ghost"
                className="studio-project-row w-full justify-start"
                onClick={() => onSurface('projects')}
              >
                <FolderSymlink size={18} />
                Link projects
              </Button>
            )}
          </div>
        )}
      </>
    ),
    activity: (
      <>
        {show('activity') && (
          <TaskWaitingPanel
            active={active}
            onPullLink={onPullLink}
            panel
            key={`${activeRuntimeId}:${task.id}`}
            taskId={task.id}
          />
        )}
      </>
    ),
    git: (
      <>
        {repo && !repo.kind && (
          <div className="studio-project-section border-t border-border/60">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Version control</h3>
            {gitActions}
          </div>
        )}
      </>
    ),
    changes: (
      <>
        <div className="studio-project-section border-t border-border/60">
          {show('changes') && (
            <Button
              variant="ghost"
              className="studio-project-row studio-project-changes w-full justify-between"
              onClick={() => onSurface('changes')}
            >
              <span className="flex items-center gap-2.5">
                <FileDiff className="size-4 shrink-0" /> Changes
                {task.files.length > 0 &&
                  ` · ${task.files.length} ${task.files.length === 1 ? 'file' : 'files'}`}
              </span>
              {!!(stats.additions || stats.deletions) && (
                <span className="studio-project-diff">
                  <DiffAmounts stats={stats} />
                </span>
              )}
            </Button>
          )}
        </div>
      </>
    ),
    lineage: (
      <>
        {show('lineage') && <TaskAgentLineage task={task} />}
        {show('lineage') && thread && childRows.length > 0 && (
          <>
            <NestedThreads
              threads={childRows}
              parent={thread}
              acknowledgedFailures={task.acknowledgedSubagentFailures}
            />
            <Button size="sm" variant="ghost" onClick={() => onSurface('agents')}>
              Manage agents
            </Button>
          </>
        )}
      </>
    ),
  } satisfies Record<ThreadInfoSectionId, ReactNode>
  const compactSections = new Set<ThreadInfoSectionId>([
    'pulls',
    'git',
    'changes',
    'servers',
    'projects',
  ])
  const actionSections = new Set<ThreadInfoSectionId>(['openIn', 'scripts'])
  const groups: ThreadInfoSectionId[][] = []
  for (const { id } of orderedThreadInfoSections(threadInfoOrder)) {
    if (id !== 'settings' && !show(id)) continue
    const previous = groups.at(-1)
    if (
      previous &&
      ((compactSections.has(id) && compactSections.has(previous[0])) ||
        (actionSections.has(id) && actionSections.has(previous[0])))
    )
      previous.push(id)
    else groups.push([id])
  }
  return (
    <section aria-label="Thread info" className="studio-project-panel flex min-h-0 flex-col">
      <div className="studio-thread-info-content">
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
        {groups.map((ids) =>
          compactSections.has(ids[0]) || actionSections.has(ids[0]) ? (
            <div
              key={ids[0]}
              className={
                actionSections.has(ids[0])
                  ? 'studio-thread-info-actions'
                  : 'studio-thread-info-links'
              }
            >
              {ids.map((id) => (
                <div key={id} data-thread-info-section={id}>
                  {sections[id]}
                </div>
              ))}
            </div>
          ) : (
            <div key={ids[0]} data-thread-info-section={ids[0]}>
              {sections[ids[0]]}
            </div>
          ),
        )}
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
    </section>
  )
}
