import { useApplicationState } from '@dovo/studio-core/state'
import { pullTaskResponse, useStudioHost, useWorkspace, type PullDetail } from '@dovo/studio-core'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { ChevronDown, Plus } from 'lucide-react'

export function StartPullTask({
  repositoryId,
  initialObjective,
  stackAction,
  pull,
  open,
  onOpenChange,
}: {
  repositoryId: string
  initialObjective?: string
  stackAction?: 'update'
  pull: PullDetail['pull']
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { request, connected } = useWorkspace()
  const host = useStudioHost()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const create = async (checkoutMode: 'new-branch' | 'pr-branch') => {
    if (busy || !connected) return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/pulls/task',
        {
          repositoryId,
          number: pull.number,
          headSha: pull.headSha,
          objective: stackAction
            ? 'Update the stack, restack branches and update PRs.'
            : (initialObjective ?? 'I want to work on this PR.'),
          checkoutMode,
          stackAction,
          run: false,
        },
        pullTaskResponse,
      )
      host.navigate({ viewId: 'tasks', entityId: result.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const itemClass =
    'cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40'
  return (
    <div className="relative">
      <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
        <DropdownMenu.Trigger asChild>
          <Button
            size="sm"
            variant="outline"
            aria-label="New task"
            title="Start a task from this PR"
            disabled={!connected || busy}
          >
            <Plus className="size-3.5" />
            <span className="hidden @lg/pr-detail:inline">{busy ? 'Creating…' : 'New task'}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            aria-label="PR worktree branch"
            className="z-50 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            <DropdownMenu.Item className={itemClass} onSelect={() => void create('new-branch')}>
              {stackAction ? 'Update PR stack' : 'New branch from PR'}
            </DropdownMenu.Item>
            {!stackAction && (
              <DropdownMenu.Item
                className={itemClass}
                disabled={!pull.headCloneUrl}
                onSelect={() => void create('pr-branch')}
                title={!pull.headCloneUrl ? 'The PR source repository is unavailable.' : undefined}
              >
                Use PR branch
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border bg-popover p-3 text-xs text-destructive shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  )
}
