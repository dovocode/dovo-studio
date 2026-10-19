import { useStudioHost } from '@dovo/studio-core'
import type { Task } from '@dovo/protocol'
import { cn } from '@dovo/studio-ui'
import { Monitor } from 'lucide-react'

/** The owning runtime supplies these facts; an offline peer never implies completion. */
export function ThreadWatchSummary({
  task,
  online,
  runtimeId,
  includeSpawned = true,
}: {
  task: Task
  online: boolean
  runtimeId: string | null
  includeSpawned?: boolean
}) {
  const { openThread } = useStudioHost()
  const watches =
    task.threadWatches?.filter(
      (watch) => watch.status === 'watching' && (includeSpawned || watch.relation === 'linked'),
    ) ?? []
  if (!watches.length) return null
  return (
    <div
      className="mb-2 space-y-1 px-2.5 text-xs text-muted-foreground"
      aria-label="Related threads"
    >
      {watches.map((watch) => {
        const stale = !online || watch.offline
        const needsInput = watch.snapshot?.phase === 'needs-input'
        const status = stale
          ? 'Offline · last known state'
          : watch.paused
            ? 'Paused · last known state'
            : (watch.snapshot?.phase.replaceAll('-', ' ') ?? 'Connecting')
        return (
          <div
            key={JSON.stringify([watch.runtimeId, watch.threadId])}
            className="flex min-w-0 items-start gap-1.5 border-l pl-2"
          >
            <Monitor className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <button
                type="button"
                className="truncate text-left text-foreground hover:underline"
                aria-label={`Open child thread ${watch.snapshot?.title ?? watch.threadId}`}
                disabled={!openThread}
                onClick={(event) => {
                  event.stopPropagation()
                  openThread?.({
                    ...(watch.snapshot?.runtimeId
                      ? { runtimeIdentity: watch.snapshot.runtimeId }
                      : {}),
                    runtimeId: watch.runtimeId === 'local' ? runtimeId : watch.runtimeId,
                    threadId: watch.threadId,
                    title: watch.snapshot?.title ?? 'Child thread',
                    parent: { runtimeId, threadId: task.id, title: task.title },
                  })
                }}
                title={watch.snapshot?.title ?? watch.threadId}
              >
                {watch.snapshot?.title ?? 'Connected thread'}
              </button>
              <p className={cn(needsInput && !stale && !watch.paused && 'text-amber-500')}>
                {watch.computerName} · {status}
                {watch.relation === 'linked' ? ' · Linked' : ''}
              </p>
              {stale && watch.lastSuccessAt && (
                <p>Updated {new Date(watch.lastSuccessAt).toLocaleString()}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
