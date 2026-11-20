import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function ComposerCommandDialog({
  command,
  commandBusy,
  connected,
  running,
  error,
  onClose,
  onConfirm,
}: {
  command: 'backup' | 'new-session' | null
  commandBusy: boolean
  connected: boolean
  running: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
}) {
  const uiText = useInterfaceText()

  return (
    <Dialog open={!!command} onOpenChange={(open) => !open && !commandBusy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-sm">
          {command === 'backup' ? 'Review saved Undo backup?' : 'Start a new agent session?'}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {command === 'backup'
            ? 'Keep the current files and add backup recovery instructions to this conversation.'
            : 'The next message starts the agent fresh, with this conversation as context. The current session is not deleted.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
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
          <Button variant="outline" disabled={commandBusy} onClick={() => onClose()}>
            {uiText('Cancel')}
          </Button>
          <Button disabled={commandBusy || !connected || running} onClick={onConfirm}>
            {command === 'backup'
              ? commandBusy
                ? 'Saving…'
                : 'Keep current files'
              : commandBusy
                ? 'Starting…'
                : 'Start fresh'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
