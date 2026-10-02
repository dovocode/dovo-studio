import { useEffect, useMemo, useState } from 'react'
import { taskSearchSchema, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { searchThread } from './thread-search'
/** Search stored history as well as the live window; offline search uses cached messages. */
export function useThreadSearch(
  task: Pick<Task, 'id' | 'messages' | 'historyBefore'>,
  query: string,
) {
  const { connection, request, connected } = useWorkspace()
  const scope = JSON.stringify([connection?.address, connection?.token, task.id, query])
  const [remote, setRemote] = useState<{
    scope: string
    matches: ReturnType<typeof searchThread>
    error: string
  }>()
  useEffect(() => {
    if (!query.trim() || !task.historyBefore || !connected) return
    let cancelled = false
    const timer = setTimeout(() => {
      void request('/api/tasks/search', { id: task.id, query }, taskSearchSchema)
        .then((result) => {
          if (!cancelled)
            setRemote({
              scope,
              matches: result.hits.reverse().map((hit) => ({
                id: hit.messageId,
                role: hit.role === 'user' ? 'user' : 'assistant',
                preview: hit.snippet,
              })),
              error: '',
            })
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setRemote({
              scope,
              matches: [],
              error: cause instanceof Error ? cause.message : String(cause),
            })
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scope, task.id, task.historyBefore, query, connected, request])
  const matches = useMemo(() => {
    const current = searchThread(task.messages, query)
    const values = new Map<string, ReturnType<typeof searchThread>[number]>()
    if (remote?.scope === scope) for (const match of remote.matches) values.set(match.id, match)
    for (const match of current) values.set(match.id, match)
    return [...values.values()]
  }, [task.messages, query, remote, scope])
  return { matches, error: remote?.scope === scope ? remote.error : '' }
}
