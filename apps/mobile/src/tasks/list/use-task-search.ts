import { runClientEffect } from '@dovo/client-runtime'
import { useEffect, useEffectEvent, useState } from 'react'
import {
  runtimeResourceKey,
  taskSearchSchema,
  type TaskSearchResult,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAppActive } from '../../runtime/state/app-active'

/** Search history on each owning computer; snapshots deliberately omit conversation bodies. */
export function useTaskSearch(entries: readonly RuntimeOverview[], query: string, enabled = true) {
  const { readRuntimeEffect } = useRuntime()
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
    results: { runtimeId: string; result: TaskSearchResult }[]
    pending: number
    error: string
  }>({
    scope: '',
    history: '',
    results: [],
    pending: 0,
    error: '',
  })
  const owners = useEffectEvent(() => entries.filter((entry) => entry.connected))
  const read = useEffectEvent(readRuntimeEffect)
  useEffect(() => {
    if (!needle || !active) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const sources = owners()
      setRemote((current) => ({
        scope,
        history,
        results: current.scope === scope ? current.results : [],
        error: '',
        pending: sources.length,
      }))
      for (const entry of sources)
        void runClientEffect(
          read(entry.profile, '/api/tasks/search', { query: needle }, taskSearchSchema),
          controller.signal,
        ).then(
          (result) => {
            if (controller.signal.aborted) return
            setRemote((current) => ({
              ...current,
              results: [
                ...current.results.filter((item) => item.runtimeId !== entry.profile.id),
                { runtimeId: entry.profile.id, result },
              ],
              pending: current.pending - 1,
            }))
          },
          (error: unknown) => {
            if (controller.signal.aborted) return
            const message = `${entry.profile.name}: ${error instanceof Error ? error.message : String(error)}`
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
  }, [needle, scope, history, active])
  const results = remote.scope === scope ? remote.results : []
  return {
    hits: results.flatMap(({ runtimeId, result }) =>
      result.hits.map((hit) => ({
        ...hit,
        runtimeId,
        key: runtimeResourceKey(runtimeId, hit.taskId),
      })),
    ),
    keys: new Set(
      results.flatMap(({ runtimeId, result }) =>
        result.taskIds.map((id) => runtimeResourceKey(runtimeId, id)),
      ),
    ),
    loading:
      active &&
      !!needle &&
      (remote.scope !== scope || remote.history !== history || remote.pending > 0),
    error: needle && remote.scope === scope ? remote.error : '',
    offline: !!needle && entries.some((entry) => !entry.connected),
  }
}
