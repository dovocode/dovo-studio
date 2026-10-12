import { useCallback } from 'react'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function TaskWaitingPanel({ taskId }: { taskId: string }) {
  const { request, connected } = useWorkspace()
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      request('/api/tasks/waiting', input, taskWaitingSchema),
    [request],
  )
  const { data, error, busy, refresh } = useTaskWaiting(taskId, connected, read)
  return (
    <section
      aria-label="Waiting for"
      className="max-h-48 shrink-0 space-y-2 overflow-y-auto border-b bg-muted/20 px-4 py-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Waiting for</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || busy}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </div>
      <p className="text-muted-foreground">Unlink stops monitoring this item for this thread.</p>
      {!connected && <p>Connect the runtime to manage waiting items.</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!data && connected && !error && <p>Loading waiting items…</p>}
      {data?.dependencies.length === 0 && <p>No active waiting items.</p>}
      {data?.dependencies.map((item) => (
        <div
          key={JSON.stringify([item.kind, item.repositoryId, item.target])}
          className="flex items-start gap-3 rounded-md border p-2"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {item.project} · {item.label}
            </p>
            <p className="text-muted-foreground">{item.status}</p>
            <p className="break-all text-muted-foreground">{item.url}</p>
            {item.error && <p className="text-destructive">{item.error}</p>}
          </div>
          <Button
            size="sm"
            variant="outline"
            aria-label={`Unlink ${item.label}`}
            disabled={!connected || busy}
            onClick={() =>
              void refresh({
                kind: item.kind,
                repositoryId: item.repositoryId,
                target: item.target,
              })
            }
          >
            Unlink
          </Button>
        </div>
      ))}
    </section>
  )
}
