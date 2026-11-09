import { taskSearchOrder, type TaskSearchResult } from '@dovo/protocol'
import type { Services } from '../../services.js'

export function searchRuntimeHistory(
  s: Services,
  query: string,
  id?: string,
  before?: string,
): TaskSearchResult {
  const replicas = s.threadReplication.replicas([])
  if (id)
    return replicas.some((task) => task.id === id)
      ? s.threadReplication.search(query, id, before)
      : s.store.searchHistory(query, id, before)
  const local = s.store.searchHistory(query)
  const shared = s.threadReplication.search(query)
  const matched = new Set([...local.taskIds, ...shared.taskIds])
  const taskIds = taskSearchOrder([...s.store.get().tasks, ...replicas])
    .map((task) => task.id)
    .filter((id) => matched.has(id))
  const byTask = new Map<string, TaskSearchResult['hits']>()
  for (const hit of [...local.hits, ...shared.hits]) {
    const hits = byTask.get(hit.taskId) ?? []
    hits.push(hit)
    byTask.set(hit.taskId, hits)
  }
  return { taskIds, hits: taskIds.flatMap((id) => byTask.get(id) ?? []).slice(0, 50) }
}
