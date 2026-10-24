import { useRef, useState } from 'react'
import {
  artifactDeleteResponseSchema,
  artifactWriteResponseSchema,
  resolveTaskAgent,
  type ArtifactMetadata,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
  cn,
  DropdownMenu,
} from '@dovo/studio-ui'
import { Ellipsis, MessageSquarePlus, Trash2 } from 'lucide-react'

export function ArtifactLibraryActions({
  profile,
  artifact,
  onDeleted,
  compact = false,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
  onDeleted: () => void
  compact?: boolean
}) {
  const { runtimes, readRuntime, switchRuntime } = useWorkspace()
  const host = useStudioHost()
  const runtime = runtimes.find((entry) => entry.profile.id === profile.id)
  const [action, setAction] = useState<'add' | 'delete'>()
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState('')
  const menuButton = useRef<HTMLButtonElement>(null)
  const tasks = (runtime?.snapshot?.workspace.tasks ?? []).filter(
    (task) =>
      task.id !== artifact.taskId &&
      !task.archived &&
      !task.archivedAt &&
      resolveTaskAgent(task, runtime?.snapshot?.workspace.agents ?? [])?.permission !==
        'read-only' &&
      task.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const add = () => {
    setError('')
    setAdded('')
    setQuery('')
    setTarget('')
    setAction('add')
  }
  const remove = () => {
    setError('')
    setAction('delete')
  }
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      if (action === 'delete') {
        await readRuntime(
          profile,
          '/api/artifacts/delete',
          { taskId: artifact.taskId, id: artifact.id, expectedRevision: artifact.revision },
          artifactDeleteResponseSchema,
        )
        onDeleted()
      } else {
        await readRuntime(
          profile,
          '/api/artifacts/attach',
          {
            taskId: artifact.taskId,
            id: artifact.id,
            revision: artifact.revision,
            targetTaskId: target,
          },
          artifactWriteResponseSchema,
        )
        setAdded(target)
      }
      setAction(undefined)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className={cn('flex items-center gap-2', compact ? 'shrink-0 pr-2' : 'border-t p-3')}>
        {compact ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                ref={menuButton}
                variant="ghost"
                size="icon"
                aria-label={`Artifact actions ${artifact.title}`}
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                onCloseAutoFocus={(event) => {
                  if (action) event.preventDefault()
                }}
                className="z-50 min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <DropdownMenu.Item
                  disabled={!runtime?.connected}
                  onSelect={add}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-40"
                >
                  <MessageSquarePlus className="size-4" /> Add to thread
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!runtime?.connected}
                  onSelect={remove}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive outline-none focus:bg-accent data-[disabled]:opacity-40"
                >
                  <Trash2 className="size-4" /> Delete artifact
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Add to thread"
              disabled={!runtime?.connected}
              onClick={add}
            >
              <MessageSquarePlus className="size-3.5" />
              Add to thread
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete artifact ${artifact.title}`}
              disabled={!runtime?.connected}
              onClick={remove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      {added && (
        <p
          role="status"
          className={cn('px-4 pb-3 text-xs text-muted-foreground', compact && 'basis-full')}
        >
          Added to thread.{' '}
          <button
            className="underline"
            onClick={() => {
              void switchRuntime(profile.id)
                .then(() => host.navigate({ viewId: 'tasks', entityId: added }))
                .catch((cause: unknown) => setError(String(cause)))
            }}
          >
            Open thread
          </button>
        </p>
      )}
      {!action && error && (
        <p
          role="alert"
          className={cn('px-4 pb-3 text-xs text-destructive', compact && 'basis-full')}
        >
          {error}
        </p>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(undefined)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (compact && menuButton.current) {
              event.preventDefault()
              menuButton.current.focus()
            }
          }}
        >
          <DialogTitle>
            {action === 'delete' ? 'Delete artifact?' : 'Add artifact to a thread'}
          </DialogTitle>
          <DialogDescription>
            {action === 'delete'
              ? `“${artifact.title}” and all its saved versions will be permanently deleted. Copies in other threads are kept.`
              : `Copy “${artifact.title}” into a thread on this computer. The original stays here.`}
          </DialogDescription>
          {action === 'add' && (
            <>
              <Input
                aria-label="Search destination threads"
                placeholder="Search threads…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="Destination thread"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose a thread…</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} ·{' '}
                    {runtime?.snapshot?.workspace.repositories.find(
                      (repo) => repo.id === task.repositoryId,
                    )?.name ?? 'No project'}
                  </option>
                ))}
              </select>
              {!!query.trim() && !tasks.length && (
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Clear thread search
                </Button>
              )}
              {!tasks.length && (
                <p className="text-sm text-muted-foreground">
                  {query.trim()
                    ? 'No threads match this search. Clear the search to see available threads.'
                    : 'No writable threads. Create or reopen a thread on this computer first.'}
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setAction(undefined)}>
              Cancel
            </Button>
            <Button
              variant={action === 'delete' ? 'destructive' : 'default'}
              disabled={
                busy ||
                !runtime?.connected ||
                (action === 'add' && !tasks.some((task) => task.id === target))
              }
              onClick={() => void run()}
            >
              {busy ? 'Saving…' : action === 'delete' ? 'Delete artifact' : 'Add to thread'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
