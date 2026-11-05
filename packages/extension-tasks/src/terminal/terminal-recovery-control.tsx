import { History } from 'lucide-react'
import { Button, cn } from '@dovo/studio-ui'

export function TerminalRecoveryControl({
  enabled,
  disabled,
  supported = true,
  onChange,
}: {
  enabled: boolean
  supported?: boolean
  disabled?: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={supported && enabled}
      disabled={disabled || !supported}
      onClick={() => onChange(!enabled)}
      className="h-7 gap-1.5 text-xs font-normal text-muted-foreground"
      title={
        supported
          ? 'Restore this terminal after restart. Adds Dovo lifecycle integrations to agent configuration; Codex requires a one-time hook review.'
          : 'Update Dovo on this computer to enable terminal session recovery.'
      }
    >
      <History className={cn('size-3.5', supported && enabled && 'text-primary')} />
      Remember session
    </Button>
  )
}
