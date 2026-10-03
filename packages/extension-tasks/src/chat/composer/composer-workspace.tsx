import { TaskMachineSelector } from './task-machine-selector'
import { useApplicationState } from '@dovo/studio-core/state'
import { Schema } from 'effect'
import { Check, ChevronDown, Folder, GitBranch, GitFork } from 'lucide-react'
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
import { Button, Dialog, DialogContent, DialogTitle, DropdownMenu, Popover } from '@dovo/studio-ui'
export function ComposerWorkspace({
  task,
  disabled,
  onMachineMoving,
}: {
  task: Task
  disabled: boolean
  onMachineMoving: (moving: boolean) => void
}) {
  const { workspace, setWorkspace, request, connected } = useWorkspace()
  const editable = canChangeTaskCheckout(task)
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
  if (repository?.kind)
    return (
      <div className="mx-auto flex w-[calc(100%-24px)] max-w-[744px] items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
        <TaskMachineSelector task={task} disabled={disabled} onMoving={onMachineMoving} />
        <Folder className="size-3" />{' '}
        {repository.kind === 'scratch' ? 'No project · private thread folder' : 'Project folder'}
      </div>
    )
  return (
    <div className="relative mx-auto -mt-3 flex w-[calc(100%-24px)] max-w-[744px] flex-wrap items-center gap-x-2 gap-y-1 rounded-b-xl border border-t-0 bg-muted/15 px-2 pb-1.5 pt-4 text-muted-foreground">
      <TaskMachineSelector task={task} disabled={disabled} onMoving={onMachineMoving} />
      <span className="h-4 border-l border-border/60" aria-hidden="true" />
      {editable ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-6 gap-1.5 px-2 text-[0.625rem] font-normal"
              aria-label="Working directory"
              data-value={task.execution ?? 'main'}
              disabled={disabled}
            >
              <Folder className="size-3" />
              {task.existingWorktreePath
                ? 'Existing worktree'
                : task.execution === 'worktree'
                  ? 'Worktree'
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
      ) : (
        <span
          className="inline-flex h-6 items-center gap-1.5 px-2 text-[0.625rem]"
          aria-label={`Working directory: ${task.execution === 'worktree' ? 'Worktree' : 'Local checkout'}`}
          title="Checkout cannot be changed after a task starts."
        >
          <Folder className="size-3" />
          {task.execution === 'worktree' ? 'Worktree' : 'Local checkout'}
        </span>
      )}
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
            className="ml-auto h-6 min-w-0 max-w-48 gap-1 px-2 text-[0.625rem] font-normal"
          >
            <GitBranch className="size-3" />
            <span className="truncate">
              {task.existingWorktreePath
                ? task.existingWorktreePath.split('/').at(-1)
                : choosingBase
                  ? `From ${(task.worktreeBaseBranch ?? (branches && defaultWorktreeBase(branches.branches, branches.current, task.worktreeFromOrigin, branches.originDefault)) ?? (task.worktreeFromOrigin ? 'origin' : 'current branch')).replace(/^refs\/(heads|remotes)\//, '')}`
                  : (task.checkoutBranch ?? repository?.branch ?? 'Branch')}
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
            {branches?.branches.map((branch) => (
              <Button
                key={branch.ref}
                type="button"
                variant="ghost"
                disabled={
                  busy || (!choosingBase && (branch.name === branches.current || branch.checkedOut))
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
    </div>
  )
}
