import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function ComposerCommandDialog({
  command,
  commandBusy,
  refreshing,
  needsRefresh,
  canUndo,
  connected,
  running,
  error,
  onClose,
  onConfirm,
  onRefresh,
}: {
  command: 'undo' | 'new-session' | null
  commandBusy: boolean
  refreshing: boolean
  needsRefresh: boolean
  canUndo: boolean
  connected: boolean
  running: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
  onRefresh: () => void
}) {
  const uiText = useInterfaceText()

  const refreshButton = useRef<HTMLButtonElement>(null)
  const busy = commandBusy || refreshing
  useEffect(() => {
    if (command === 'undo' && needsRefresh && connected && !busy) refreshButton.current?.focus()
  }, [command, needsRefresh, connected, busy])
  return (
    <Dialog open={!!command} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          if (command === 'undo' && needsRefresh && connected && !busy) {
            event.preventDefault()
            refreshButton.current?.focus()
          }
        }}
      >
        <DialogTitle className="text-sm">
          {command === 'undo' ? 'Undo the last turn’s changes?' : 'Start a new agent session?'}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {command === 'undo'
            ? canUndo
              ? 'The files changed by this turn return to their earlier contents. A backup of your current files is saved first.'
              : 'This turn is no longer available to undo. Close this dialog to review the latest changes.'
            : 'The next message starts the agent fresh, with this conversation as context. The current session is not deleted.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {command === 'undo' && needsRefresh && (
          <p className="text-xs text-muted-foreground">
            Refreshing keeps your draft and queued messages.
          </p>
        )}
        {!connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            Connect to this thread’s computer to continue.
          </p>
        ) : running ? (
          <p role="status" className="text-xs text-muted-foreground">
            Wait for the agent to finish or stop it before continuing.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onClose()}>
            {uiText('Cancel')}
          </Button>
          {command === 'undo' && needsRefresh && (
            <Button ref={refreshButton} disabled={busy || !connected} onClick={onRefresh}>
              {refreshing ? 'Refreshing…' : 'Refresh thread'}
            </Button>
          )}
          <Button
            variant={command === 'undo' && needsRefresh ? 'outline' : 'default'}
            disabled={
              busy || !connected || running || (command === 'undo' && (!canUndo || needsRefresh))
            }
            onClick={onConfirm}
          >
            {command === 'undo'
              ? commandBusy
                ? 'Undoing…'
                : 'Undo changes'
              : commandBusy
                ? 'Starting…'
                : 'Start fresh'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
