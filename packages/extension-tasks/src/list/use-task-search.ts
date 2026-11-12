import { Effect } from 'effect'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { taskSearchSchema, type TaskSearchResult } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { mergeMessageResults, messageResults } from './task-search'
import { taskCollectionKey, type TaskEntry } from './task-collection'

/** Query each owning runtime instead of downloading every conversation for a search. */
export function useTaskSearch(entries: readonly TaskEntry[], query: string) {
  const { runtimeRegistry, readRuntimeEffect, requestEffect, connection, activeRuntimeId } =
    useWorkspace()
  const needle = query.trim()
  const [remote, setRemote] = useState<{
    scope: string
    results: { runtimeId: string | null; result: TaskSearchResult }[]
    error: string
    pending: number
  }>({ scope: '', results: [], error: '', pending: 0 })
  // Streaming metadata changes must not restart an in-flight search.
  const owners = [
    ...new Map(entries.map((entry) => [entry.source.runtimeId, entry.source])).values(),
  ]
  const identity = JSON.stringify(
    owners
      .map((source) => [
        source.runtimeId,
        source.online,
        runtimeRegistry.profiles.find((profile) => profile.id === source.runtimeId)?.connection ??
          (source.runtimeId === null || source.runtimeId === activeRuntimeId ? connection : null),
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  )
  const scope = JSON.stringify([needle, identity])
  const run = useEffectEvent((signal: AbortSignal) =>
    owners
      .filter((source) => source.online)
      .map(async (source) => {
        const profile = runtimeRegistry.profiles.find((profile) => profile.id === source.runtimeId)
        if (!profile && source.runtimeId !== null && source.runtimeId !== activeRuntimeId)
          throw new Error(`${source.name}: this computer connection is no longer available`)
        const result = await Effect.runPromise(
          profile
            ? readRuntimeEffect(profile, '/api/tasks/search', { query: needle }, taskSearchSchema)
            : requestEffect('/api/tasks/search', { query: needle }, taskSearchSchema),
          { signal },
        ).catch((error: unknown) => {
          throw new Error(
            `${source.name}: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        // A history response can beat the full-summary subscription. Keep its IDs
        // until the summaries arrive instead of dropping unresolved matches.
        return { runtimeId: source.runtimeId, result }
      }),
  )
  useEffect(() => {
    if (!needle) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const requests = run(controller.signal)
      setRemote({ scope, results: [], error: '', pending: requests.length })
      for (const request of requests)
        void request.then(
          (result) => {
            if (controller.signal.aborted) return
            setRemote((current) => ({
              ...current,
              results: [...current.results, result],
              pending: current.pending - 1,
            }))
          },
          (error: unknown) => {
            if (controller.signal.aborted) return
            const message = error instanceof Error ? error.message : String(error)
            setRemote((current) => ({
              ...current,
              error: [current.error, message].filter(Boolean).join(' · '),
              pending: current.pending - 1,
            }))
          },
        )
    }, 200)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [needle, scope])
  const local = useMemo(() => messageResults(entries, needle), [entries, needle])
  const currentEntries = new Map(entries.map((entry) => [entry.key, entry]))
  const results = remote.scope === scope ? remote.results : []
  const remoteHits = results.flatMap(({ runtimeId, result }) =>
    result.hits.flatMap((hit) => {
      const entry = currentEntries.get(taskCollectionKey(runtimeId, hit.taskId))
      return entry
        ? [{ entry, messageId: hit.messageId, snippet: hit.snippet, role: hit.role }]
        : []
    }),
  )
  const hits = mergeMessageResults([...remoteHits, ...local])
  return {
    hits,
    keys: new Set([
      ...results.flatMap(({ runtimeId, result }) =>
        result.taskIds.map((id) => taskCollectionKey(runtimeId, id)),
      ),
      ...local.map((hit) => hit.entry.key),
    ]),
    error: remote.scope === scope ? remote.error : '',
    loading: !!needle && (remote.scope !== scope || remote.pending > 0),
    offline: !!needle && owners.some((source) => !source.online),
  }
}
