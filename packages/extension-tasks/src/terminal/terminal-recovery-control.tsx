import { terminalRecoveryDescription, type RuntimeSnapshot } from '@dovo/protocol'
import { History } from 'lucide-react'
import { Button, cn } from '@dovo/studio-ui'

export function TerminalRecoveryControl({
  enabled,
  disabled,
  snapshot,
  onChange,
}: {
  enabled: boolean
  snapshot?: Pick<
    RuntimeSnapshot,
    'terminalRecoverySupported' | 'terminalLiveRecoverySupported'
  > | null
  disabled?: boolean
  onChange: (enabled: boolean) => void
}) {
  const supported = snapshot?.terminalRecoverySupported === true
  const description =
    terminalRecoveryDescription(snapshot) +
    (supported
      ? ' This adds Dovo hooks to supported tools. Codex requires a one-time hook review.'
      : '')
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={supported && enabled}
      disabled={disabled || !supported}
      onClick={() => onChange(!enabled)}
      className="h-7 gap-1.5 text-xs font-normal text-muted-foreground"
      title={description}
      aria-description={description}
    >
      <History className={cn('size-3.5', supported && enabled && 'text-primary')} />
      Remember session
    </Button>
  )
}
