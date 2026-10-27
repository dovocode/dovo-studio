import { useEffect, useMemo, useRef, useState } from 'react'
import { taskSearchSchema, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { searchThread } from './thread-search'
/** Search stored history as well as the live window; offline search uses cached messages. */
export function useThreadSearch(
  task: Pick<Task, 'id' | 'messages' | 'historyBefore' | 'historyRevision'>,
  query: string,
) {
  const { connection, request, connected } = useWorkspace()
  const scope = JSON.stringify([
    connection?.address,
    connection?.token,
    task.id,
    task.historyRevision,
    query,
    connected,
  ])
  const needsRemote = !!query.trim() && !!task.historyBefore && connected
  const generation = useRef(0)
  const [remote, setRemote] = useState<{
    scope: string
    matches: ReturnType<typeof searchThread>
    error: string
    nextBefore?: string
    loading: boolean
  }>()
  useEffect(() => {
    const attempt = ++generation.current
    if (!needsRemote) return
    let cancelled = false
    const timer = setTimeout(() => {
      void request('/api/tasks/search', { id: task.id, query }, taskSearchSchema)
        .then((result) => {
          if (!cancelled && attempt === generation.current)
            setRemote({
              scope,
              matches: result.hits.reverse().map((hit) => ({
                id: hit.messageId,
                role: hit.role === 'user' ? 'user' : 'assistant',
                preview: hit.snippet,
              })),
              error: '',
              nextBefore: result.nextBefore,
              loading: false,
            })
        })
        .catch((cause: unknown) => {
          if (!cancelled && attempt === generation.current)
            setRemote({
              scope,
              matches: [],
              error: cause instanceof Error ? cause.message : String(cause),
              loading: false,
            })
        })
    }, 150)
    return () => {
      cancelled = true
      generation.current++
      clearTimeout(timer)
    }
  }, [scope, task.id, needsRemote, query, request])
  const loadMore = async () => {
    if (!connected || remote?.scope !== scope || !remote.nextBefore || remote.loading) return
    const attempt = generation.current
    const before = remote.nextBefore
    setRemote({ ...remote, loading: true, error: '' })
    try {
      const result = await request(
        '/api/tasks/search',
        { id: task.id, query, before },
        taskSearchSchema,
      )
      if (result.nextBefore === before) throw new Error('Search did not advance. Search again.')
      setRemote((current) =>
        current?.scope !== scope || attempt !== generation.current
          ? current
          : {
              scope,
              matches: [...result.hits]
                .reverse()
                .map((hit) => ({
                  id: hit.messageId,
                  role: hit.role === 'user' ? ('user' as const) : ('assistant' as const),
                  preview: hit.snippet,
                }))
                .concat(current.matches),
              error: '',
              nextBefore: result.nextBefore,
              loading: false,
            },
      )
    } catch (cause) {
      setRemote((current) =>
        current?.scope !== scope || attempt !== generation.current
          ? current
          : {
              ...current,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            },
      )
    }
  }
  const matches = useMemo(() => {
    const current = searchThread(task.messages, query)
    const values = new Map<string, ReturnType<typeof searchThread>[number]>()
    if (remote?.scope === scope) for (const match of remote.matches) values.set(match.id, match)
    for (const match of current) values.set(match.id, match)
    return [...values.values()]
  }, [task.messages, query, remote, scope])
  return {
    matches,
    error: remote?.scope === scope ? remote.error : '',
    hasMore: remote?.scope === scope && remote.nextBefore !== undefined,
    loading: needsRemote && (remote?.scope !== scope || remote.loading),
    loadMore,
  }
}
