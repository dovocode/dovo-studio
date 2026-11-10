import { useCallback, useState } from 'react'
import { taskWaitingSchema, pipelineSignal, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting, useWorkspace, useStudioHost } from '@dovo/studio-core'

/** Read the watcher's saved snapshot. The client never polls the forge. */
export function TaskPipelineProgress({ taskId, active }: { taskId: string; active: boolean }) {
  const { request, connected, activeRuntimeId, connection } = useWorkspace()
  const { openExternalLink } = useStudioHost()
  const [linkError, setLinkError] = useState('')
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      request('/api/tasks/waiting', input, taskWaitingSchema),
    [request],
  )
  const { data, error } = useTaskWaiting(
    taskId,
    connected,
    read,
    JSON.stringify([activeRuntimeId, connection]),
    active,
  )
  const pipelines = data?.dependencies.filter((item) => item.kind === 'pipeline') ?? []
  if (!pipelines.length) return null
  return (
    <section
      aria-label="Pipeline progress"
      className="max-h-40 shrink-0 space-y-2 overflow-y-auto border-b border-border/60 px-4 py-2 text-xs"
    >
      {pipelines.map((item) => {
        const progress = item.progress
        const measured = progress && progress.total > 0 && !progress.partial
        return (
          <div key={JSON.stringify([item.repositoryId, item.target])} className="space-y-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <a
                className="truncate hover:underline"
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={`${item.project} · ${item.label}`}
                onClick={
                  openExternalLink
                    ? (event) => {
                        event.preventDefault()
                        setLinkError('')
                        void Promise.resolve(openExternalLink(item.url)).catch((cause) =>
                          setLinkError(String(cause)),
                        )
                      }
                    : undefined
                }
              >
                {item.project} · {item.label}
              </a>
              <span className="shrink-0 text-muted-foreground">
                {measured ? `${progress.completed}/${progress.total} jobs · ` : ''}
                {pipelineSignal(item.status).label}
              </span>
            </div>
            <progress
              className="h-1.5 w-full accent-primary"
              aria-label={`${item.label} jobs`}
              max={measured ? progress.total : undefined}
              value={measured ? progress.completed : undefined}
            />
            {(!connected || error || item.error || item.pausedReason) && (
              <p className="text-muted-foreground">
                {!connected
                  ? 'Offline · Last known progress'
                  : error || item.pausedReason || item.error}
              </p>
            )}
          </div>
        )
      })}
      {!!linkError && (
        <p role="alert" className="text-destructive">
          {linkError}
        </p>
      )}
    </section>
  )
}
