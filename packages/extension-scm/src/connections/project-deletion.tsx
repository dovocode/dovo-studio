import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useWorkspace, type Repository } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dovo/studio-ui'
import { useEffect, useRef } from 'react'

export function ProjectDeletion({
  repository,
  onDeleted,
}: {
  repository: Repository
  onDeleted?: (refreshError?: string) => void
}) {
  const { connected, activeRuntimeId, readRuntime, refreshRuntime, runtimes } = useWorkspace()
  const [confirmation, setConfirmation] = useApplicationState<{
    repositoryId: string
    runtimeId: string | null
  } | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const open =
    confirmation?.repositoryId === repository.id && confirmation.runtimeId === activeRuntimeId
  useEffect(() => {
    setConfirmation(null)
  }, [activeRuntimeId, repository.id, setConfirmation])

  if (repository.kind) return null

  const remove = async () => {
    if (!open || !confirmation || pending.current) return
    const target = confirmation
    const profile = runtimes.find((entry) => entry.profile.id === target.runtimeId)?.profile
    if (!profile) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await readRuntime(
        profile,
        '/api/scm/repositories/delete',
        { repositoryId: target.repositoryId },
        responses.ok,
        'POST',
      )
      setConfirmation(null)
      let refreshError: string | undefined
      try {
        await refreshRuntime(profile)
      } catch (cause) {
        refreshError = cause instanceof Error ? cause.message : String(cause)
      }
      onDeleted?.(refreshError)
      if (refreshError && !onDeleted)
        setError(`Project deleted, but refresh failed: ${refreshError}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-destructive/40 p-3">
      <div>
        <h3 className="text-sm font-medium">Delete project</h3>
        <p className="text-xs text-muted-foreground">
          Remove this project and its task and conversation history from Dovo. Repository and
          worktree files stay on disk.
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={!connected || busy}
        onClick={() => {
          setError('')
          setConfirmation({ repositoryId: repository.id, runtimeId: activeRuntimeId })
        }}
      >
        Delete {repository.name}…
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!busy) setConfirmation(open ? confirmation : null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{repository.name}”?</DialogTitle>
            <DialogDescription>
              This removes the project and its task and conversation history from Dovo. The
              repository and worktree files remain on disk. Active work must finish before you can
              delete this project.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!connected || busy}
              onClick={() => void remove()}
            >
              {busy ? 'Deleting…' : `Delete ${repository.name} and history`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
