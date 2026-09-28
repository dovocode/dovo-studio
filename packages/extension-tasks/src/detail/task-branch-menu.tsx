import { useEffect } from 'react'
import { ArrowRightLeft, Check, Copy, FolderOpen, GitBranch } from 'lucide-react'
import { useApplicationState } from '@dovo/studio-core/state'
import { canChangeTaskCheckout } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
} from '@dovo/studio-ui'

const item =
  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[disabled]:opacity-50 data-[highlighted]:bg-accent/55 motion-reduce:transition-none'

/** The header's branch label, with quick actions: copy the branch name, or open the task's
 * checkout in Finder, VS Code or Cursor on the computer that runs it. */
export function TaskBranchMenu({ task, label }: { task: Task; label: string }) {
  const { request, connected } = useWorkspace()
  const [notice, setNotice] = useApplicationState('')
  const [moving, setMoving] = useApplicationState(false)
  const [moveBusy, setMoveBusy] = useApplicationState(false)
  const [moveError, setMoveError] = useApplicationState('')
  const inWorktree = task.execution === 'worktree'
  // Only a started, idle task with its own checkout can move; drafts choose it in the composer.
  const canMove =
    connected &&
    !canChangeTaskCheckout(task) &&
    task.status !== 'running' &&
    !task.pullRequest &&
    !task.workItem
  const move = () => {
    if (moveBusy) return
    setMoveBusy(true)
    setMoveError('')
    void request(
      '/api/tasks/handoff',
      { id: task.id, target: inWorktree ? 'main' : 'worktree' },
      responses.ok,
    )
      .then(() => {
        setMoving(false)
        setNotice(inWorktree ? 'Moved to the project folder' : 'Moved to its own worktree')
      })
      .catch((cause: unknown) =>
        setMoveError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setMoveBusy(false))
  }
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 2500)
    return () => clearTimeout(timer)
  }, [notice])
  const branch = task.checkoutBranch
  // Only a started task has a checkout; opening one earlier would create it as a side effect.
  const canOpen = connected && !!branch
  const open = (target: 'finder' | 'vscode' | 'cursor', name: string) =>
    void request(
      '/api/scm/open-folder',
      { repositoryId: task.repositoryId, taskId: task.id, target },
      responses.ok,
    ).then(
      () => setNotice(`Opened in ${name}`),
      (error: unknown) => setNotice(error instanceof Error ? error.message : String(error)),
    )
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={branch ? `${branch} · Copy or open` : label}
          className="hidden max-w-56 items-center gap-1 truncate rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:inline-flex"
        >
          {notice === 'Copied' ? (
            <Check size={10} className="shrink-0 text-emerald-400" />
          ) : (
            <GitBranch size={10} className="shrink-0" />
          )}
          <span className="truncate">{notice && notice !== 'Copied' ? notice : label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Item
            className={item}
            disabled={!branch}
            onSelect={() => {
              if (!branch) return
              void navigator.clipboard.writeText(branch).then(
                () => setNotice('Copied'),
                () => setNotice('Could not copy the branch name'),
              )
            }}
          >
            <Copy className="size-3.5" /> Copy branch name
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {(
            [
              ['finder', 'Finder'],
              ['vscode', 'VS Code'],
              ['cursor', 'Cursor'],
            ] as const
          ).map(([target, name]) => (
            <DropdownMenu.Item
              key={target}
              className={item}
              disabled={!canOpen}
              onSelect={() => open(target, name)}
            >
              <FolderOpen className="size-3.5" /> Open in {name}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} disabled={!canMove} onSelect={() => setMoving(true)}>
            <ArrowRightLeft className="size-3.5" />
            {inWorktree ? 'Move to the project folder…' : 'Move to its own worktree…'}
          </DropdownMenu.Item>
          {!branch && (
            <p className="px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
              Available after the first message.
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      <Dialog open={moving} onOpenChange={(value) => !moveBusy && setMoving(value)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="text-sm">
            {inWorktree ? 'Move to the project folder?' : 'Move to its own worktree?'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {inWorktree
              ? `The project folder switches to ${branch ?? 'this task’s branch'} and the worktree is removed. The task’s uncommitted changes come along. The project folder must have no uncommitted changes.`
              : 'A new worktree and branch are created from the project folder’s current branch. All uncommitted changes in the project folder move with this task, so the folder is clean afterwards.'}{' '}
            The agent continues in a new session with this conversation.
          </DialogDescription>
          {moveError && (
            <p role="alert" className="text-xs text-destructive">
              {moveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={moveBusy} onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button disabled={moveBusy || !connected} onClick={move}>
              {moveBusy ? 'Moving…' : 'Move task'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DropdownMenu.Root>
  )
}
