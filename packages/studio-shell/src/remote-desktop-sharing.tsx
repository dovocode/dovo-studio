import { useState } from 'react'
import { WorkspaceScope, useRuntimeSources, useWorkspace } from '@dovo/studio-core'
import { remoteDesktopResponseSchema } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'

export function RemoteDesktopSharing() {
  const sources = useRuntimeSources().filter(
    (source) => source.connected && source.snapshot?.remoteDesktopSession,
  )
  if (!sources.length) return null
  return (
    <aside
      aria-label="Desktop sharing"
      className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-destructive/50 bg-background p-3 shadow-lg"
    >
      {sources.map((source) => (
        <WorkspaceScope key={source.scope} profile={source.profile}>
          <SharingStatus name={source.name} />
        </WorkspaceScope>
      ))}
    </aside>
  )
}
function SharingStatus({ name }: { name: string }) {
  const { snapshot, request } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const session = snapshot?.remoteDesktopSession
  if (!session) return null
  return (
    <div className="space-y-2">
      <p role="status" className="text-xs">
        {name}: desktop {session.control ? 'controlled' : 'viewed'} by {session.viewer}
      </p>
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError('')
          void request(
            '/api/remote-desktop',
            { action: 'stop', id: session.id },
            remoteDesktopResponseSchema,
          )
            .catch((cause) =>
              setError(
                `Stop not confirmed: ${cause instanceof Error ? cause.message : String(cause)}`,
              ),
            )
            .finally(() => setBusy(false))
        }}
      >
        Stop sharing
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
