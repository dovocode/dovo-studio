import { useEffect, useMemo, useState } from 'react'
import { taskSearchSchema } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { messageResults, type MessageHit } from './task-search'
import type { TaskEntry } from './task-collection'

/** Query each owning runtime instead of downloading every conversation for a search. */
export function useTaskSearch(entries: readonly TaskEntry[], query: string) {
  const { runtimeRegistry, readRuntime, request } = useWorkspace()
  const needle = query.trim()
  const [remote, setRemote] = useState<{
    query: string
    hits: MessageHit[]
    keys: Set<string>
    error: string
  }>({ query: '', hits: [], keys: new Set(), error: '' })
  // Streaming metadata changes must not restart an in-flight search.
  const identity = JSON.stringify([
    ...new Set(
      entries.map((entry) => JSON.stringify([entry.source.runtimeId, entry.source.online])),
    ),
  ])
  useEffect(() => {
    if (!needle) return
    let stopped = false
    const timer = setTimeout(() => {
      const owners = [
        ...new Map(entries.map((entry) => [entry.source.runtimeId, entry.source])).values(),
      ]
      void Promise.allSettled(
        owners
          .filter((source) => source.online)
          .map(async (source) => {
            const profile = runtimeRegistry.profiles.find(
              (profile) => profile.id === source.runtimeId,
            )
            const result = await (profile
              ? readRuntime(profile, '/api/tasks/search', { query: needle }, taskSearchSchema)
              : request('/api/tasks/search', { query: needle }, taskSearchSchema))
            const ownerEntries = new Map(
              entries
                .filter((entry) => entry.source.runtimeId === source.runtimeId)
                .map((entry) => [entry.task.id, entry]),
            )
            return {
              keys: result.taskIds.flatMap((id) => ownerEntries.get(id)?.key ?? []),
              hits: result.hits.flatMap((hit) => {
                const entry = ownerEntries.get(hit.taskId)
                return entry
                  ? [{ entry, messageId: hit.messageId, snippet: hit.snippet, role: hit.role }]
                  : []
              }),
            }
          }),
      ).then((results) => {
        if (stopped) return
        const values = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )
        const errors = results.flatMap((result) =>
          result.status === 'rejected'
            ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
            : [],
        )
        setRemote({
          query: needle,
          keys: new Set(values.flatMap((value) => value.keys)),
          hits: values.flatMap((value) => value.hits).slice(0, 50),
          error: errors.join(' · '),
        })
      })
    }, 200)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [needle, identity, readRuntime, request, runtimeRegistry.profiles])
  const local = useMemo(() => messageResults(entries, needle), [entries, needle])
  const currentEntries = new Map(entries.map((entry) => [entry.key, entry]))
  const remoteHits =
    remote.query === needle
      ? remote.hits.flatMap((hit) => {
          const entry = currentEntries.get(hit.entry.key)
          return entry ? [{ ...hit, entry }] : []
        })
      : []
  const hits = [
    ...new Map(
      [...remoteHits, ...local].map((hit) => [`${hit.entry.key}:${hit.messageId}`, hit]),
    ).values(),
  ].slice(0, 50)
  return {
    hits,
    keys: new Set([
      ...(remote.query === needle ? remote.keys : []),
      ...local.map((hit) => hit.entry.key),
    ]),
    error: remote.query === needle ? remote.error : '',
    loading: !!needle && remote.query !== needle,
  }
}
