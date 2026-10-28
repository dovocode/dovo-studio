import { useRepositoryOpen } from '@dovo/studio-core/repository-open'
import { TaskAgentLineage } from './task-agent-lineage'
import { taskPullStatusFor } from '@dovo/protocol'
import { NestedThreads } from '../list/nested-threads'
import { collectTasks, taskSources, taskCollectionKey } from '../list/task-collection'
import { useCallback, useMemo, useRef } from 'react'
import { Schema } from 'effect'
import {
  canChangeTaskCheckout,
  runtimeComputerName,
  mutableStruct,
  repositoryOpenTargets,
  buildThreadTree,
  threadChildRows,
  type RepositoryOpenTarget,
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
  onPullLink,
  onTerminal,
  onSurface,
  onBrowser,
}: {
  task: Task
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
  const { preferredRepositoryOpenTarget } = useAppPreferences()
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
  const actions = (
    <div className="studio-project-actions">
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
      {repo && (
        <div className="studio-project-split-row">
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
              {repositoryOpenTargets().find(([id]) => id === preferredRepositoryOpenTarget)?.[1] ??
                preferredRepositoryOpenTarget}
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
                title={openError || 'Open this task checkout on its machine'}
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
                className="z-50 min-w-40 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md"
              >
                <RepositoryOpenItems
                  itemClass="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent"
                  disabled={openBusy}
                  onSelect={openTarget}
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {onTerminal && <TaskProjectActions panel task={task} onTerminal={onTerminal} />}
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
  )
  const gitActions = (
    <div className="grid gap-2">
      {repo && !repo.kind && (
        <div className="studio-project-split-row">
          <Button
            size="sm"
            variant="ghost"
            className="studio-project-row min-w-0 flex-1"
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
            <GitCommitHorizontal size={18} /> {commitBusy ? 'Working…' : primary}
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
                variant="ghost"
                className="studio-project-chevron"
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
    </div>
  )
  return (
    <section aria-label="Thread project" className="studio-project-panel flex min-h-0 flex-col">
      <div className="studio-project-card">
        <div className="studio-project-section">
          <div
            className="mb-4 flex min-w-0 items-center gap-3"
            title={[
              executionHost ?? 'Selected computer',
              snapshot?.releaseVersion,
              !connected && 'Offline',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {repo?.kind === 'scratch' ? (
              <MessageCircleDashed className="size-9 shrink-0 text-muted-foreground" />
            ) : (
              <ProjectIcon repository={repo} className="size-9 shrink-0 rounded-lg" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium text-foreground">
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
              {repo?.kind !== 'scratch' && (
                <p
                  className="studio-project-path mt-0.5 truncate text-xs text-muted-foreground"
                  title={task.existingWorktreePath || repo?.path || 'No local checkout'}
                >
                  {task.existingWorktreePath || repo?.path || 'No local checkout'}
                </p>
              )}
            </div>
          </div>
          {repo && !repo.kind && (
            <div className="studio-project-checkout mb-3">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {task.execution === 'worktree' ? 'Active worktree' : 'Local checkout'}
              </p>
              <TaskBranchMenu
                panel
                task={task}
                label={gitState?.branch || task.checkoutBranch || repo.branch || 'Local checkout'}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground" role="status">
                {gitError
                  ? `Git status unavailable: ${gitError}`
                  : !connected
                    ? 'Connect to refresh Git status'
                    : !gitState
                      ? 'Checking Git status…'
                      : `${gitState.dirty ? 'Uncommitted changes' : 'Clean'} · ${!gitState.tracking ? 'No upstream' : gitState.ahead || gitState.behind ? `${gitState.ahead} ahead · ${gitState.behind} behind` : 'Synced'}`}
              </p>
            </div>
          )}
          {actions}
        </div>
        {onBrowser && <ThreadServers taskId={task.id} onOpen={onBrowser} />}
        <section
          aria-label="Pull requests"
          className="studio-project-section border-t border-border/60"
        >
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pull requests
          </h3>
          {!!displayedPulls.length && (
            <div
              aria-label="Linked pull requests"
              className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
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
        <div className="studio-project-section border-t border-border/60">
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Changes
          </h3>
          {gitActions}
          <Button
            variant="ghost"
            className="studio-project-row studio-project-changes w-full justify-between"
            onClick={() => onSurface('changes')}
          >
            <span className="flex items-center gap-3">
              <FileDiff size={18} /> Changes
              {task.files.length > 0 &&
                ` · ${task.files.length} ${task.files.length === 1 ? 'file' : 'files'}`}
            </span>
            <span className="studio-project-diff">
              <DiffAmounts stats={stats} />
            </span>
          </Button>
        </div>
        <div className="studio-project-section border-t border-border/60">
          <Button
            variant="ghost"
            className="studio-project-row w-full justify-start"
            onClick={() => onSurface('projects')}
          >
            <FolderSymlink size={18} />
            {(task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length
              ? `Linked projects (${(task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length})`
              : 'Link projects'}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Use project checkouts or worktrees on this computer.
          </p>
        </div>
        <TaskWaitingPanel
          onPullLink={onPullLink}
          panel
          key={`${activeRuntimeId}:${task.id}`}
          taskId={task.id}
        />
      </div>
      <TaskAgentLineage task={task} />
      {thread && childRows.length > 0 && (
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
