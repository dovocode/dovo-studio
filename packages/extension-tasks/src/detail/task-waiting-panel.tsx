import { useCallback } from 'react'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting, useWorkspace, useStudioHost } from '@dovo/studio-core'
import { X } from 'lucide-react'
import { Button } from '@dovo/studio-ui'

export function TaskWaitingPanel({ taskId }: { taskId: string }) {
  const { openExternalLink } = useStudioHost()
  const { request, connected } = useWorkspace()
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      request('/api/tasks/waiting', input, taskWaitingSchema),
    [request],
  )
  const { data, error, busy, refresh } = useTaskWaiting(taskId, connected, read)
  if (!error && !data?.dependencies.length) return null
  return (
    <section
      aria-label="Waiting for"
      className="flex max-h-32 shrink-0 flex-wrap items-center gap-2 overflow-y-auto px-4 py-2 text-xs"
    >
      {!connected && <p>Connect the runtime to manage waiting items.</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label="Refresh waiting items"
        disabled={!connected || busy}
        onClick={() => void refresh()}
      >
        ↻
      </Button>
      {data?.dependencies.map((item) => (
        <div
          key={JSON.stringify([item.kind, item.repositoryId, item.target])}
          className="inline-flex max-w-full items-center rounded-full border bg-muted/30"
          title={[item.pausedReason ?? item.status, item.error].filter(Boolean).join(' · ')}
        >
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate py-1.5 pl-3 pr-1 hover:underline"
            onClick={
              openExternalLink
                ? (event) => {
                    event.preventDefault()
                    void openExternalLink(item.url)
                  }
                : undefined
            }
          >
            {item.project} · {item.label}
          </a>
          {item.pausedReason && <span className="px-1 text-muted-foreground">Paused</span>}
          {item.error && (
            <span className="text-destructive" role="status">
              {item.error}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Stop watching ${item.label}`}
            disabled={!connected || busy}
            className="h-7 w-7 rounded-full p-0"
            onClick={() => {
              if (window.confirm(`Stop watching ${item.label} for this thread?`))
                void refresh({
                  kind: item.kind,
                  repositoryId: item.repositoryId,
                  target: item.target,
                })
            }}
          >
            <X size={12} />
          </Button>
        </div>
      ))}
    </section>
  )
}
