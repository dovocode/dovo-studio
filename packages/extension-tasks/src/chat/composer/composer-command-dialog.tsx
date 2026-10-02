import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function ComposerCommandDialog({
  command,
  commandBusy,
  canUndo,
  connected,
  running,
  error,
  onClose,
  onConfirm,
}: {
  command: 'undo' | 'new-session' | null
  commandBusy: boolean
  canUndo: boolean
  connected: boolean
  running: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={!!command} onOpenChange={(open) => !open && !commandBusy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-sm">
          {command === 'undo' ? 'Undo the last turn’s changes?' : 'Start a new agent session?'}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {command === 'undo'
            ? canUndo
              ? 'The files that turn changed go back to how they were before it. Your current files are saved first, so you can redo this from the turn.'
              : 'No turn has file changes left to undo.'
            : 'The next message starts the agent fresh, with this conversation as context. The current session is not deleted.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={commandBusy} onClick={() => onClose()}>
            Cancel
          </Button>
          <Button
            disabled={commandBusy || !connected || running || (command === 'undo' && !canUndo)}
            onClick={onConfirm}
          >
            {command === 'undo' ? 'Undo changes' : 'Start fresh'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
