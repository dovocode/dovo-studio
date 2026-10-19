import { useCallback, useState } from 'react'
import { taskWaitingSchema, type taskWaitingRequestSchema } from '@dovo/protocol'
import { useTaskWaiting, useWorkspace, useStudioHost, encodeWorkTarget } from '@dovo/studio-core'
import { Eye, Link2, RefreshCw, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

export function TaskWaitingPanel({
  taskId,
  panel = false,
  onPullLink,
}: {
  taskId: string
  panel?: boolean
  onPullLink?: (url: string) => boolean
}) {
  const { openExternalLink, openPullLink, navigate, openThread } = useStudioHost()
  const { request, connected, activeRuntimeId, connection, workspace } = useWorkspace()
  const [confirmation, setConfirmation] = useState<
    typeof taskWaitingRequestSchema.Type.unlink | undefined
  >(undefined)
  const read = useCallback(
    (input: typeof taskWaitingRequestSchema.Type) =>
      request('/api/tasks/waiting', input, taskWaitingSchema),
    [request],
  )
  const { data, error, busy, refresh } = useTaskWaiting(
    taskId,
    connected,
    read,
    JSON.stringify([activeRuntimeId, connection]),
  )
  const watchingUrls = new Set(data?.dependencies.map((item) => item.url))
  const related = panel ? (data?.related?.filter((item) => !watchingUrls.has(item.url)) ?? []) : []
  if (connected && !error && !data?.dependencies.length && !related.length) return null
  const openPull = (url: string) => onPullLink?.(url) || openPullLink?.(url)
  const openRelated = (url: string) => {
    if (openPull(url)) return
    const task = workspace?.tasks.find((task) => task.id === taskId)
    const work = task?.workItem
    if (task && work?.url === url) {
      const jiraSourceId = work.kind === 'issue' ? work.jiraSourceId : undefined
      navigate({
        viewId: work.kind === 'pipeline' ? 'pipelines' : jiraSourceId ? 'jira' : 'issues',
        entityId: encodeWorkTarget({
          runtimeId: activeRuntimeId ?? undefined,
          ...(jiraSourceId ? { jiraSourceId } : { repositoryId: task.repositoryId }),
          id: work.id,
          url,
        }),
      })
    } else if (openExternalLink) void openExternalLink(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  return (
    <section
      aria-label="Related items and watchers"
      className={
        panel
          ? 'studio-project-section border-t border-border/60 text-xs'
          : 'flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto px-4 py-2 text-xs'
      }
    >
      {!connected && <p>Offline · Showing saved watches. Reconnect to update or stop them.</p>}
      {error && (
        <p role="alert" className="max-w-full truncate text-destructive">
          {error}
        </p>
      )}
      {panel ? (
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          <Eye size={16} />
          <h3
            className="flex-1 text-xs font-medium"
            title="Updates arrive in this thread. × stops watching."
          >
            Watching
          </h3>
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
      {panel && !data?.dependencies.length && (
        <p className="mb-2 text-[11px] text-muted-foreground">No active watches</p>
      )}
      <div className={panel ? 'flex flex-wrap gap-2' : 'contents'}>
        {data?.dependencies.map((item) => (
          <div
            key={JSON.stringify([item.kind, item.runtimeId, item.repositoryId, item.target])}
            className="inline-flex max-w-full shrink-0 items-center rounded-full border bg-muted/30"
            title={[
              item.pausedReason ?? item.status,
              `Last check ${new Date(item.checkedAt).toLocaleString()}`,
              item.lastSuccessAt &&
                `Last successful poll ${new Date(item.lastSuccessAt).toLocaleString()}`,
              item.error,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <Eye size={13} className="ml-2 shrink-0 text-muted-foreground" aria-hidden="true" />
            {item.kind === 'thread' ? (
              <button
                type="button"
                className="min-w-0 truncate py-1.5 pl-1.5 pr-1 hover:underline"
                aria-label={`Open ${item.label}`}
                disabled={!openThread}
                onClick={() =>
                  openThread?.({
                    ...(item.runtimeIdentity ? { runtimeIdentity: item.runtimeIdentity } : {}),
                    runtimeId:
                      !item.runtimeId || item.runtimeId === 'local'
                        ? activeRuntimeId
                        : item.runtimeId,
                    threadId: item.target,
                    title: item.label,
                    parent: {
                      runtimeId: activeRuntimeId,
                      threadId: taskId,
                      title:
                        workspace.tasks.find((task) => task.id === taskId)?.title ??
                        'Parent thread',
                    },
                  })
                }
              >
                {item.project} · {item.label}
              </button>
            ) : (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate py-1.5 pl-1.5 pr-1 hover:underline"
                onClick={(event) => {
                  event.preventDefault()
                  if (item.kind === 'pipeline')
                    navigate({
                      viewId: 'pipelines',
                      entityId: encodeWorkTarget({
                        runtimeId: activeRuntimeId ?? undefined,
                        repositoryId: item.repositoryId,
                        id: item.target,
                        url: item.url,
                      }),
                    })
                  else if (!openPull(item.url)) {
                    if (openExternalLink) void openExternalLink(item.url)
                    else window.open(item.url, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                {item.project} · {item.label}
              </a>
            )}
            {panel && !item.pausedReason && (
              <span className="pr-1 text-[10px] text-muted-foreground">
                {item.status.replaceAll('_', ' ')}
              </span>
            )}
            {panel && item.kind === 'pipeline' && (
              <span className="pr-1 text-[10px] text-muted-foreground">
                {item.lastSuccessAt
                  ? `Last successful poll ${new Date(item.lastSuccessAt).toLocaleString()}`
                  : 'No recorded successful poll'}
              </span>
            )}
            {item.pausedReason && <span className="px-1 text-muted-foreground">Paused</span>}
            {item.error && (
              <span className="max-w-full truncate text-destructive" role="status">
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
                setConfirmation({
                  kind: item.kind,
                  ...(item.runtimeId ? { runtimeId: item.runtimeId } : {}),
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
                    openRelated(item.url)
                  }
                : undefined
            }
          >
            {panel && <Link2 size={12} className="mr-1 inline" aria-hidden="true" />}
            {item.project} · {item.label}
          </a>
        ))}
      </div>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop watching?</DialogTitle>
            <DialogDescription>
              Updates for this item will stop arriving in this thread.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmation(undefined)}>
              Keep watching
            </Button>
            <Button
              disabled={!connected || busy}
              onClick={() => {
                const unlink = confirmation
                if (unlink) {
                  setConfirmation(undefined)
                  void refresh(unlink)
                }
              }}
            >
              Stop watching
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
