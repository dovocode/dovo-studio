import { useCallback } from 'react'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting, useWorkspace, useStudioHost } from '@dovo/studio-core'
import { Eye, Link2, RefreshCw, X } from 'lucide-react'
import { Button } from '@dovo/studio-ui'

export function TaskWaitingPanel({ taskId, panel = false }: { taskId: string; panel?: boolean }) {
  const { openExternalLink, openPullLink } = useStudioHost()
  const { request, connected } = useWorkspace()
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      request('/api/tasks/waiting', input, taskWaitingSchema),
    [request],
  )
  const { data, error, busy, refresh } = useTaskWaiting(taskId, connected, read)
  const watchingUrls = new Set(data?.dependencies.map((item) => item.url))
  const related = data?.related?.filter((item) => !watchingUrls.has(item.url)) ?? []
  if (!error && !data?.dependencies.length && !related.length) return null
  return (
    <section
      aria-label="Related items and watchers"
      className={
        panel
          ? 'studio-project-section border-t border-border/60 text-xs'
          : 'flex max-h-32 shrink-0 flex-wrap items-center gap-2 overflow-y-auto px-4 py-2 text-xs'
      }
    >
      {!connected && <p>Connect the runtime to manage waiting items.</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {panel ? (
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <Eye size={16} />
          <h3 className="flex-1 text-xs font-medium">Watching</h3>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh waiting items"
            disabled={!connected || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh waiting items"
          disabled={!connected || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} />
        </Button>
      )}
      {panel && (
        <p className="mb-3 text-[11px] text-muted-foreground">
          {data?.dependencies.length
            ? 'Updates arrive in this thread. × stops watching.'
            : 'No active watches for this thread.'}
        </p>
      )}
      <div className={panel ? 'flex flex-wrap gap-2' : 'contents'}>
        {data?.dependencies.map((item) => (
          <div
            key={JSON.stringify([item.kind, item.repositoryId, item.target])}
            className="inline-flex max-w-full items-center rounded-full border bg-muted/30"
            title={[item.pausedReason ?? item.status, item.error].filter(Boolean).join(' · ')}
          >
            <Eye size={13} className="ml-2 shrink-0 text-muted-foreground" aria-hidden="true" />
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate py-1.5 pl-3 pr-1 hover:underline"
              onClick={
                openExternalLink || openPullLink
                  ? (event) => {
                      event.preventDefault()
                      if (!openPullLink?.(item.url)) void openExternalLink?.(item.url)
                    }
                  : undefined
              }
            >
              {item.project} · {item.label}
            </a>
            {panel && !item.pausedReason && (
              <span className="pr-1 text-[10px] text-muted-foreground">
                {item.status.replaceAll('_', ' ')}
              </span>
            )}
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
      </div>
      {panel && related.length > 0 && (
        <h3 className="mb-2 mt-3 text-[11px] font-medium text-muted-foreground">
          Related links · Not watched
        </h3>
      )}
      <div className={panel ? 'flex flex-wrap gap-2' : 'contents'}>
        {related.map((item) => (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full truncate rounded-full border bg-muted/30 px-3 py-1.5 hover:underline"
            title={`${item.project} · ${item.label}`}
            onClick={
              openExternalLink || openPullLink
                ? (event) => {
                    event.preventDefault()
                    if (!openPullLink?.(item.url)) void openExternalLink?.(item.url)
                  }
                : undefined
            }
          >
            {panel && <Link2 size={12} className="mr-1 inline" aria-hidden="true" />}
            {item.project} · {item.label}
          </a>
        ))}
      </div>
    </section>
  )
}
