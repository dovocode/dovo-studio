import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { taskSearchSchema } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { messageResults, type MessageHit } from './task-search'
import type { TaskEntry } from './task-collection'

/** Query each owning runtime instead of downloading every conversation for a search. */
export function useTaskSearch(entries: readonly TaskEntry[], query: string) {
  const { runtimeRegistry, readRuntime, request, connection, activeRuntimeId } = useWorkspace()
  const needle = query.trim()
  const [remote, setRemote] = useState<{
    scope: string
    hits: MessageHit[]
    keys: Set<string>
    error: string
  }>({ scope: '', hits: [], keys: new Set(), error: '' })
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
  const run = useEffectEvent(() =>
    owners
      .filter((source) => source.online)
      .map(async (source) => {
        const profile = runtimeRegistry.profiles.find((profile) => profile.id === source.runtimeId)
        if (!profile && source.runtimeId !== null && source.runtimeId !== activeRuntimeId)
          throw new Error(`${source.name}: this computer connection is no longer available`)
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
  )
  useEffect(() => {
    if (!needle) return
    let stopped = false
    const timer = setTimeout(() => {
      void Promise.allSettled(run()).then((results) => {
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
          scope,
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
  }, [needle, scope])
  const local = useMemo(() => messageResults(entries, needle), [entries, needle])
  const currentEntries = new Map(entries.map((entry) => [entry.key, entry]))
  const remoteHits =
    remote.scope === scope
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
      ...(remote.scope === scope ? remote.keys : []),
      ...local.map((hit) => hit.entry.key),
    ]),
    error: remote.scope === scope ? remote.error : '',
    loading: !!needle && remote.scope !== scope,
    offline: !!needle && owners.some((source) => !source.online),
  }
}
