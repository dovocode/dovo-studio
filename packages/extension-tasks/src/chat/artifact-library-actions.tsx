import { useState } from 'react'
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
} from '@dovo/studio-ui'
import { MessageSquarePlus, Trash2 } from 'lucide-react'

export function ArtifactLibraryActions({
  profile,
  artifact,
  onDeleted,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
  onDeleted: () => void
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
  const tasks = (runtime?.snapshot?.workspace.tasks ?? []).filter(
    (task) =>
      task.id !== artifact.taskId &&
      !task.archived &&
      !task.archivedAt &&
      resolveTaskAgent(task, runtime?.snapshot?.workspace.agents ?? [])?.permission !==
        'read-only' &&
      task.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
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
      <div className="flex items-center gap-2 border-t p-3">
        <Button
          size="sm"
          variant="ghost"
          disabled={!runtime?.connected}
          onClick={() => {
            setError('')
            setAdded('')
            setAction('add')
          }}
        >
          <MessageSquarePlus className="size-3.5" />
          Add to thread
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete artifact ${artifact.title}`}
          disabled={!runtime?.connected}
          onClick={() => {
            setError('')
            setAction('delete')
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {added && (
        <p role="status" className="px-4 pb-3 text-xs text-muted-foreground">
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
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(undefined)
        }}
      >
        <DialogContent>
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
                    {task.title}
                  </option>
                ))}
              </select>
              {!tasks.length && (
                <p className="text-sm text-muted-foreground">
                  No matching writable threads. Create or reopen a thread on this computer first.
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
