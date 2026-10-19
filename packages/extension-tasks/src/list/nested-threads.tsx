import { memo, useId, useState } from 'react'
import { useStudioHost, type StudioHostApi } from '@dovo/studio-core'
import { ChevronRight, Monitor } from 'lucide-react'
import { cn } from '@dovo/studio-ui'
import { readTaskListViewState, saveTaskListViewState } from './task-list-view-state'
import { threadDescendants, type NestedThread } from './thread-tree'

type ThreadTarget = Parameters<NonNullable<StudioHostApi['openThread']>>[0]
const phases = {
  connecting: 'Connecting',
  draft: 'Draft',
  running: 'Running',
  waiting: 'Waiting',
  'needs-input': 'Needs input',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  review: 'Review',
}

/** Presentation only: snapshots and watch ownership continue to come from the owning runtime. */
function NestedThreadsView({
  threads,
  parent,
  selectedKey,
  searching = false,
}: {
  threads: readonly NestedThread[]
  parent: ThreadTarget
  selectedKey?: string
  searching?: boolean
}) {
  const host = useStudioHost()
  const id = useId()
  const parentKey = JSON.stringify([parent.runtimeId, parent.threadId])
  const [expanded, setExpanded] = useState(
    () => readTaskListViewState(host).threadExpansion?.[parentKey] ?? true,
  )
  if (!threads.length) return null
  const descendants = threadDescendants(threads)
  const attention = descendants.filter(
    (child) => child.online && !child.paused && child.phase === 'needs-input',
  )
  const running = descendants.filter(
    (child) => child.online && !child.paused && child.phase === 'running',
  ).length
  const open = searching || expanded
  const navigate = (child: NestedThread) =>
    host.openThread?.({
      runtimeId: child.runtimeId,
      ...(child.runtimeIdentity ? { runtimeIdentity: child.runtimeIdentity } : {}),
      threadId: child.threadId,
      title: child.title,
      parent: {
        runtimeId: parent.runtimeId,
        threadId: parent.threadId,
        title: parent.title,
      },
    })
  return (
    <div className="mb-1 min-w-0 px-2" aria-label={`Spawned threads for ${parent.title}`}>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-0.5 py-1 text-left hover:bg-accent/50"
          aria-label={`Spawned threads for ${parent.title}`}
          aria-expanded={open}
          aria-controls={id}
          disabled={searching}
          onClick={(event) => {
            event.stopPropagation()
            const next = !open
            setExpanded(next)
            saveTaskListViewState(host, {
              threadExpansion: {
                ...readTaskListViewState(host).threadExpansion,
                [parentKey]: next,
              },
            })
          }}
        >
          <ChevronRight className={cn('size-3 shrink-0', open && 'rotate-90')} aria-hidden="true" />
          <span>
            {descendants.length} spawned {descendants.length === 1 ? 'thread' : 'threads'}
          </span>
          {!!running && <span className="truncate">· {running} running</span>}
        </button>
        {!!attention.length && (
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-amber-500 hover:bg-accent/50"
            disabled={!host.openThread}
            aria-label={`Open input request in ${attention[0]!.title}`}
            onClick={(event) => {
              event.stopPropagation()
              // Navigate with the immediate parent even for a deeply nested input request.
              const child = attention[0]!
              const owner = descendants.find((node) =>
                node.children.some((item) => item.key === child.key),
              )
              host.openThread?.({
                runtimeId: child.runtimeId,
                ...(child.runtimeIdentity ? { runtimeIdentity: child.runtimeIdentity } : {}),
                threadId: child.threadId,
                title: child.title,
                parent: owner
                  ? { runtimeId: owner.runtimeId, threadId: owner.threadId, title: owner.title }
                  : { runtimeId: parent.runtimeId, threadId: parent.threadId, title: parent.title },
              })
            }}
          >
            {attention.length} needs input
          </button>
        )}
      </div>
      <ul id={id} hidden={!open} className="ml-1.5 border-l border-border/70 pl-2">
        {threads.map((child) => (
          <li key={child.key} className="min-w-0 py-0.5">
            <button
              type="button"
              aria-label={`Open child thread ${child.title}`}
              aria-current={child.key === selectedKey ? 'true' : undefined}
              disabled={!host.openThread}
              className={cn(
                'w-full min-w-0 rounded-lg px-2 py-1.5 text-left hover:bg-accent/50',
                child.key === selectedKey && 'bg-accent/70 text-foreground',
              )}
              onClick={(event) => {
                event.stopPropagation()
                navigate(child)
              }}
              title={child.title}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full bg-muted-foreground/50',
                    child.online && !child.paused && child.phase === 'running' && 'bg-sky-400',
                    child.online &&
                      !child.paused &&
                      child.phase === 'needs-input' &&
                      'bg-amber-500',
                    child.online && child.phase === 'failed' && 'bg-destructive',
                  )}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{child.title}</span>
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.625rem] text-muted-foreground">
                <Monitor className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {child.computerName} · {phases[child.phase]}
                </span>
                {!child.online ? (
                  <span className="shrink-0">· Offline</span>
                ) : child.paused ? (
                  <span className="shrink-0">· Monitor stopped</span>
                ) : null}
              </span>
              {!child.online && child.lastSuccessAt && (
                <span className="block text-[0.625rem] text-muted-foreground">
                  Updated {new Date(child.lastSuccessAt).toLocaleString()}
                </span>
              )}
              {child.activity && (
                <span className="mt-0.5 block truncate text-[0.625rem] text-muted-foreground">
                  {child.activity}
                </span>
              )}
            </button>
            <NestedThreads
              threads={child.children}
              parent={child}
              selectedKey={selectedKey}
              searching={searching}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

export const NestedThreads = memo(NestedThreadsView)
