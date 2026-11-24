import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, IconButton } from '@dovo/studio-ui'
import { CircleAlert, X } from 'lucide-react'

export function BrowserErrorNotice({
  message,
  onDismiss,
  onRetry,
  recovery = false,
}: {
  message: string
  onDismiss: () => void
  onRetry?: () => void
  recovery?: boolean
}) {
  const uiText = useInterfaceText()
  const detail = message
    .replace(/^(?:Error: )?Error invoking remote method 'preview:browser':\s*/, '')
    .replace(/^Error:\s*/, '')
  const technical = !recovery && (!!onRetry || /^(?:ERR_[A-Z_]+|\(-\d+\) loading )/.test(detail))

  return (
    <div className="mx-3 my-2 flex shrink-0 items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-1">
        <div role="alert" className="space-y-1">
          <p className="text-xs font-medium">
            {recovery
              ? uiText('Page stopped')
              : onRetry
                ? uiText('Could not load this page')
                : uiText('Browser error')}
          </p>
          <p className="wrap-anywhere text-xs text-muted-foreground">
            {recovery
              ? detail
              : onRetry
                ? uiText('Try again or check the address.')
                : technical
                  ? uiText('The browser could not complete this action.')
                  : detail}
          </p>
        </div>
        {technical && (
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer py-1">{uiText('Technical details')}</summary>
            <p className="wrap-anywhere select-text pb-1 font-mono">{detail}</p>
          </details>
        )}
        {onRetry && (
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={onRetry}>
            {recovery ? uiText('Reload') : uiText('Retry')}
          </Button>
        )}
      </div>
      <IconButton
        type="button"
        label={uiText('Dismiss error')}
        className="size-6"
        onClick={onDismiss}
      >
        <X aria-hidden="true" size={14} />
      </IconButton>
    </div>
  )
}
