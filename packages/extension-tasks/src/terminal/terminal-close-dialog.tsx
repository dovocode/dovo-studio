import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'

/** Shared by pane, tab and keyboard close actions. Cancel is the initial focus target. */
export function TerminalCloseDialog({
  labels,
  onCancel,
  onConfirm,
  onRestoreFocus,
}: {
  labels: readonly string[]
  onCancel: () => void
  onConfirm: () => void
  onRestoreFocus: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogTitle>
          {labels.length === 1 ? 'Close terminal?' : `Close ${labels.length} terminal panes?`}
        </DialogTitle>
        <DialogDescription>
          This terminates the shell and any running processes in {labels.join(', ')} and clears
          their terminal history. Hide the terminal instead to keep them running.
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close terminal{labels.length > 1 ? ' panes' : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
