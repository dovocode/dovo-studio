import { TaskMachineSelector } from './task-machine-selector'
import { useApplicationState } from '@dovo/studio-core/state'
import { Schema } from 'effect'
import { Check, ChevronDown, Folder, GitBranch, GitFork } from 'lucide-react'
import {
  branchesSchema,
  defaultWorktreeBase,
  resolveTaskDefaults,
  canChangeTaskCheckout,
  updateTask,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Button, DropdownMenu, Popover } from '@dovo/studio-ui'
export function ComposerWorkspace({
  task,
  disabled,
  onMachineMoving,
}: {
  task: Task
  disabled: boolean
  onMachineMoving: (moving: boolean) => void
}) {
  const { workspace, setWorkspace, request, connected, snapshot } = useWorkspace()
  const editable = canChangeTaskCheckout(task)
  const choosingBase = editable && task.execution === 'worktree' && !task.pullRequest
  const repository = workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const [branches, setBranches] = useApplicationState<Schema.Schema.Type<
    typeof branchesSchema
  > | null>(null)
  const [open, setOpen] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
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
  return (
    <div className="relative mx-auto -mt-3 flex w-[calc(100%-24px)] max-w-[744px] flex-wrap items-center gap-x-2 gap-y-1 rounded-b-md border border-t-0 bg-muted/20 px-2 pb-1.5 pt-4 text-muted-foreground">
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
              {task.execution === 'worktree' ? 'Worktree' : 'Local checkout'}
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
                value={task.execution ?? 'main'}
                onValueChange={(execution) => {
                  if (disabled || !editable) return
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
              </DropdownMenu.RadioGroup>
              <p className="px-3 pb-2 pt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
                Created on first send. The branch name uses your AI-generated task title.
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
      <TaskMachineSelector task={task} disabled={disabled} onMoving={onMachineMoving} />
      {editable && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-6 min-w-0 max-w-40 gap-1 px-1 text-[0.625rem] font-normal"
              aria-label="Task project"
              data-value={task.repositoryId}
              disabled={disabled || !!task.workItem}
            >
              <span className="truncate">{repository?.name ?? 'Choose project'}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 max-h-64 min-w-48 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
            >
              {workspace.repositories.map((repo) => (
                <DropdownMenu.Item
                  key={repo.id}
                  data-value={repo.id}
                  className={itemClass}
                  disabled={disabled || !!task.workItem}
                  onSelect={() =>
                    setWorkspace((w) =>
                      updateTask(w, task.id, (t) =>
                        canChangeTaskCheckout(t) && !t.workItem
                          ? {
                              ...t,
                              ...resolveTaskDefaults(snapshot?.defaults, repo),
                              harness: t.agentId
                                ? undefined
                                : resolveTaskDefaults(snapshot?.defaults, repo).harness,
                              repositoryId: repo.id,
                            }
                          : t,
                      ),
                    )
                  }
                >
                  {repo.name}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
              task.status === 'running' ||
              (task.execution === 'worktree' && !task.checkoutBranch && !choosingBase)
            }
            className="ml-auto h-6 min-w-0 max-w-48 gap-1 px-2 text-[0.625rem] font-normal"
          >
            <GitBranch className="size-3" />
            <span className="truncate">
              {choosingBase
                ? `From ${(task.worktreeBaseBranch ?? (branches && defaultWorktreeBase(branches.branches, branches.current)) ?? 'origin/main or origin/master').replace(/^refs\/(heads|remotes)\//, '')}`
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
                        defaultWorktreeBase(branches.branches, branches.current) ??
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
    </div>
  )
}
