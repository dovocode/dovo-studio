import { useEffect, useState } from 'react'
import {
  cachedThread,
  cachedRuntimeThread,
  runtimeSnapshotCacheSchema,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from './context'
export function useCachedTask(summary: Task | undefined) {
  const { snapshot, readCache } = useWorkspace()
  const [cached, setCached] = useState<{ cache: typeof readCache; task: Task } | null>(null)
  const [failure, setFailure] = useState<{
    cache: typeof readCache
    id: string
    error: string
  } | null>(null)
  const id = summary?.id
  const live = !!id && (!snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(id))
  const replica = id && readCache ? cachedRuntimeThread(readCache, id) : undefined
  const retained =
    replica && (replica.historyRevision ?? 0) === (summary?.historyRevision ?? 0)
      ? replica
      : undefined
  useEffect(() => {
    if (!id || !readCache || live || retained) return
    let stopped = false
    void readCache
      .read('snapshot', runtimeSnapshotCacheSchema)
      .then((entry) => {
        const snapshot = entry?.value.snapshot
        const task = snapshot?.workspace.tasks.find((task) => task.id === id)
        if (!stopped && task && (!snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(id)))
          setCached({ cache: readCache, task })
      })
      .catch((error: unknown) => {
        if (!stopped)
          setFailure({
            cache: readCache,
            id,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      stopped = true
    }
  }, [id, readCache, live, retained])
  const available =
    !!summary &&
    cached?.cache === readCache &&
    cached.task.id === summary.id &&
    (cached.task.historyRevision ?? 0) === (summary.historyRevision ?? 0)
  const history = retained ?? (available ? cached?.task : undefined)
  return {
    task: summary && !live && history ? cachedThread(summary, history) : summary,
    loaded: live || !!history,
    error:
      !live && !history && failure?.cache === readCache && failure.id === id ? failure.error : '',
  }
}
