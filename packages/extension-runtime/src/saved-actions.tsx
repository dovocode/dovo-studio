import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { useWorkspace, type RuntimeProfile } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function SavedActions({
  profile,
  connected,
}: {
  profile: RuntimeProfile
  connected: boolean
}) {
  const uiText = useInterfaceText()

  const { mutationStatus, retryMutations, discardMutations, runtimes } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = mutationStatus(profile)
  const tasks =
    runtimes.find((entry) => entry.profile.id === profile.id)?.snapshot?.workspace.tasks ?? []
  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {status.pending > 0 && (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Review saved actions
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogTitle>Saved actions · {profile.name}</DialogTitle>
          <DialogDescription>
            Review each action before retrying or discarding it. Discarding cannot undo work already
            applied on the computer. Message previews show up to 500 characters.
          </DialogDescription>
          {(error || status.error) && (
            <p role="alert" className="text-xs text-destructive">
              {error || status.error}
            </p>
          )}
          <ul className="space-y-3">
            {(status.actions ?? []).map((action) => (
              <li key={action.id} className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">{action.label}</p>
                {action.taskId && (
                  <p className="text-xs text-muted-foreground">
                    Thread:{' '}
                    {tasks.find((task) => task.id === action.taskId)?.title || action.taskId}
                  </p>
                )}
                {action.preview && (
                  <p className="whitespace-pre-wrap break-words text-sm">{action.preview}</p>
                )}
                {action.reviewRequired && (
                  <p className="text-xs text-destructive">
                    Computer access changed. This action may already have run; retrying could repeat
                    it.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !connected}
                    onClick={() => {
                      if (
                        action.reviewRequired &&
                        !window.confirm(
                          'Computer access changed. This action may already have run. Check its current state before retrying. Retry this action?',
                        )
                      )
                        return
                      void act(() => retryMutations(profile, action.reviewRequired, action.id))
                    }}
                  >
                    Retry action
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Discard this saved action? Unsent work will be removed from this device. Work already applied on the computer remains applied.',
                        )
                      )
                        return
                      void act(() => discardMutations(profile, action.id))
                    }}
                  >
                    Discard action
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {!status.pending && (
            <p className="text-sm text-muted-foreground">No saved actions remain.</p>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {uiText('Close')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
