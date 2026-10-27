import { useEffect, useEffectEvent, useState } from 'react'
import { runtimeResourceKey, taskSearchSchema, type RuntimeOverview } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'

/** Search history on each owning computer; snapshots deliberately omit conversation bodies. */
export function useTaskSearch(entries: readonly RuntimeOverview[], query: string) {
  const { readRuntime } = useRuntime()
  const identity = JSON.stringify(
    entries.map((entry) => [entry.profile.id, entry.profile.connection, entry.connected]),
  )
  const needle = query.trim().toLowerCase()
  const scope = JSON.stringify([needle, identity])
  const [remote, setRemote] = useState<{ scope: string; keys: Set<string>; error: string }>({
    scope: '',
    keys: new Set(),
    error: '',
  })
  const owners = useEffectEvent(() => entries.filter((entry) => entry.connected))
  const read = useEffectEvent(readRuntime)
  useEffect(() => {
    if (!needle) return
    let cancelled = false
    const timer = setTimeout(() => {
      void Promise.allSettled(
        owners().map(async (entry) => {
          const result = await read(
            entry.profile,
            '/api/tasks/search',
            { query: needle },
            taskSearchSchema,
          )
          return result.taskIds.map((id) => runtimeResourceKey(entry.profile.id, id))
        }),
      ).then((results) => {
        if (cancelled) return
        setRemote({
          scope,
          keys: new Set(
            results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
          ),
          error: results
            .flatMap((result) =>
              result.status === 'rejected'
                ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
                : [],
            )
            .join(' · '),
        })
      })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needle, scope])
  return {
    keys: remote.scope === scope ? remote.keys : new Set<string>(),
    loading: !!needle && remote.scope !== scope,
    error: needle && remote.scope === scope ? remote.error : '',
    offline: !!needle && entries.some((entry) => !entry.connected),
  }
}
