import { linkedThreadPageSchema, type LinkedThreadRead } from '@dovo/protocol'
import { clientScopeKey, useWorkspace } from '@dovo/studio-core'
import { useLinkedThread } from '@dovo/studio-core/linked-thread'
import { Button } from '@dovo/studio-ui'

export function LinkedThreadPreview({ target }: { target: LinkedThreadRead }) {
  const { connected, request, snapshot, connection } = useWorkspace()
  if (!snapshot?.linkedThreadReadSupported) return null
  return (
    <Transcript
      key={clientScopeKey(connection)}
      target={target}
      connected={connected}
      read={(input) => request('/api/threads/linked/read', input, linkedThreadPageSchema)}
    />
  )
}

function Transcript({
  target,
  connected,
  read,
}: {
  target: LinkedThreadRead
  connected: boolean
  read: (input: LinkedThreadRead) => Promise<typeof linkedThreadPageSchema.Type>
}) {
  const { page, busy, error, refresh, older } = useLinkedThread(target, connected, read)
  return (
    <section aria-label="Linked thread preview" className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">{page?.title ?? 'Linked thread preview'}</h3>
        <Button size="sm" variant="outline" disabled={!connected || busy} onClick={refresh}>
          Refresh preview
        </Button>
      </div>
      {!connected && <p className="text-xs text-muted-foreground">Parent computer offline.</p>}
      {error && (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      {busy && !page && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading linked thread…
        </p>
      )}
      {page?.history.before && (
        <Button size="sm" variant="outline" disabled={!connected || busy} onClick={older}>
          Load earlier messages
        </Button>
      )}
      {page?.history.messages.map((message) => (
        <div key={message.id} className="space-y-1 border-t pt-2 text-xs">
          <p className="font-medium capitalize">{message.role}</p>
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
          {message.nextOffset !== undefined && (
            <p className="text-muted-foreground">Message preview. Pair to read the full message.</p>
          )}
        </div>
      ))}
    </section>
  )
}
