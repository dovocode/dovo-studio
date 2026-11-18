import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { projectDeletionPreview } from '@dovo/studio-core/project-deletion'
import { useApplicationState } from '@dovo/studio-core/state'
import { runtimeComputerName } from '@dovo/protocol'
import { responses, useStudioHost, useWorkspace, type Repository } from '@dovo/studio-core'
import { AlertTriangle } from 'lucide-react'
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
  const uiText = useInterfaceText()

  const host = useStudioHost()
  const { connected, activeRuntimeId, readRuntime, refreshRuntime, runtimes, workspace, snapshot } =
    useWorkspace()
  const [confirmation, setConfirmation] = useApplicationState<{
    repositoryId: string
    runtimeId: string | null
  } | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const profile = runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile
  const computer = runtimeComputerName({ profile, snapshot })
  const pending = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const { blockers, projectThreads, affectedAutomations } = projectDeletionPreview(
    repository.id,
    workspace,
    snapshot,
  )
  const blocker = blockers[0]
  const open =
    confirmation?.repositoryId === repository.id && confirmation.runtimeId === activeRuntimeId
  useEffect(() => {
    setConfirmation(null)
  }, [activeRuntimeId, repository.id, setConfirmation])

  if (repository.kind) return null

  const remove = async () => {
    if (!open || !confirmation || pending.current || !connected || blocker) return
    const target = confirmation
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
          Remove this project and its thread and conversation history from Dovo. Repository and
          worktree files stay on disk.
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={() => {
          setError('')
          setConfirmation({ repositoryId: repository.id, runtimeId: activeRuntimeId })
        }}
      >
        {uiText('Delete')} {repository.name}…
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
        <DialogContent
          className="max-h-[90dvh] max-w-md overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancel.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete “{repository.name}”?</DialogTitle>
            <DialogDescription>
              This deletion applies to {computer} only. You cannot undo it.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">Will be removed</dt>
              <dd className="text-muted-foreground">
                The project entry and its thread and conversation history from Dovo. Local artifact
                feeds for those threads stop.
              </dd>
              {connected && snapshot && (
                <dd className="text-muted-foreground">Project threads: {projectThreads}</dd>
              )}
            </div>
            <div>
              <dt className="font-medium">Will change</dt>
              <dd className="text-muted-foreground">
                Dovo disables affected automations, redirects project targets to General, and
                removes links to this checkout from other threads and automations.
              </dd>
              {connected && snapshot && (
                <dd className="text-muted-foreground">
                  Affected automations: {affectedAutomations}
                </dd>
              )}
            </div>
            <div>
              <dt className="font-medium">Will stay</dt>
              <dd className="text-muted-foreground">
                Repository and worktree files remain on disk. Other projects, their threads, and
                hosted artifact copies remain.
              </dd>
            </div>
          </dl>
          {(!connected || !profile) && (
            <p role="status" className="text-sm text-muted-foreground">
              Connect to {computer} before deleting this project.
            </p>
          )}
          {connected && profile && blocker && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-xs"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <div className="space-y-2">
                <p className="font-medium text-foreground">Deletion blocked</p>
                {blocker.name && <p className="break-words">{blocker.name}</p>}
                {blocker.reasons.map((reason) => (
                  <p key={reason} className="leading-relaxed text-muted-foreground">
                    {uiText(reason)}
                  </p>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmation(null)
                    if (blocker.kind === 'thread') {
                      host.navigate({ viewId: 'tasks', entityId: blocker.id })
                    } else {
                      host.navigate({
                        viewId: 'jobs',
                        entityId: blocker.id,
                        automationTarget: {
                          runtimeId: profile.id,
                          automationId: blocker.automationId,
                          runId: blocker.id,
                        },
                      })
                    }
                  }}
                >
                  {uiText(
                    blocker.kind === 'thread'
                      ? 'Open affected thread'
                      : 'Open affected automation run',
                  )}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              ref={cancel}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              {uiText('Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!connected || !profile || busy || !!blocker}
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
