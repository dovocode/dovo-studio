import { useState } from 'react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function PullLinkActions({
  task,
  pull,
  onOpen,
  onClose,
}: {
  task: Task
  pull: NonNullable<Task['linkedPullRequests']>[number]
  onOpen: (url: string) => boolean
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const linked =
    task.pullRequest?.url === pull.url ||
    task.linkedPullRequests?.some((item) => item.url === pull.url)
  const unavailable =
    !connected ||
    !!task.archivedAt ||
    !!task.archived ||
    (task.linkedPullRequests?.length ?? 0) >= 20
  const link = async () => {
    if (busy || linked || unavailable) return
    setBusy(true)
    setError('')
    try {
      await request('/api/scm/pulls/link-thread', { id: task.id, pulls: [pull] }, responses.ok)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>Pull request #{pull.number}</DialogTitle>
        <DialogDescription className="break-all text-xs">{pull.url}</DialogDescription>
        <Button type="button" disabled={busy || linked || unavailable} onClick={() => void link()}>
          {busy ? 'Linking…' : linked ? 'Already linked to this thread' : 'Link to this thread'}
        </Button>
        <Button asChild variant="outline" disabled={busy}>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (busy) {
                event.preventDefault()
                return
              }
              if (onOpen(pull.url)) event.preventDefault()
              onClose()
            }}
          >
            Open PR
          </a>
        </Button>
        {!connected && (
          <p className="text-xs text-muted-foreground">
            Connect to the thread’s computer to link this PR.
          </p>
        )}
        {(task.archivedAt || task.archived) && (
          <p className="text-xs text-muted-foreground">Reopen this thread to link this PR.</p>
        )}
        {!linked && (task.linkedPullRequests?.length ?? 0) >= 20 && (
          <p className="text-xs text-muted-foreground">
            A thread can link at most 20 pull requests.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
