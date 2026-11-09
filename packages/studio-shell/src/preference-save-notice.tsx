import { retryAppPreferences, useAppPreferenceSaveError } from '@dovo/studio-core'
import { useEffect } from 'react'
import { Button } from '@dovo/studio-ui'

export function PreferenceSaveNotice() {
  const error = useAppPreferenceSaveError()
  useEffect(() => {
    if (error === null) return
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [error])
  if (error === null) return null
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-background px-4 py-2 text-xs"
    >
      <div className="min-w-0 flex-1">
        <p>
          Studio could not read or save settings on this device. Your stored settings are kept. Keep
          this window open to retain pending changes.
        </p>
        <p className="break-words text-muted-foreground">{error}</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => retryAppPreferences()}>
        Retry saving settings
      </Button>
    </div>
  )
}
