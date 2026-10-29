import type { ReactNode } from 'react'
import type { TaskSource } from '../../list/task-collection'
import type { Repository } from '@dovo/studio-core'
import { ComposerProject } from './composer-project'
import { useApplicationState } from '@dovo/studio-core/state'
import { Schema } from 'effect'
import { Check, ChevronDown, Folder, GitBranch, GitFork, Link2, ListFilter } from 'lucide-react'
import {
  branchesSchema,
  defaultWorktreeBase,
  canChangeTaskCheckout,
  worktreeChoicesSchema,
  type WorktreeChoices,
  updateTask,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import {
  Button,
  ComposerWorkspaceBar,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  Popover,
  LinkedCheckoutEditor,
} from '@dovo/studio-ui'
export type WorkspaceControls = (access: ReactNode) => ReactNode

export function ComposerWorkspace({
  task,
  disabled,
  onMachineMoving,
  onSelectRemote,
  children,
}: {
  children?: ReactNode
  task: Task
  disabled: boolean
  onMachineMoving: (moving: boolean) => void
  onSelectRemote?: (
    source: TaskSource,
    repository: Repository,
    autoProject?: boolean,
    autoProjectExecution?: Task['autoProjectExecution'],
    modelSelection?: Task['modelSelection'],
    modelSelectionDifficulty?: Task['modelSelectionDifficulty'],
    sourceTask?: Task,
  ) => Promise<void>
}) {
  const { workspace, setWorkspace, request, connected, snapshot } = useWorkspace()
  const editable = canChangeTaskCheckout(task)
  const machineControl = editable && (
    <ComposerProject
      task={task}
      controls="server"
      disabled={disabled}
      onMoving={onMachineMoving}
      onSelectRemote={onSelectRemote}
    />
  )
  const choosingBase =
    editable && task.execution === 'worktree' && !task.pullRequest && !task.existingWorktreePath
  const repository = workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const [branches, setBranches] = useApplicationState<Schema.Schema.Type<
    typeof branchesSchema
  > | null>(null)
  const [open, setOpen] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [worktreePicker, setWorktreePicker] = useApplicationState(false)
  const [linkingProjects, setLinkingProjects] = useApplicationState(false)
  const [worktrees, setWorktrees] = useApplicationState<WorktreeChoices | null>(null)
  const [worktreeError, setWorktreeError] = useApplicationState('')
  const showWorktrees = () => {
    setWorktreePicker(true)
    setWorktreeError('')
    void request(
      '/api/scm/worktrees/choices',
      { repositoryId: task.repositoryId },
      worktreeChoicesSchema,
    )
      .then(setWorktrees)
      .catch((cause: unknown) =>
        setWorktreeError(cause instanceof Error ? cause.message : String(cause)),
      )
  }
  const itemClass =
    'flex cursor-default items-center justify-between gap-4 rounded-md px-3 py-2 text-xs outline-none focus:bg-accent data-[state=checked]:bg-accent'
  const act = async (operation: () => Promise<Schema.Schema.Type<typeof branchesSchema>>) => {
    setBusy(true)
    setError('')
    try {
      setBranches(await operation())
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  if (task.autoProject && editable && snapshot?.autoProjectSelectionEnabled === true)
    return (
      <ComposerWorkspaceBar>
        {children}
        {machineControl}
        <ChoicePicker
          aria-label="Scope checkout"
          className="h-6 w-auto gap-1.5 border-0 px-2 text-[0.6875rem] shadow-none"
          value={task.autoProjectExecution ?? 'default'}
          icons={{
            default: <ListFilter className="size-4" />,
            worktree: <GitFork className="size-4" />,
            main: <Folder className="size-4" />,
          }}
          disabled={disabled || !connected}
          onValueChange={(value) => {
            if (value !== 'default' && value !== 'main' && value !== 'worktree') return
            setWorkspace((w) =>
              updateTask(w, task.id, (draft) => ({
                ...draft,
                autoProjectExecution: value === 'default' ? undefined : value,
              })),
            )
          }}
        >
          <option value="default">Project defaults</option>
          <option value="worktree">New worktrees</option>
          <option value="main">Local checkouts</option>
        </ChoicePicker>
      </ComposerWorkspaceBar>
    )
  if (repository?.kind) {
    if (!editable) return children ? <ComposerWorkspaceBar>{children}</ComposerWorkspaceBar> : null
    return (
      <ComposerWorkspaceBar>
        {children}
        {machineControl}
        {repository.kind === 'scratch' ? (
          <>
            <Button
              type="button"
              variant="ghost"
              aria-label="Link projects"
              className="h-6 gap-1.5 px-2 text-[0.6875rem] font-normal"
              disabled={disabled || !editable || !connected}
              onClick={() => setLinkingProjects(true)}
            >
              <Link2 className="size-3.5" />
              Link projects{task.linkedCheckouts?.length ? ` (${task.linkedCheckouts.length})` : ''}
            </Button>
            <Dialog open={linkingProjects} onOpenChange={setLinkingProjects}>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogTitle>Linked projects</DialogTitle>
                <LinkedCheckoutEditor
                  value={task.linkedCheckouts ?? []}
                  disabled={disabled || !editable || !connected}
                  onChange={(links) =>
                    setWorkspace((workspace) =>
                      updateTask(workspace, task.id, (current) =>
                        canChangeTaskCheckout(current)
                          ? { ...current, linkedCheckouts: links }
                          : current,
                      ),
                    )
                  }
                />
                <Button onClick={() => setLinkingProjects(false)}>Done</Button>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <span className="ml-auto inline-flex h-6 items-center gap-1.5 px-2 text-[0.6875rem]">
            <Folder className="size-3 shrink-0" />
            Project folder
          </span>
        )}
      </ComposerWorkspaceBar>
    )
  }
  return (
    <ComposerWorkspaceBar>
      {children}
      {machineControl}
      {editable && <span className="h-4 border-l border-border/60" aria-hidden="true" />}
      {editable ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-6 gap-1.5 px-2 text-[0.6875rem] font-normal"
              aria-label="Working directory"
              data-value={task.execution ?? 'main'}
              disabled={disabled}
            >
              <Folder className="size-3" />
              {task.existingWorktreePath
                ? 'Existing worktree'
                : task.execution === 'worktree'
                  ? 'New worktree'
                  : 'Local checkout'}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              onCloseAutoFocus={(event) => {
                if (open) event.preventDefault()
              }}
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 w-80 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
            >
              <DropdownMenu.RadioGroup
                value={task.existingWorktreePath ? 'existing' : (task.execution ?? 'main')}
                onValueChange={(execution) => {
                  if (disabled || !editable) return
                  if (execution === 'existing') {
                    showWorktrees()
                    return
                  }
                  if (execution === 'worktree') {
                    setOpen(true)
                    void act(() =>
                      request(
                        '/api/scm/branches',
                        { repositoryId: task.repositoryId },
                        branchesSchema,
                      ),
                    )
                  }
                  if (execution === 'main' || execution === 'worktree')
                    setWorkspace((w) =>
                      updateTask(w, task.id, (t) =>
                        canChangeTaskCheckout(t)
                          ? {
                              ...t,
                              execution,
                              existingWorktreePath: undefined,
                            }
                          : t,
                      ),
                    )
                }}
              >
                {(['main', 'worktree'] as const).map((mode) => (
                  <DropdownMenu.RadioItem
                    key={mode}
                    value={mode}
                    data-value={mode}
                    disabled={disabled}
                    className={`${itemClass} my-1 min-h-20 justify-start gap-3 border border-transparent data-[state=checked]:border-border`}
                  >
                    {mode === 'main' ? (
                      <Folder className="size-5 shrink-0" />
                    ) : (
                      <GitFork className="size-5 shrink-0" />
                    )}
                    <span className="flex-1 space-y-1">
                      <span className="block font-medium text-foreground">
                        {mode === 'main' ? 'Local checkout' : 'New worktree'}
                      </span>
                      <span className="block text-[0.6875rem] leading-relaxed text-muted-foreground">
                        {mode === 'main'
                          ? `Use ${repository?.branch || 'the current branch'} and its local changes.`
                          : 'Separate folder and branch. Your current checkout stays untouched.'}
                      </span>
                    </span>
                    <DropdownMenu.ItemIndicator>
                      <Check className="size-3" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
                <DropdownMenu.RadioItem
                  value="existing"
                  disabled={disabled}
                  className={`${itemClass} my-1 min-h-16 justify-start gap-3 border border-transparent data-[state=checked]:border-border`}
                >
                  <GitFork className="size-5 shrink-0" />
                  <span className="flex-1 space-y-1">
                    <span className="block font-medium text-foreground">Existing worktree</span>
                    <span className="block text-[0.6875rem] leading-relaxed text-muted-foreground">
                      Use its current branch and uncommitted files.
                    </span>
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-3" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              <p className="px-3 pb-2 pt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
                New worktrees are created on first send. Existing worktrees keep their current
                files.
              </p>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (value)
            void act(() =>
              request(
                '/api/scm/branches',
                {
                  repositoryId: task.repositoryId,
                  taskId: choosingBase ? undefined : task.id,
                },
                branchesSchema,
              ),
            )
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label="Checkout branch"
            disabled={
              disabled ||
              !connected ||
              !!task.existingWorktreePath ||
              task.status === 'running' ||
              (task.execution === 'worktree' && !task.checkoutBranch && !choosingBase)
            }
            className="ml-auto h-6 min-w-0 max-w-48 gap-1 px-2 text-[0.6875rem] font-normal"
          >
            <GitBranch className="size-3" />
            <span className="truncate">
              {task.existingWorktreePath
                ? task.existingWorktreePath.split('/').at(-1)
                : choosingBase
                  ? task.worktreeIncludeChanges
                    ? 'Current files + changes'
                    : `From ${(task.worktreeBaseBranch ?? (branches && defaultWorktreeBase(branches.branches, branches.current, task.worktreeFromOrigin, branches.originDefault)) ?? (task.worktreeFromOrigin ? 'origin' : 'current branch')).replace(/^refs\/(heads|remotes)\//, '')}`
                  : (task.checkoutBranch ??
                    (task.pullRequest
                      ? `${task.pullRequest.checkoutMode === 'pr-branch' ? 'PR branch' : 'From'} ${task.pullRequest.headBranch || `PR #${task.pullRequest.number}`}`
                      : repository?.branch) ??
                    'Branch')}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={8}
            className="z-50 max-h-72 w-64 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
            aria-label="Checkout branches"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {choosingBase ? 'Create worktree from branch' : 'Switch branch'}
            </p>
            {choosingBase && (
              <label className="flex gap-2 px-2 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={task.worktreeIncludeChanges ?? false}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setWorkspace((w) =>
                      updateTask(w, task.id, (current) =>
                        canChangeTaskCheckout(current)
                          ? {
                              ...current,
                              worktreeIncludeChanges: checked,
                              worktreeBaseBranch: undefined,
                            }
                          : current,
                      ),
                    )
                  }}
                />
                <span>
                  Include uncommitted changes
                  <span className="block text-muted-foreground">
                    Starts from current files. Source stays unchanged.
                  </span>
                </span>
              </label>
            )}
            {choosingBase && branches && !branches.branches.length && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No commits yet. An empty starting commit will be created only on the new task
                branch.
              </p>
            )}
            {branches?.branches.map((branch) => (
              <Button
                key={branch.ref}
                type="button"
                variant="ghost"
                disabled={
                  busy ||
                  (choosingBase && !!task.worktreeIncludeChanges) ||
                  (!choosingBase && (branch.name === branches.current || branch.checkedOut))
                }
                className="h-8 w-full justify-between text-xs font-normal"
                onClick={() =>
                  void act(async () => {
                    if (choosingBase) {
                      setWorkspace((w) =>
                        updateTask(w, task.id, (t) =>
                          canChangeTaskCheckout(t) ? { ...t, worktreeBaseBranch: branch.ref } : t,
                        ),
                      )
                      setOpen(false)
                      return branches
                    }
                    const next = await request(
                      '/api/scm/branch',
                      {
                        repositoryId: task.repositoryId,
                        taskId: task.id,
                        action: 'switch',
                        name: branch.ref,
                        revision: branches.revision,
                      },
                      branchesSchema,
                    )
                    setOpen(false)
                    return next
                  })
                }
              >
                {branch.name}
                {(choosingBase
                  ? [branch.ref, branch.name].includes(
                      task.worktreeBaseBranch ??
                        defaultWorktreeBase(
                          branches.branches,
                          branches.current,
                          task.worktreeFromOrigin,
                          branches.originDefault,
                        ) ??
                        '',
                    )
                  : branch.name === branches.current) && <Check className="size-3" />}
              </Button>
            ))}
            {busy && (
              <p role="status" className="p-2 text-xs">
                Loading branches…
              </p>
            )}
            {error && (
              <p role="alert" className="p-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Dialog open={worktreePicker} onOpenChange={setWorktreePicker}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Use an existing worktree</DialogTitle>
          <p className="text-xs text-muted-foreground">
            The new task works in this checkout, including its uncommitted files. Only one task can
            run there at a time.
          </p>
          {worktreeError && (
            <p role="alert" className="text-xs text-destructive">
              {worktreeError}
            </p>
          )}
          <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {worktrees?.worktrees.map((item) => (
              <Button
                key={item.path}
                variant="ghost"
                className="h-auto w-full justify-start py-2 text-left"
                onClick={() => {
                  setWorkspace((w) =>
                    updateTask(w, task.id, (current) =>
                      canChangeTaskCheckout(current)
                        ? {
                            ...current,
                            execution: 'worktree',
                            existingWorktreePath: item.path,
                            worktreeBaseBranch: undefined,
                          }
                        : current,
                    ),
                  )
                  setWorktreePicker(false)
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {item.branch || item.path.split('/').at(-1)}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-muted-foreground">
                    {item.path}
                    {item.dirty ? ' · Uncommitted changes' : ''}
                  </span>
                </span>
              </Button>
            ))}
            {worktrees && !worktrees.worktrees.length && (
              <p className="p-2 text-xs text-muted-foreground">
                No available worktrees for this project.
              </p>
            )}
            {!worktrees && !worktreeError && (
              <p className="p-2 text-xs text-muted-foreground">Loading worktrees…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ComposerWorkspaceBar>
  )
}
