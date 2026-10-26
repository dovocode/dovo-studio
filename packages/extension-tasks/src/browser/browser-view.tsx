import { STUDIO_BROWSER_SCOPE, previewUrl } from '@dovo/protocol'
import { useCallback } from 'react'
import { useAppPreferences, useStudioHost, type StudioViewProps } from '@dovo/studio-core'
import { BrowserPane } from './browser-pane'
export default function BrowserView({ entityId, navigationKey }: StudioViewProps) {
  const { navigate, browserWindowId } = useStudioHost()
  const consumed = useCallback(() => navigate({ viewId: 'browser' }, { replace: true }), [navigate])
  const enabled = useAppPreferences().browserWorkspaceEnabled
  if (!enabled)
    return (
      <div className="p-6 text-sm">
        <h1 className="font-medium">Experimental Browser is off</h1>
        <p className="mt-2 text-muted-foreground">
          Enable Browser workspace in Settings → General → Experimental.
        </p>
        {!browserWindowId && (
          <button
            type="button"
            className="mt-4 underline"
            onClick={() => navigate({ viewId: 'general' })}
          >
            Open settings
          </button>
        )}
      </div>
    )
  let url: string | undefined
  try {
    if (entityId) url = previewUrl(entityId)
  } catch {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        This browser link is not a valid HTTP or HTTPS address.
      </p>
    )
  }
  return (
    <BrowserPane
      taskId={STUDIO_BROWSER_SCOPE}
      shared
      openLink={url ? { id: `${navigationKey}:${url}`, url } : null}
      onLinkOpened={consumed}
    />
  )
}
