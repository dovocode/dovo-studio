import { Effect } from 'effect'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { taskSearchSchema, type TaskSearchResult } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { mergeMessageResults, messageResults } from './task-search'
import { taskCollectionKey, type TaskEntry } from './task-collection'

type SearchFailure = { runtimeId: string | null; name: string; error: string }
type SearchFlight = {
  scope: string
  controller: AbortController
  pending: Set<string | null>
}

/** Query each owning runtime instead of downloading every conversation for a search. */
export function useTaskSearch(entries: readonly TaskEntry[], query: string) {
  const { runtimeRegistry, readRuntimeEffect, requestEffect, connection, activeRuntimeId } =
    useWorkspace()
  const needle = query.trim()
  const [remote, setRemote] = useState<{
    scope: string
    results: { runtimeId: string | null; result: TaskSearchResult }[]
    failures: SearchFailure[]
    pending: number
  }>({ scope: '', results: [], failures: [], pending: 0 })
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
  const flight = useRef<SearchFlight | null>(null)
  async function run(source: (typeof owners)[number], search: SearchFlight) {
    const { runtimeId, name } = source
    if (search.pending.has(runtimeId)) return
    search.pending.add(runtimeId)
    const pending = search.pending.size
    setRemote((current) => ({
      scope: search.scope,
      results: current.scope === search.scope ? current.results : [],
      failures:
        current.scope === search.scope
          ? current.failures.filter((item) => item.runtimeId !== runtimeId)
          : [],
      pending,
    }))
    const settle = (result?: TaskSearchResult, failure?: SearchFailure) => {
      if (search.controller.signal.aborted) return
      search.pending.delete(runtimeId)
      const pending = search.pending.size
      setRemote((current) =>
        current.scope === search.scope
          ? {
              ...current,
              results: result
                ? [
                    ...current.results.filter((item) => item.runtimeId !== runtimeId),
                    { runtimeId, result },
                  ]
                : current.results,
              failures: failure ? [...current.failures, failure] : current.failures,
              pending,
            }
          : current,
      )
    }
    try {
      const profile = runtimeRegistry.profiles.find((profile) => profile.id === runtimeId)
      if (!profile && runtimeId !== null && runtimeId !== activeRuntimeId)
        throw new Error('this computer connection is no longer available')
      const result = await Effect.runPromise(
        profile
          ? readRuntimeEffect(profile, '/api/tasks/search', { query: needle }, taskSearchSchema)
          : requestEffect('/api/tasks/search', { query: needle }, taskSearchSchema),
        { signal: search.controller.signal },
      )
      // Preserve hit IDs until their summaries arrive.
      settle(result)
    } catch (error) {
      settle(undefined, {
        runtimeId,
        name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const start = useEffectEvent((search: SearchFlight) => {
    const online = owners.filter((source) => source.online)
    if (!online.length) setRemote({ scope: search.scope, results: [], failures: [], pending: 0 })
    for (const source of online) void run(source, search)
  })
  useEffect(() => {
    if (!needle) return
    const search: SearchFlight = { scope, controller: new AbortController(), pending: new Set() }
    flight.current = search
    const timer = setTimeout(() => start(search), 200)
    return () => {
      search.controller.abort()
      flight.current = null
      clearTimeout(timer)
    }
  }, [needle, scope])
  const failures = remote.scope === scope ? remote.failures : []
  function retry(runtimeId: string | null) {
    const search = flight.current
    const source = owners.find((owner) => owner.runtimeId === runtimeId && owner.online)
    if (search?.scope === scope && source && failures.some((item) => item.runtimeId === runtimeId))
      void run(source, search)
  }
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
  const offlineComputers = needle ? owners.filter((source) => !source.online) : []
  return {
    hits,
    keys: new Set([
      ...results.flatMap(({ runtimeId, result }) =>
        result.taskIds.map((id) => taskCollectionKey(runtimeId, id)),
      ),
      ...local.map((hit) => hit.entry.key),
    ]),
    failures,
    retry,
    loading: !!needle && (remote.scope !== scope || remote.pending > 0),
    offline: offlineComputers.length > 0,
    offlineComputers: offlineComputers.map((source) => source.name),
    savedOnly: offlineComputers.length > 0 && offlineComputers.length === owners.length,
  }
}
