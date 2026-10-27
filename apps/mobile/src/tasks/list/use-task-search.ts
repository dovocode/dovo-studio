import { useEffect, useEffectEvent, useState } from 'react'
import { runtimeResourceKey, taskSearchSchema, type RuntimeOverview } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAppActive } from '../../runtime/state/app-active'

/** Search history on each owning computer; snapshots deliberately omit conversation bodies. */
export function useTaskSearch(entries: readonly RuntimeOverview[], query: string, enabled = true) {
  const { readRuntime } = useRuntime()
  const active = useAppActive() && enabled
  const identity = JSON.stringify(
    entries.map((entry) => [entry.profile.id, entry.profile.connection, entry.connected]),
  )
  const needle = query.trim().toLowerCase()
  const scope = JSON.stringify([needle, identity])
  // Stream chunks update updatedAt. Observe committed input, structural history changes and
  // turn boundaries while running; idle edits also change updatedAt without a new turn.
  const history = JSON.stringify(
    entries.map((entry) => [
      entry.profile.id,
      entry.snapshot?.workspace.tasks.map((task) => {
        const turn = task.turns?.at(-1)
        return [
          task.id,
          task.historyRevision,
          task.lastPromptAt,
          task.status,
          turn?.id,
          turn?.status,
          turn?.finishedAt,
          task.status === 'running' ? undefined : task.updatedAt,
        ]
      }),
    ]),
  )
  const [remote, setRemote] = useState<{
    scope: string
    history: string
    keys: Set<string>
    error: string
  }>({
    scope: '',
    history: '',
    keys: new Set(),
    error: '',
  })
  const owners = useEffectEvent(() => entries.filter((entry) => entry.connected))
  const read = useEffectEvent(readRuntime)
  useEffect(() => {
    if (!needle || !active) return
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
          history,
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
  }, [needle, scope, history, active])
  return {
    keys: remote.scope === scope ? remote.keys : new Set<string>(),
    loading: active && !!needle && (remote.scope !== scope || remote.history !== history),
    error: needle && remote.scope === scope ? remote.error : '',
    offline: !!needle && entries.some((entry) => !entry.connected),
  }
}
