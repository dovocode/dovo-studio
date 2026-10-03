import { useEffect, useState } from 'react'
import { cachedThread, runtimeSnapshotCacheSchema, type Task } from '@dovo/protocol'
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
  useEffect(() => {
    if (!id || !readCache || live) return
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
  }, [id, readCache, live])
  const available =
    !!summary &&
    cached?.cache === readCache &&
    cached.task.id === summary.id &&
    (cached.task.historyRevision ?? 0) === (summary.historyRevision ?? 0)
  return {
    task: summary && !live && available ? cachedThread(summary, cached.task) : summary,
    loaded: live || available,
    error: !live && failure?.cache === readCache && failure.id === id ? failure.error : '',
  }
}
